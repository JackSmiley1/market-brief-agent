import axios from "axios";
import { db } from "./db.js";
import { ALPACA_TRADING_BASE, computeNotional } from "./config.js";

const headers = {
  "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID,
  "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY,
};

// ---- Alpaca paper trading API (zero real capital — paper-api.alpaca.markets only) ----

async function submitBuyOrder(symbol, notional) {
  const res = await axios.post(
    `${ALPACA_TRADING_BASE}/orders`,
    { symbol, notional: String(notional), side: "buy", type: "market", time_in_force: "day" },
    { headers }
  );
  return res.data;
}

// Alpaca doesn't support notional (fractional) short sales — only whole
// shares can be shorted. Estimate qty from the last known close (already
// fetched for the brief itself, so no extra API call) rather than a
// live quote; this is sizing only, the actual fill price still comes from
// the order itself once reconciled. Rounds down, minimum 1 share — a
// stock priced above the target notional will short slightly under it
// rather than over, which is the safer direction to round.
async function submitShortOrder(symbol, estimatedPrice, notional) {
  const qty = Math.max(1, Math.floor(notional / estimatedPrice));
  const res = await axios.post(
    `${ALPACA_TRADING_BASE}/orders`,
    { symbol, qty: String(qty), side: "sell", type: "market", time_in_force: "day" },
    { headers }
  );
  return res.data;
}

// Closes the full existing position in one call — Alpaca handles the
// (possibly fractional, from a notional buy) quantity itself rather than
// requiring us to track and submit an exact share count.
async function closePosition(symbol) {
  const res = await axios.delete(`${ALPACA_TRADING_BASE}/positions/${symbol}`, { headers });
  return res.data;
}

async function getOrder(orderId) {
  const res = await axios.get(`${ALPACA_TRADING_BASE}/orders/${orderId}`, { headers });
  return res.data;
}

// axios's default err.message on a failed request is just "Request failed
// with status code 403" — useless for debugging. Alpaca's actual rejection
// reason lives in the response body; surface that instead when present.
function describeError(err) {
  return err.response?.data ? JSON.stringify(err.response.data) : err.message;
}

// ---- DB statements ----

const insertEntryStmt = db.prepare(`
  INSERT INTO paper_trades (date, ticker, entry_order_id, notional, direction, status)
  VALUES (?, ?, ?, ?, ?, 'entry_pending')
  ON CONFLICT(date, ticker) DO UPDATE SET entry_order_id = excluded.entry_order_id, direction = excluded.direction, status = 'entry_pending'
`);
const markEntryFailedStmt = db.prepare(`
  INSERT INTO paper_trades (date, ticker, notional, direction, status)
  VALUES (?, ?, ?, ?, 'entry_failed')
  ON CONFLICT(date, ticker) DO UPDATE SET status = 'entry_failed'
`);
const fillEntryStmt = db.prepare(`
  UPDATE paper_trades SET entry_price = ?, entry_filled_at = ?, qty = ?, status = 'open'
  WHERE date = ? AND ticker = ?
`);
const pendingEntriesStmt = db.prepare(
  `SELECT date, ticker, entry_order_id, notional, direction FROM paper_trades WHERE status = 'entry_pending' AND entry_order_id IS NOT NULL`
);

const openPositionsStmt = db.prepare(`SELECT date, ticker, entry_price, notional, direction, qty FROM paper_trades WHERE status = 'open'`);
const markExitPendingStmt = db.prepare(
  `UPDATE paper_trades SET exit_order_id = ?, status = 'exit_pending' WHERE date = ? AND ticker = ?`
);
const markExitFailedStmt = db.prepare(`UPDATE paper_trades SET status = 'exit_failed' WHERE date = ? AND ticker = ?`);

// Alpaca rejects a new buy order for a symbol while an opposite-direction
// order on that same symbol is still open/unsettled (a wash-trade guard) —
// confirmed in production on 2026-08-18, when CAT/META/XOM all failed to
// re-open with a 403 immediately after their same-run close order was
// submitted. Since picks recur across consecutive days often, check for
// any unresolved row on this ticker before attempting a new entry, instead
// of hitting that rejection repeatedly.
const unresolvedPositionStmt = db.prepare(
  `SELECT 1 FROM paper_trades WHERE ticker = ? AND status NOT IN ('closed', 'entry_failed', 'exit_failed') LIMIT 1`
);

const pendingExitsStmt = db.prepare(
  `SELECT date, ticker, entry_price, notional, direction, qty, exit_order_id FROM paper_trades WHERE status = 'exit_pending' AND exit_order_id IS NOT NULL`
);
const fillExitStmt = db.prepare(`
  UPDATE paper_trades
  SET exit_price = ?, exit_filled_at = ?, realized_pnl = ?, realized_pnl_pct = ?, status = 'closed'
  WHERE date = ? AND ticker = ?
`);

// ---- Orchestration — called once per nightly run, in this order ----

// Step 1: any buy order submitted last run should have filled at this
// morning's open by now (this pipeline runs after today's close). Pull the
// actual fill price rather than trusting anything computed locally.
export async function reconcileEntries() {
  const pending = pendingEntriesStmt.all();
  for (const row of pending) {
    try {
      const order = await getOrder(row.entry_order_id);
      if (order.status === "filled") {
        fillEntryStmt.run(Number(order.filled_avg_price), order.filled_at, Number(order.filled_qty), row.date, row.ticker);
        console.log(`paperTrade: entry filled — ${row.ticker} (${row.date}) @ $${order.filled_avg_price} (qty ${order.filled_qty})`);
      } else if (["canceled", "expired", "rejected"].includes(order.status)) {
        // Row already exists (this is a reconcile pass, not a fresh entry),
        // so ON CONFLICT DO UPDATE only touches status — but pass the
        // row's own existing values through rather than a placeholder, in
        // case that assumption ever changes.
        markEntryFailedStmt.run(row.date, row.ticker, row.notional, row.direction);
        console.warn(`paperTrade: entry order for ${row.ticker} (${row.date}) ended as "${order.status}", marking entry_failed.`);
      }
      // else still open/pending — leave as-is, will retry next run
    } catch (err) {
      console.error(`paperTrade: failed to reconcile entry for ${row.ticker} (${row.date}):`, describeError(err));
    }
  }
}

// Step 2: same logic for exit (closing) orders submitted last run.
export async function reconcileExits() {
  const pending = pendingExitsStmt.all();
  for (const row of pending) {
    try {
      const order = await getOrder(row.exit_order_id);
      if (order.status === "filled") {
        const exitPrice = Number(order.filled_avg_price);
        // Long: profit when price rises. Short: profit when price falls —
        // the sign just flips. qty comes from the entry fill (actual
        // shares/fractional-shares held), not re-derived from notional, so
        // this is correct for both the fractional-notional long case and
        // the whole-share short case. Fallback for positions opened before
        // qty tracking existed (pre-migration rows, all long): derive it
        // from notional/entry_price, which is exactly what the old formula
        // did implicitly — without this, those in-flight rows would
        // compute a NaN P&L against the new qty column being null.
        const qty = row.qty ?? row.notional / row.entry_price;
        const priceDelta = row.direction === "short" ? row.entry_price - exitPrice : exitPrice - row.entry_price;
        const pnl = priceDelta * qty;
        const pnlPct = (priceDelta / row.entry_price) * 100;
        fillExitStmt.run(exitPrice, order.filled_at, Number(pnl.toFixed(2)), Number(pnlPct.toFixed(2)), row.date, row.ticker);
        console.log(`paperTrade: exit filled — ${row.ticker} (${row.date}, ${row.direction}) @ $${exitPrice}, P&L $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
      } else if (["canceled", "expired", "rejected"].includes(order.status)) {
        markExitFailedStmt.run(row.date, row.ticker);
        console.warn(`paperTrade: exit order for ${row.ticker} (${row.date}) ended as "${order.status}", marking exit_failed.`);
      }
    } catch (err) {
      console.error(`paperTrade: failed to reconcile exit for ${row.ticker} (${row.date}):`, describeError(err));
    }
  }
}

// Step 3: any position currently 'open' has, by construction of the
// once-a-day cycle, already been held for one full session — close all of
// them. (Self-healing: if a previous run's close attempt failed and left a
// position stuck 'open', this will retry it too, not just today's batch.)
export async function closeMaturePositions() {
  const open = openPositionsStmt.all();
  for (const row of open) {
    try {
      const order = await closePosition(row.ticker);
      markExitPendingStmt.run(order.id, row.date, row.ticker);
      console.log(`paperTrade: close order submitted — ${row.ticker} (${row.date}, ${row.direction}), order ${order.id}`);
    } catch (err) {
      console.error(`paperTrade: failed to submit close order for ${row.ticker} (${row.date}):`, describeError(err));
      markExitFailedStmt.run(row.date, row.ticker);
    }
  }
}

// Step 4: open tonight's new positions, one per newly-flagged watchlist
// ticker. `items` is [{ticker, direction, confidence, eventRisk}] — all
// self-rated by Claude from its own read of each setup, not assumed.
// Position size is computed per-item (see config.js's computeNotional) from
// real evidence: low confidence, event risk, and short direction each cut
// the size, since the September checkpoint showed each one correlates with
// worse outcomes. `priceMap` is today's already-fetched closes, used only
// to size short orders (Alpaca requires whole-share qty for shorts, unlike
// the notional buys used for longs) — not used as the actual fill price,
// which still comes from the reconciled order itself.
export async function openNewPositions(date, items, priceMap = {}) {
  for (const item of items) {
    const ticker = item.ticker;
    const direction = item.direction === "short" ? "short" : "long"; // default long on any malformed/missing value
    const notional = computeNotional({ confidence: item.confidence, eventRisk: item.eventRisk, direction });
    if (unresolvedPositionStmt.get(ticker)) {
      console.log(`paperTrade: skipping re-entry — ${ticker} (${date}) already has an unresolved position from an earlier cycle.`);
      continue;
    }
    try {
      let order;
      if (direction === "short") {
        const estimatedPrice = priceMap[ticker];
        if (!estimatedPrice) {
          console.warn(`paperTrade: no price estimate available for ${ticker} (${date}), skipping short entry — can't size a whole-share qty without one.`);
          markEntryFailedStmt.run(date, ticker, notional, direction);
          continue;
        }
        order = await submitShortOrder(ticker, estimatedPrice, notional);
      } else {
        order = await submitBuyOrder(ticker, notional);
      }
      insertEntryStmt.run(date, ticker, order.id, notional, direction);
      console.log(`paperTrade: ${direction} order submitted — ${ticker} (${date}), order ${order.id}, $${notional} notional (confidence=${item.confidence ?? "?"}, eventRisk=${item.eventRisk ?? "?"})`);
    } catch (err) {
      console.error(`paperTrade: failed to submit ${direction} order for ${ticker} (${date}):`, describeError(err));
      markEntryFailedStmt.run(date, ticker, notional, direction);
    }
  }
}

// Runs the full nightly cycle in the correct order. Wrapped by the caller in
// try/catch so a paper-trading/Alpaca hiccup never blocks the actual brief
// from being generated and saved — that remains the priority output.
export async function runPaperTradingCycle(date, newWatchlistItems, priceMap) {
  await reconcileEntries();
  await reconcileExits();
  await closeMaturePositions();
  await openNewPositions(date, newWatchlistItems, priceMap);
}

import axios from "axios";
import { db } from "./db.js";
import { ALPACA_TRADING_BASE, computeNotional, PORTFOLIO_LIMITS } from "./config.js";
import { buildCloseOrder, isCrypto, positionPathSymbol, tradingHalted } from "./orders.js";

const headers = {
  "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID,
  "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY,
};

// ---- Alpaca paper trading API (zero real capital — paper-api.alpaca.markets only) ----

// Crypto symbols use Alpaca's "BASE/QUOTE" format (e.g. "BTC/USD"), the same
// /v2/orders endpoint as equities, but a DIFFERENT set of valid
// time_in_force values — crypto only accepts "gtc" or "ioc", never "day"
// (equities' day-order queue-until-market-close semantics don't apply to a
// market that never closes). Submitting "day" for a crypto symbol would be
// rejected outright, so this detects it via the presence of "/" rather than
// requiring every call site to know the distinction itself. (isCrypto now
// lives in src/orders.js so the pure close-order logic can share it.)

async function submitBuyOrder(symbol, notional) {
  const res = await axios.post(
    `${ALPACA_TRADING_BASE}/orders`,
    { symbol, notional: String(notional), side: "buy", type: "market", time_in_force: isCrypto(symbol) ? "gtc" : "day" },
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
  // positionPathSymbol: crypto positions are keyed "BTCUSD", not "BTC/USD".
  const res = await axios.delete(`${ALPACA_TRADING_BASE}/positions/${positionPathSymbol(symbol)}`, { headers });
  return res.data;
}

// Submits a fully-specified order (see src/orders.js's buildCloseOrder).
async function submitOrder(spec) {
  const res = await axios.post(`${ALPACA_TRADING_BASE}/orders`, spec, { headers });
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
  INSERT INTO paper_trades (date, ticker, entry_order_id, notional, direction, status, source)
  VALUES (?, ?, ?, ?, ?, 'entry_pending', ?)
  ON CONFLICT(date, ticker) DO UPDATE SET entry_order_id = excluded.entry_order_id, direction = excluded.direction, status = 'entry_pending', source = excluded.source
`);
const markEntryFailedStmt = db.prepare(`
  INSERT INTO paper_trades (date, ticker, notional, direction, status, source)
  VALUES (?, ?, ?, ?, 'entry_failed', ?)
  ON CONFLICT(date, ticker) DO UPDATE SET status = 'entry_failed'
`);
const fillEntryStmt = db.prepare(`
  UPDATE paper_trades SET entry_price = ?, entry_filled_at = ?, qty = ?, status = 'open'
  WHERE date = ? AND ticker = ?
`);
const pendingEntriesStmt = db.prepare(
  `SELECT date, ticker, entry_order_id, notional, direction FROM paper_trades WHERE status = 'entry_pending' AND entry_order_id IS NOT NULL`
);

// Excludes 'fund_hold'/'crypto_hold' (see config.js's FUND_ALLOCATION and
// the now-superseded CRYPTO_ALLOCATION comment) — those are buy-and-hold-
// indefinitely positions, never meant to be force-closed after one session
// the way nightly/on_demand/crypto_ondemand picks are. Added 2026-09-25
// alongside those allocations; without this exclusion, closeMaturePositions
// below would sell them the very next run. 'crypto_hold' is legacy-only as
// of 2026-09-26 (no new rows written with that source — see config.js) but
// stays in this exclusion list so any position already opened under it
// keeps being held rather than getting force-closed by this later change.
const openPositionsStmt = db.prepare(
  `SELECT date, ticker, entry_price, notional, direction, qty FROM paper_trades WHERE status = 'open' AND source NOT IN ('fund_hold', 'crypto_hold')`
);
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
//
// Excludes 'fund_hold'/'crypto_hold' (see config.js) — three of the five
// fund allocation tickers (SPY, QQQ, DIA) already appear in the main
// WATCHLIST, and once a fund_hold position opens it stays open indefinitely.
// Without this exclusion, that permanent row would read as "an unresolved
// position" here and silently block the nightly system from ever trading
// SPY/QQQ/DIA again. This is safe to exclude: the wash-trade risk this guard
// exists for is specifically about an OPPOSITE-direction order on a symbol
// mid-close; fund_hold/crypto_hold positions are always long and never
// closed, so they can coexist with a separate nightly long position on the
// same symbol without ever triggering that Alpaca-side conflict.
const unresolvedPositionStmt = db.prepare(
  `SELECT 1 FROM paper_trades WHERE ticker = ? AND source NOT IN ('fund_hold', 'crypto_hold') AND status NOT IN ('closed', 'entry_failed', 'exit_failed') LIMIT 1`
);

// Portfolio-level exposure check (see PORTFOLIO_LIMITS in config.js).
// exit_pending is deliberately included — a close order that hasn't filled
// yet still means the account is holding that position, so it still counts
// as capital at risk right up until reconciliation confirms the exit.
const currentExposureStmt = db.prepare(
  `SELECT COUNT(*) AS n, COALESCE(SUM(notional), 0) AS notional
   FROM paper_trades WHERE status IN ('entry_pending', 'open', 'exit_pending')`
);

// A buy-and-hold ('fund_hold'/'crypto_hold') position in this ticker that
// is still held in the account (any pre-close status). Used to keep the
// nightly/on-demand system from shorting or whole-symbol-closing a ticker
// the fund allocation holds; Alpaca nets long and short in one account.
const buyAndHoldHeldStmt = db.prepare(
  `SELECT 1 FROM paper_trades WHERE ticker = ? AND source IN ('fund_hold', 'crypto_hold')
   AND status IN ('entry_pending', 'open', 'exit_pending', 'exit_failed') LIMIT 1`
);
// The reverse: a live non-allocation SHORT in this ticker. A fund buy while
// it's open would silently cover the short instead of opening a holding.
const liveShortStmt = db.prepare(
  `SELECT 1 FROM paper_trades WHERE ticker = ? AND direction = 'short' AND source NOT IN ('fund_hold', 'crypto_hold')
   AND status IN ('entry_pending', 'open', 'exit_pending', 'exit_failed') LIMIT 1`
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
  if (tradingHalted()) {
    console.warn("paperTrade: TRADING_HALTED is on (kill switch) — closing positions skipped, nothing ordered.");
    return;
  }
  const open = openPositionsStmt.all();
  for (const row of open) {
    try {
      // Close by this row's own qty (src/orders.js), so a nightly close can
      // never liquidate a fund allocation's shares in the same ticker. The
      // whole-symbol fallback is only used where that can't happen.
      const spec = buildCloseOrder(row);
      if (!spec && buyAndHoldHeldStmt.get(row.ticker)) {
        console.warn(`paperTrade: can't safely close ${row.ticker} (${row.date}) — no recorded qty and a fund allocation holds this ticker; a whole-symbol close would sell it too. Marking exit_failed for manual review.`);
        markExitFailedStmt.run(row.date, row.ticker);
        continue;
      }
      const order = spec ? await submitOrder(spec) : await closePosition(row.ticker);
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
export async function openNewPositions(date, items, priceMap = {}, source = "nightly") {
  if (tradingHalted()) {
    console.warn("paperTrade: TRADING_HALTED is on (kill switch) — opening new positions skipped, nothing ordered.");
    return items.map((i) => ({ ticker: i.ticker, status: "halted" }));
  }
  // Snapshot current exposure once, then track it running as this batch
  // opens positions — each new order counts against the cap for the rest
  // of this same call, not just against what was already open before it
  // started (otherwise a single oversized batch could blow past the cap
  // in one pass since every item would see the same "before" snapshot).
  let { n: openCount, notional: openNotional } = currentExposureStmt.get();
  // Per-item outcome, returned to the caller (added 2026-09-26) so the
  // on-demand scripts can log exactly what happened to a request (see
  // saveBrief.js's logInvestRequest). The nightly caller ignores it.
  const results = [];

  for (const item of items) {
    const ticker = item.ticker;
    const direction = item.direction === "short" ? "short" : "long"; // default long on any malformed/missing value
    // notionalOverride lets a caller specify the exact dollar amount instead
    // of deriving it from the evidence-based SIZING_ADJUSTMENTS — used by
    // onDemandCrypto.js, where the USER picks the investment amount
    // ($25-$10,000, see CRYPTO_ONDEMAND_LIMITS) and Claude only decides
    // whether to invest at all, not how much. Everything else about this
    // function (wash-trade guard, portfolio caps, reconciliation) still
    // applies identically regardless of source.
    const notional = item.notionalOverride ?? computeNotional({ confidence: item.confidence, eventRisk: item.eventRisk, direction });
    if (unresolvedPositionStmt.get(ticker)) {
      console.log(`paperTrade: skipping re-entry — ${ticker} (${date}) already has an unresolved position from an earlier cycle.`);
      results.push({ ticker, status: "skipped_duplicate", notional });
      continue;
    }
    if (openCount + 1 > PORTFOLIO_LIMITS.maxConcurrentPositions || openNotional + notional > PORTFOLIO_LIMITS.maxTotalNotionalUsd) {
      console.warn(
        `paperTrade: skipping ${ticker} (${date}, source=${source}) — portfolio exposure cap reached ` +
        `(currently ${openCount} position(s), $${openNotional} deployed; limits: ${PORTFOLIO_LIMITS.maxConcurrentPositions} positions / $${PORTFOLIO_LIMITS.maxTotalNotionalUsd}). ` +
        `Not treated as a failure — no row written, this pick is simply not taken this cycle.`
      );
      results.push({ ticker, status: "skipped_cap", notional });
      continue;
    }
    if (direction === "short" && buyAndHoldHeldStmt.get(ticker)) {
      console.warn(`paperTrade: skipping short on ${ticker} (${date}, source=${source}) — a fund allocation holds this ticker, and Alpaca would net the short against it (selling the held shares) instead of opening a short.`);
      results.push({ ticker, status: "skipped_conflict", notional });
      continue;
    }
    try {
      let order;
      if (direction === "short") {
        const estimatedPrice = priceMap[ticker];
        if (!estimatedPrice) {
          console.warn(`paperTrade: no price estimate available for ${ticker} (${date}), skipping short entry — can't size a whole-share qty without one.`);
          markEntryFailedStmt.run(date, ticker, notional, direction, source);
          results.push({ ticker, status: "failed", notional, error: "no price estimate for short sizing" });
          continue;
        }
        order = await submitShortOrder(ticker, estimatedPrice, notional);
      } else {
        order = await submitBuyOrder(ticker, notional);
      }
      insertEntryStmt.run(date, ticker, order.id, notional, direction, source);
      openCount += 1;
      openNotional += notional;
      results.push({ ticker, status: "submitted", notional, orderId: order.id });
      console.log(`paperTrade: ${direction} order submitted — ${ticker} (${date}), order ${order.id}, $${notional} notional (confidence=${item.confidence ?? "?"}, eventRisk=${item.eventRisk ?? "?"}, source=${source})`);
    } catch (err) {
      console.error(`paperTrade: failed to submit ${direction} order for ${ticker} (${date}):`, describeError(err));
      markEntryFailedStmt.run(date, ticker, notional, direction, source);
      results.push({ ticker, status: "failed", notional, error: describeError(err) });
    }
  }
  return results;
}

// Fixed sentinel "date" value used only for buy-and-hold allocation rows
// (source='fund_hold'/'crypto_hold') instead of today's real calendar date.
// paper_trades' primary key is (date, ticker) — three of the five fund
// allocation tickers (SPY, QQQ, DIA) already appear in the nightly
// WATCHLIST, so if an allocation buy and a nightly pick ever landed on the
// same ticker on the same real date, they'd collide and one would silently
// overwrite the other via the INSERT...ON CONFLICT(date, ticker) upserts
// used throughout this file. Using a fixed, obviously-non-date string here
// instead guarantees that can never happen, with no schema migration and no
// changes needed to reconcileEntries/reconcileExits/closeMaturePositions —
// they all operate generically on whatever's in the date column. The real
// open timestamp is still captured normally, via entry_filled_at once the
// order fills.
const ALLOCATION_DATE = "allocation";

// Opens (once) a buy-and-hold allocation — either config.js's
// FUND_ALLOCATION or CRYPTO_ALLOCATION. Idempotent by design: checks for an
// existing unresolved-or-open row per (ticker, source) first and skips it,
// so re-running this (e.g. a second click of the dashboard's Invest button)
// never buys twice. Always long, never sized by SIZING_ADJUSTMENTS (that
// gate is stock-nightly-evidence-derived and doesn't apply here) — every
// position in a given allocation uses the same flat notionalPerPosition.
// 'closed' excluded too (2026-09-26): once a held position has been sold
// via sellHeldPosition below, buying the same ticker again is allowed. The
// sold row is re-keyed off ALLOCATION_DATE at sell time, so the new buy
// can't overwrite its realized P&L.
const allocationPositionStmt = db.prepare(
  `SELECT 1 FROM paper_trades WHERE ticker = ? AND source = ? AND status NOT IN ('entry_failed', 'closed') LIMIT 1`
);
export async function openAllocationPositions(symbols, notionalPerPosition, source) {
  if (tradingHalted()) {
    console.warn("paperTrade: TRADING_HALTED is on (kill switch) — allocation buys skipped, nothing ordered.");
    return symbols.map((ticker) => ({ ticker, status: "halted" }));
  }
  const results = [];
  for (const ticker of symbols) {
    if (allocationPositionStmt.get(ticker, source)) {
      console.log(`paperTrade: ${ticker} (${source}) already invested — skipping (allocation is buy-once).`);
      results.push({ ticker, status: "already_invested" });
      continue;
    }
    if (liveShortStmt.get(ticker)) {
      console.warn(`paperTrade: skipping allocation buy for ${ticker} (${source}) — a live short in this ticker exists, and the buy would cover it instead of opening a holding. Try again after it closes.`);
      results.push({ ticker, status: "blocked_by_short" });
      continue;
    }
    try {
      const order = await submitBuyOrder(ticker, notionalPerPosition);
      insertEntryStmt.run(ALLOCATION_DATE, ticker, order.id, notionalPerPosition, "long", source);
      console.log(`paperTrade: allocation buy submitted — ${ticker} (${source}), order ${order.id}, $${notionalPerPosition} notional`);
      results.push({ ticker, status: "submitted", orderId: order.id });
    } catch (err) {
      console.error(`paperTrade: allocation buy failed for ${ticker} (${source}):`, describeError(err));
      markEntryFailedStmt.run(ALLOCATION_DATE, ticker, notionalPerPosition, "long", source);
      results.push({ ticker, status: "failed", error: describeError(err) });
    }
  }
  return results;
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

// ---- Selling a held buy-and-hold position (added 2026-09-26) ----
//
// Powers the Mutual Funds tab's per-holding "Sell" button (see
// src/sellPosition.js). Simulated only: a paper-account sell, proceeds stay
// in the paper account. Nothing here moves real money.
//
// Deliberately NOT closePosition() above. DELETE /positions/{symbol}
// liquidates EVERY share of that symbol in the account, and SPY/QQQ/DIA can
// be held by both the fund allocation and a nightly pick at the same time.
// This submits a sell for exactly this row's own filled qty instead, so a
// fund sale can never touch a nightly position (or vice versa).
async function submitSellQtyOrder(symbol, qty) {
  const res = await axios.post(
    `${ALPACA_TRADING_BASE}/orders`,
    { symbol, qty: String(qty), side: "sell", type: "market", time_in_force: isCrypto(symbol) ? "gtc" : "day" },
    { headers }
  );
  return res.data;
}

// 'exit_failed' included so a sell that got canceled/expired can simply be
// retried with the same button (the shares are still held).
const heldAllocationStmt = db.prepare(
  `SELECT date, ticker, qty, notional FROM paper_trades
   WHERE ticker = ? AND source IN ('fund_hold', 'crypto_hold') AND status IN ('open', 'exit_failed')
   ORDER BY date LIMIT 1`
);
// Re-keys the row's date off the shared ALLOCATION_DATE sentinel at sell
// time (see allocationPositionStmt's comment) and marks it exit_pending.
// From there reconcileExits() handles the fill exactly like any other exit
// (it works generically on (date, ticker)) and books realized P&L.
const markAllocationSellPendingStmt = db.prepare(
  `UPDATE paper_trades SET date = ?, exit_order_id = ?, status = 'exit_pending' WHERE date = ? AND ticker = ?`
);

export async function sellHeldPosition(ticker) {
  if (tradingHalted()) {
    console.warn("paperTrade: TRADING_HALTED is on (kill switch) — sell skipped, nothing ordered.");
    return { ticker, status: "halted" };
  }
  const row = heldAllocationStmt.get(ticker);
  if (!row) return { ticker, status: "not_held" };
  if (!row.qty) return { ticker, status: "failed", error: "No filled quantity recorded for this position yet" };
  try {
    const order = await submitSellQtyOrder(ticker, row.qty);
    const newDate = row.date === ALLOCATION_DATE ? `${ALLOCATION_DATE}-sold-${new Date().toISOString()}` : row.date;
    markAllocationSellPendingStmt.run(newDate, order.id, row.date, ticker);
    console.log(`paperTrade: sell submitted — ${ticker}, qty ${row.qty}, order ${order.id} (row re-keyed ${row.date} -> ${newDate})`);
    return { ticker, status: "sell_submitted", orderId: order.id, qty: row.qty, notional: row.notional };
  } catch (err) {
    console.error(`paperTrade: sell failed for ${ticker}:`, describeError(err));
    return { ticker, status: "failed", error: describeError(err) };
  }
}

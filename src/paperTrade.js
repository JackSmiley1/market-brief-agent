import axios from "axios";
import { db } from "./db.js";
import { ALPACA_TRADING_BASE, PAPER_TRADE_NOTIONAL } from "./config.js";

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

// ---- DB statements ----

const insertEntryStmt = db.prepare(`
  INSERT INTO paper_trades (date, ticker, entry_order_id, notional, status)
  VALUES (?, ?, ?, ?, 'entry_pending')
  ON CONFLICT(date, ticker) DO UPDATE SET entry_order_id = excluded.entry_order_id, status = 'entry_pending'
`);
const markEntryFailedStmt = db.prepare(`
  INSERT INTO paper_trades (date, ticker, notional, status)
  VALUES (?, ?, ?, 'entry_failed')
  ON CONFLICT(date, ticker) DO UPDATE SET status = 'entry_failed'
`);
const fillEntryStmt = db.prepare(`
  UPDATE paper_trades SET entry_price = ?, entry_filled_at = ?, status = 'open'
  WHERE date = ? AND ticker = ?
`);
const pendingEntriesStmt = db.prepare(
  `SELECT date, ticker, entry_order_id FROM paper_trades WHERE status = 'entry_pending' AND entry_order_id IS NOT NULL`
);

const openPositionsStmt = db.prepare(`SELECT date, ticker, entry_price, notional FROM paper_trades WHERE status = 'open'`);
const markExitPendingStmt = db.prepare(
  `UPDATE paper_trades SET exit_order_id = ?, status = 'exit_pending' WHERE date = ? AND ticker = ?`
);
const markExitFailedStmt = db.prepare(`UPDATE paper_trades SET status = 'exit_failed' WHERE date = ? AND ticker = ?`);

const pendingExitsStmt = db.prepare(
  `SELECT date, ticker, entry_price, notional, exit_order_id FROM paper_trades WHERE status = 'exit_pending' AND exit_order_id IS NOT NULL`
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
        fillEntryStmt.run(Number(order.filled_avg_price), order.filled_at, row.date, row.ticker);
        console.log(`paperTrade: entry filled — ${row.ticker} (${row.date}) @ $${order.filled_avg_price}`);
      } else if (["canceled", "expired", "rejected"].includes(order.status)) {
        markEntryFailedStmt.run(row.date, row.ticker, PAPER_TRADE_NOTIONAL);
        console.warn(`paperTrade: entry order for ${row.ticker} (${row.date}) ended as "${order.status}", marking entry_failed.`);
      }
      // else still open/pending — leave as-is, will retry next run
    } catch (err) {
      console.error(`paperTrade: failed to reconcile entry for ${row.ticker} (${row.date}):`, err.message);
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
        const pnl = (exitPrice - row.entry_price) * (row.notional / row.entry_price);
        const pnlPct = ((exitPrice - row.entry_price) / row.entry_price) * 100;
        fillExitStmt.run(exitPrice, order.filled_at, Number(pnl.toFixed(2)), Number(pnlPct.toFixed(2)), row.date, row.ticker);
        console.log(`paperTrade: exit filled — ${row.ticker} (${row.date}) @ $${exitPrice}, P&L $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
      } else if (["canceled", "expired", "rejected"].includes(order.status)) {
        markExitFailedStmt.run(row.date, row.ticker);
        console.warn(`paperTrade: exit order for ${row.ticker} (${row.date}) ended as "${order.status}", marking exit_failed.`);
      }
    } catch (err) {
      console.error(`paperTrade: failed to reconcile exit for ${row.ticker} (${row.date}):`, err.message);
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
      console.log(`paperTrade: close order submitted — ${row.ticker} (${row.date}), order ${order.id}`);
    } catch (err) {
      console.error(`paperTrade: failed to submit close order for ${row.ticker} (${row.date}):`, err.message);
      markExitFailedStmt.run(row.date, row.ticker);
    }
  }
}

// Step 4: open tonight's new positions, one per newly-flagged watchlist ticker.
export async function openNewPositions(date, tickers) {
  for (const ticker of tickers) {
    try {
      const order = await submitBuyOrder(ticker, PAPER_TRADE_NOTIONAL);
      insertEntryStmt.run(date, ticker, order.id, PAPER_TRADE_NOTIONAL);
      console.log(`paperTrade: buy order submitted — ${ticker} (${date}), order ${order.id}, $${PAPER_TRADE_NOTIONAL} notional`);
    } catch (err) {
      console.error(`paperTrade: failed to submit buy order for ${ticker} (${date}):`, err.message);
      markEntryFailedStmt.run(date, ticker, PAPER_TRADE_NOTIONAL);
    }
  }
}

// Runs the full nightly cycle in the correct order. Wrapped by the caller in
// try/catch so a paper-trading/Alpaca hiccup never blocks the actual brief
// from being generated and saved — that remains the priority output.
export async function runPaperTradingCycle(date, newWatchlistTickers) {
  await reconcileEntries();
  await reconcileExits();
  await closeMaturePositions();
  await openNewPositions(date, newWatchlistTickers);
}

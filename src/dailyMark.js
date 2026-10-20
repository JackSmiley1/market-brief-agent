import "dotenv/config";
import { fetchMarketData } from "./fetchMarketData.js";
import { saveFundSnapshots, saveFundHoldingValueSnapshots } from "./saveBrief.js";
import { reconcileEntries, reconcileExits } from "./paperTrade.js";
import { db } from "./db.js";
import { FUND_WATCHLIST } from "./config.js";

// Daily price marks that used to ride along with the nightly brief (moved
// here 2026-10-20 when the daily strategy ended). No Claude calls: Alpaca
// prices only. Records any pending fills (e.g. a fund buy from the
// dashboard), the fund/index display prices, and the value of every
// buy-and-hold fund position. Run by the Long-Horizon workflow each weekday.

async function run() {
  await reconcileEntries();
  await reconcileExits();

  const fundData = await fetchMarketData(FUND_WATCHLIST.map((f) => f.ticker));
  // Label by the session the prices belong to, not today's date, so a
  // market holiday doesn't record yesterday's prices under a new date.
  const counts = {};
  for (const d of fundData) counts[d.barDate] = (counts[d.barDate] ?? 0) + 1;
  const date = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!date) { console.log("dailyMark: no fund prices returned; nothing saved."); return; }

  const labelByTicker = Object.fromEntries(FUND_WATCHLIST.map((f) => [f.ticker, f.label]));
  saveFundSnapshots(date, fundData, labelByTicker);
  console.log(`dailyMark: fund snapshots saved for ${date} (${fundData.length}/${FUND_WATCHLIST.length}).`);

  const holdings = db
    .prepare(`SELECT ticker, qty, notional FROM paper_trades WHERE source = 'fund_hold' AND status IN ('open', 'exit_pending', 'exit_failed')`)
    .all();
  if (holdings.length === 0) { console.log("dailyMark: no fund holdings to value."); return; }
  const prices = await fetchMarketData([...new Set(holdings.map((r) => r.ticker))]);
  const priceBy = Object.fromEntries(prices.map((d) => [d.symbol, d.close]));
  const rows = holdings
    .filter((r) => priceBy[r.ticker] != null && r.qty != null)
    .map((r) => ({ ticker: r.ticker, price: priceBy[r.ticker], qty: r.qty, costBasis: r.notional }));
  saveFundHoldingValueSnapshots(date, rows);
  console.log(`dailyMark: valued ${rows.length}/${holdings.length} fund holding(s) for ${date}.`);
}

run().catch((err) => {
  console.error("dailyMark failed:", err);
  process.exit(1);
});

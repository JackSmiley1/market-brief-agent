import "dotenv/config";
import { reconcileEntries, reconcileExits, sellHeldPosition } from "./paperTrade.js";
import { logInvestRequest } from "./saveBrief.js";

// Mutual Funds tab's per-holding "Sell" button (added 2026-09-26). Sells
// one held buy-and-hold position (source 'fund_hold') in the PAPER account
// at market, for exactly that position's own filled quantity (see
// paperTrade.js's sellHeldPosition for why it isn't a whole-symbol close).
// Realized P&L is booked by reconcileExits() once the sell fills: in this
// same run if it fills immediately, otherwise on the next run. Orders placed
// outside market hours fill at the next open.
//
// Simulated only. The proceeds stay in the paper account; nothing here can
// move real money (ALPACA_TRADING_BASE is hardcoded to paper-api).
//
// Usage:
//   node src/sellPosition.js VXUS

async function run() {
  const ticker = (process.argv[2] || "").trim().toUpperCase();
  if (!ticker) {
    console.error("Usage: node src/sellPosition.js TICKER");
    process.exit(1);
  }

  console.log(`Selling held position: ${ticker} (paper account, simulated).`);

  // Pick up any pending fills first, so a position whose buy just filled is
  // sellable and a previous sell's result is recorded.
  await reconcileEntries();
  await reconcileExits();

  const result = await sellHeldPosition(ticker);
  logInvestRequest({
    kind: "fund",
    ticker,
    amount: result.notional ?? null,
    outcome: result.status,
    detail: result.error ?? (result.qty ? `Sell ${result.qty} shares (cost basis $${result.notional})` : null),
  });

  if (result.status === "sell_submitted") {
    // An immediately-filled sell (market open) gets its P&L booked now
    // rather than waiting for the next run.
    await reconcileExits();
  }
  console.log(`Done: ${ticker} — ${result.status}${result.error ? ` (${result.error})` : ""}`);
}

run().catch((err) => {
  console.error("sellPosition failed:", err);
  process.exit(1);
});

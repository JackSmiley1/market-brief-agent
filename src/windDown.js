import "dotenv/config";
import { reconcileEntries, reconcileExits, closeMaturePositions } from "./paperTrade.js";
import { db } from "./db.js";

// One-time wind-down of the daily strategy (added 2026-10-20). No Claude
// calls. Records any pending fills, closes every open strategy position
// (stocks and crypto; fund_hold buy-and-hold positions are never touched),
// then waits and re-checks so the closing fills get recorded in the same
// run. Safe to run more than once: anything already closed is skipped.
// Respects the TRADING_HALTED kill switch (closeMaturePositions checks it).
//
// Usage: node src/windDown.js   (or the "Wind Down" workflow)

const remainingStmt = db.prepare(
  `SELECT date, ticker, direction, status FROM paper_trades
   WHERE source NOT IN ('fund_hold', 'crypto_hold') AND status IN ('entry_pending', 'open', 'exit_pending')
   ORDER BY date, ticker`
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log("Wind-down: recording pending fills, then closing every open strategy position.");
  await reconcileEntries();
  await reconcileExits();
  await closeMaturePositions();

  for (let i = 0; i < 10 && remainingStmt.all().length > 0; i++) {
    await sleep(30000);
    await reconcileEntries();
    await reconcileExits();
    await closeMaturePositions(); // closes anything that just filled on entry
  }

  const left = remainingStmt.all();
  if (left.length === 0) {
    console.log("Wind-down complete: no open, pending or closing strategy positions remain.");
  } else {
    console.log(`Wind-down: ${left.length} position(s) still waiting (usually the market is closed; they fill at the next open). Run this again after the open:`);
    console.table(left);
  }
}

run().catch((err) => {
  console.error("windDown failed:", err);
  process.exit(1);
});

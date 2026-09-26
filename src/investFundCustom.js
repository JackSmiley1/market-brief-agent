import "dotenv/config";
import { openAllocationPositions, reconcileEntries, reconcileExits } from "./paperTrade.js";
import { FUND_CUSTOM_LIMITS } from "./config.js";

// Mutual Funds tab's "invest in another fund" flow (added 2026-09-26) — same
// static, Claude-free, buy-and-hold logic as the fixed 5-fund
// FUND_ALLOCATION button (src/investAllocation.js), just for one
// user-supplied ticker and dollar amount instead of the fixed five.
// Deliberately reuses the SAME source ('fund_hold'), not a new one: this
// means a custom-ticker buy shows up in the existing "Current Fund
// Holdings" list, is excluded from closeMaturePositions/the nightly
// evidence analysis, and is idempotent per ticker (openAllocationPositions
// already skips whatever's already invested) — all with zero changes
// needed anywhere else.
//
// Usage:
//   node src/investFundCustom.js VXUS 500

async function run() {
  const ticker = (process.argv[2] || "").trim().toUpperCase();
  const amount = Number(process.argv[3]);

  if (!ticker || !Number.isFinite(amount)) {
    console.error("Usage: node src/investFundCustom.js TICKER AMOUNT");
    process.exit(1);
  }
  if (amount < FUND_CUSTOM_LIMITS.minUsd || amount > FUND_CUSTOM_LIMITS.maxUsd) {
    console.error(`Amount must be between $${FUND_CUSTOM_LIMITS.minUsd} and $${FUND_CUSTOM_LIMITS.maxUsd} (got $${amount}).`);
    process.exit(1);
  }

  console.log(`Running custom fund allocation: ${ticker} — $${amount}, source='fund_hold'.`);

  await reconcileEntries();
  await reconcileExits();

  const results = await openAllocationPositions([ticker], amount, "fund_hold");
  const [result] = results;
  console.log(`Done: ${ticker} — ${result.status}${result.error ? ` (${result.error})` : ""}`);
}

run().catch((err) => {
  console.error("investFundCustom failed:", err);
  process.exit(1);
});

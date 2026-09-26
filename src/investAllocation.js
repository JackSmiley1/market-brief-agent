import "dotenv/config";
import { openAllocationPositions, reconcileEntries, reconcileExits } from "./paperTrade.js";
import { FUND_ALLOCATION } from "./config.js";

// One-time (idempotent) buy-and-hold allocation trigger — the counterpart to
// onDemandTrade.js, but with no Claude call at all: this is a flat, static,
// long-only allocation (config.js's FUND_ALLOCATION), not an analysis. Safe
// to run repeatedly (e.g. a second dashboard button click, or a retry after
// a partial failure) — openAllocationPositions checks each ticker
// individually and skips whatever's already invested.
//
// 'crypto' was removed 2026-09-26 — the old fixed BTC/ETH-only allocation
// was replaced by src/onDemandCrypto.js (any coin, user-chosen amount,
// Claude-analyzed). See config.js's commented-out CRYPTO_ALLOCATION for the
// history. A custom (non-top-5) fund ticker goes through
// src/investFundCustom.js instead of here, since it takes a user-supplied
// ticker/amount rather than one of this file's fixed named allocations.
//
// Usage:
//   node src/investAllocation.js fund

const ALLOCATIONS = {
  fund: FUND_ALLOCATION,
};

async function run() {
  const type = process.argv[2];
  const allocation = ALLOCATIONS[type];
  if (!allocation) {
    console.error(`Usage: node src/investAllocation.js <${Object.keys(ALLOCATIONS).join("|")}>`);
    process.exit(1);
  }

  console.log(`Running ${type} allocation (${allocation.tickers ?? allocation.symbols}) — $${allocation.notionalPerPosition} each, source='${allocation.source}'.`);

  // Same reconcile-anything-pending step as onDemandTrade.js — source-
  // agnostic, so this also picks up any still-pending allocation entry from
  // an earlier attempt before opening new ones.
  await reconcileEntries();
  await reconcileExits();

  const symbols = allocation.tickers ?? allocation.symbols;
  const results = await openAllocationPositions(symbols, allocation.notionalPerPosition, allocation.source);

  const submitted = results.filter((r) => r.status === "submitted").length;
  const already = results.filter((r) => r.status === "already_invested").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`Done: ${submitted} submitted, ${already} already invested, ${failed} failed.`);
  if (failed > 0) {
    console.error("Some orders failed — see errors above. Not treated as a fatal exit; partial success is still saved.");
  }
}

run().catch((err) => {
  console.error("investAllocation failed:", err);
  process.exit(1);
});

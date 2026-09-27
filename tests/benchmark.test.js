// Tests for src/benchmarkMath.js — per-trade SPY comparison and summary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { benchmarkTrade, summarizeBenchmark, spyBuyAndHold } from "../src/benchmarkMath.js";

const bars = {
  "2026-08-18": { open: 500, close: 505 },
  "2026-08-19": { open: 505, close: 510 }, // SPY +1% open-to-open
  "2026-08-20": { open: 499.95, close: 500 }, // SPY -1% from 08-19 open
};
const t = (o) => ({ notional: 1000, entry_filled_at: "2026-08-18T13:30:01Z", exit_filled_at: "2026-08-19T13:30:26Z", ...o });

test("long trade: SPY same-window return, same-dollars P&L, market-adjusted = trade - SPY", () => {
  const bm = benchmarkTrade(t({ direction: "long", realized_pnl_pct: 3 }), bars);
  assert.deepEqual(bm, { spyPct: 1, spyPnl: 10, marketAdjustedPct: 2 });
});

test("short trade: market-adjusted = trade + SPY (a falling market helps a short for free)", () => {
  const bm = benchmarkTrade(
    t({ direction: "short", realized_pnl_pct: 0.5, entry_filled_at: "2026-08-19T13:30Z", exit_filled_at: "2026-08-20T13:30Z" }),
    bars
  );
  assert.equal(bm.spyPct, -1);
  assert.equal(bm.marketAdjustedPct, -0.5); // made 0.5% while the market handed shorts 1%
});

test("missing bar on either end excludes the trade instead of zero-filling", () => {
  assert.equal(benchmarkTrade(t({ direction: "long", realized_pnl_pct: 1, exit_filled_at: "2026-08-21T13:30Z" }), bars), null);
  const s = summarizeBenchmark([t({ direction: "long", realized_pnl: 30, realized_pnl_pct: 3 }), t({ direction: "long", realized_pnl: 5, realized_pnl_pct: 0.5, exit_filled_at: null })], bars);
  assert.equal(s.n, 1);
  assert.equal(s.excluded, 1);
  assert.equal(s.strategyPnl, 30);
  assert.equal(s.spySameDollarsPnl, 10);
});

test("summary splits long/short and gives a CI once n >= 2", () => {
  const s = summarizeBenchmark(
    [t({ direction: "long", realized_pnl: 30, realized_pnl_pct: 3 }), t({ direction: "long", realized_pnl: 10, realized_pnl_pct: 1 })],
    bars
  );
  assert.equal(s.marketAdjustedAvgPct, 1); // (2 + 0) / 2
  assert.equal(s.long.n, 2);
  assert.equal(s.short.n, 0);
  assert.ok(Array.isArray(s.marketAdjustedCi95));
});

test("buy-and-hold runs from the first open on/after the start day to the latest close", () => {
  assert.deepEqual(spyBuyAndHold(bars, "2026-08-17"), { from: "2026-08-18", to: "2026-08-20", pct: 0 });
});

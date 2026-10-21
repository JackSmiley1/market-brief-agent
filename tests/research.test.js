// Tests for worker/research/researchMath.js (the research Worker's math).
import { test } from "node:test";
import assert from "node:assert/strict";
import { periodReturns, riskStats, relativeReturns, resolveCrypto } from "../worker/research/researchMath.js";

// Daily bars from 2020-01-01 to 2026-10-20, price rising 0.05% a day.
function makeBars(startIso, days, startPrice = 100, drift = 0.0005) {
  const out = []; let p = startPrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(Date.parse(startIso + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);
    out.push({ t, c: p, v: 1000 + i }); p *= 1 + drift;
  }
  return out;
}

test("returns use the close on or before each window start", () => {
  const bars = makeBars("2020-01-01", 2485);
  const r = periodReturns(bars);
  assert.equal(r.asOf, bars.at(-1).t);
  assert.equal(r.d1.fromDate, bars.at(-2).t);
  assert.ok(Math.abs(r.d1.pct - 0.05) < 0.01);
  assert.equal(r.d10.fromDate, bars.at(-11).t);
  assert.ok(r.y5 && r.y5.annualizedPct > 0);
  assert.equal(r.ytd.fromDate.slice(5), "12-31");
});

test("windows longer than the history are null, never estimated", () => {
  const r = periodReturns(makeBars("2026-01-01", 200));
  assert.equal(r.y1, null);
  assert.equal(r.y5, null);
  assert.ok(r.d30);
});

test("risk stats: drawdown and distance from high", () => {
  const bars = makeBars("2025-01-01", 400);
  bars.at(-1).c = bars.at(-2).c * 0.8; // a 20% drop on the last day
  const s = riskStats(bars);
  assert.ok(s.maxDrawdownPct <= -19.9 && s.maxDrawdownPct >= -20.1);
  assert.ok(s.fromHighPct < -19);
  assert.ok(s.volatilityPct > 0);
});

test("relative returns are percentage-point differences", () => {
  const a = { d1: { pct: 2 }, d10: { pct: 5 }, d30: null, ytd: { pct: 1 }, y1: { pct: 10 }, y5: null };
  const b = { d1: { pct: 1 }, d10: { pct: 6 }, d30: { pct: 3 }, ytd: { pct: 1 }, y1: { pct: 12 }, y5: null };
  assert.deepEqual(relativeReturns(a, b), { d1: 1, d10: -1, d30: null, ytd: 0, y1: -2, y5: null });
});

test("crypto names resolve to Alpaca pairs", () => {
  assert.equal(resolveCrypto("bitcoin"), "BTC/USD");
  assert.equal(resolveCrypto("sol"), "SOL/USD");
  assert.equal(resolveCrypto("ETH/USD"), "ETH/USD");
  assert.equal(resolveCrypto("dogeusdt"), "DOGE/USD");
});

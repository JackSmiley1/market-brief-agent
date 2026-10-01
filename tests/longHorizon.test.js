// Tests for src/longHorizonMath.js (long-horizon track valuation + tracking).
import { test } from "node:test";
import assert from "node:assert/strict";
import { impliedAnnualReturn, revenueNowFrom, pickTop, portfolioSeries } from "../src/longHorizonMath.js";

test("implied return: flat business priced at the exit multiple returns ~0%", () => {
  // revenue 1000, 10% margin -> earnings 100; 18x = 1800 market cap; no growth
  assert.equal(impliedAnnualReturn({ revenueNowM: 1000, marketCapM: 1800, cagrPct: 0, marginPct: 10 }), 0);
});

test("implied return: growth raises it, a richer price lowers it", () => {
  const base = { revenueNowM: 1000, marketCapM: 1800, marginPct: 10 };
  assert.ok(impliedAnnualReturn({ ...base, cagrPct: 10 }) > 9.9);
  assert.ok(impliedAnnualReturn({ ...base, cagrPct: 0, marketCapM: 3600 }) < -12);
});

test("implied return: forecast losses rank last; missing inputs give null", () => {
  assert.equal(impliedAnnualReturn({ revenueNowM: 1000, marketCapM: 1800, cagrPct: 5, marginPct: -3 }), -100);
  assert.equal(impliedAnnualReturn({ revenueNowM: null, marketCapM: 1800, cagrPct: 5, marginPct: 10 }), null);
});

test("current revenue from P/S, else revenue per share x shares, else null", () => {
  assert.equal(revenueNowFrom({ psTTM: 4 }, { marketCapitalization: 4000 }), 1000);
  assert.equal(revenueNowFrom({ revenuePerShareTTM: 10 }, { shareOutstanding: 50 }), 500);
  assert.equal(revenueNowFrom({}, {}), null);
});

test("pickTop sorts by implied return and skips nulls", () => {
  const top = pickTop([{ symbol: "A", impliedReturn: 5 }, { symbol: "B", impliedReturn: 12 }, { symbol: "C", impliedReturn: null }], 2);
  assert.deepEqual(top.map((r) => r.symbol), ["B", "A"]);
});

test("portfolioSeries: equal weight from the entry open, vs SPY, chained across a rebalance", () => {
  const bars = {
    SPY: { "2026-01-02": { open: 100, close: 101 }, "2026-01-05": { open: 101, close: 102 }, "2026-04-01": { open: 110, close: 110 }, "2026-04-02": { open: 110, close: 121 } },
    A: { "2026-01-02": { open: 10, close: 11 }, "2026-01-05": { open: 11, close: 12 } },
    B: { "2026-01-02": { open: 20, close: 20 }, "2026-01-05": { open: 20, close: 20 } },
    C: { "2026-04-01": { open: 50, close: 50 }, "2026-04-02": { open: 50, close: 55 } },
  };
  const s = portfolioSeries([{ startDate: "2026-01-02", symbols: ["A", "B"] }, { startDate: "2026-04-01", symbols: ["C"] }], bars);
  assert.deepEqual(s.at(0), { date: "2026-01-02", portfolioPct: 5, spyPct: 1 });
  assert.deepEqual(s.at(1), { date: "2026-01-05", portfolioPct: 10, spyPct: 2 });
  // period 1 ended +10% (A 12/10, B flat), SPY +2%; period 2: C +10%, SPY +10%
  assert.deepEqual(s.at(-1), { date: "2026-04-02", portfolioPct: 21, spyPct: 12.2 });
});

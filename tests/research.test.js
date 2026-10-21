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

import { fundHint, MUTUAL_TO_ETF } from "../worker/research/researchMath.js";

test("fund families get ETF suggestions instead of an error", () => {
  assert.ok(fundHint("vanguard").some((s) => s.startsWith("VOO")));
  assert.ok(fundHint("Vanguard funds"));
  assert.equal(fundHint("VOO"), null);
});

test("popular mutual fund share classes map to an ETF on the same index", () => {
  assert.equal(MUTUAL_TO_ETF.VFIAX, "VOO");
  assert.equal(MUTUAL_TO_ETF.VTSAX, "VTI");
  assert.equal(MUTUAL_TO_ETF.FXAIX, "IVV");
});

import { verifyReport } from "../worker/research/researchMath.js";

const QUOTE = {
  symbol: "AAPL", returns: { last: 248.97, d1: { pct: 0.5, fromClose: 247.73 }, d10: { pct: 2.07 }, y5: { pct: 60.69, annualizedPct: 9.95 } },
  benchmark: { symbol: "SPY", returns: { d10: { pct: 1.1 } }, diff: { d10: 0.97 } },
  stats: { volatilityPct: 24.3, maxDrawdownPct: -5.9, volumeVsAvg: 1.42 },
  profile: { marketCapM: 3497000 }, metrics: { peTTM: 31.2 }, series: [["2026-01-01", 1]],
};

test("figures that match the data (with rounding and hedges) are verified", () => {
  const r = { headline: "Apple rose 2.1% over 10 days, about 1 percentage point ahead of SPY.", today: "It closed at $248.97, up 0.5%.",
    longRun: "Over five years it gained roughly 61%, or 9.95% a year, with a 5.9% drawdown and 24.3% volatility.",
    vsMarket: "Volume ran 1.42x normal; the P/E is 31.2x and the market cap is about $3.5 trillion.", drivers: [], risks: [], watch: [] };
  const v = verifyReport(r, QUOTE, { company: [], market: [] });
  assert.equal(v.status, "verified", JSON.stringify(v.unmatched));
  assert.ok(v.checked >= 10);
});

test("a figure that appears nowhere in the data or news is flagged with its sentence", () => {
  const r = { headline: "Apple jumped 7.4% this week.", drivers: ["Revenue grew 12% per Reuters"], risks: [], watch: [] };
  const v = verifyReport(r, QUOTE, { company: [{ headline: "Apple revenue grows 12%", summary: "" }], market: [] });
  assert.equal(v.status, "unmatched");
  assert.deepEqual(v.unmatched.map((u) => u.figure), ["7.4%"]);
  assert.ok(v.unmatched[0].context.includes("jumped"));
});

test("a report with no figures says so instead of claiming verification", () => {
  assert.equal(verifyReport({ headline: "Quiet day.", drivers: [] }, QUOTE, {}).status, "no-figures");
});

import { reportSession, reportKey } from "../worker/research/researchMath.js";

test("a midday stock lookup gets an hourly intraday report", () => {
  const now = new Date("2026-10-21T15:12:00Z"); // 11:12 AM ET, Wednesday
  const s = reportSession("stock", "2026-10-21", now);
  assert.equal(s.phase, "intraday");
  assert.equal(reportKey("stock", "AMZN", s), "rep:2026-10-21:stock:AMZN:i11");
  assert.notEqual(reportKey("stock", "AMZN", reportSession("stock", "2026-10-21", new Date("2026-10-21T16:05:00Z"))), reportKey("stock", "AMZN", s));
});

test("after 4:20 PM ET, and the next morning before the open, it's the same closing report", () => {
  const evening = reportSession("stock", "2026-10-21", new Date("2026-10-21T21:00:00Z"));
  const nextMorning = reportSession("stock", "2026-10-21", new Date("2026-10-22T12:00:00Z")); // 8 AM ET, prices still Oct 21
  assert.equal(evening.phase, "closing");
  assert.equal(reportKey("fund", "VOO", evening), reportKey("fund", "VOO", nextMorning));
  assert.equal(reportSession("stock", "2026-10-21", new Date("2026-10-21T20:10:00Z")).phase, "intraday"); // 4:10 PM ET: delayed feed hasn't reached the close
});

test("weekends are closing reports for Friday's session; crypto is hourly", () => {
  assert.equal(reportSession("stock", "2026-10-23", new Date("2026-10-24T16:00:00Z")).phase, "closing");
  const c = reportSession("crypto", "2026-10-24", new Date("2026-10-24T16:30:00Z"));
  assert.equal(c.phase, "crypto");
  assert.equal(reportKey("crypto", "BTC/USD", c), "rep:2026-10-24:crypto:BTC/USD:h16");
});

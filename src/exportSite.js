import "dotenv/config";
import fs from "fs";
import path from "path";
import { db } from "./db.js";
import { PAPER_TRADE_BASE_NOTIONAL, SIZING_ADJUSTMENTS, PORTFOLIO_LIMITS, WATCHLIST as WATCHLIST_FOR_CHECK } from "./config.js";
import { aggregateTrades } from "./stats.js";
import { benchmarkTrade, summarizeBenchmark, spyBuyAndHold } from "./benchmarkMath.js";
import { tradingHalted } from "./orders.js";
import { portfolioSeries } from "./longHorizonMath.js";

// Turns logs/brief-data.db into a single static JSON file the dashboard
// (docs/index.html) fetches client-side. Runs nightly in CI right after the
// brief itself, so the public site and the private db never drift apart by
// more than one trading day. Deliberately conservative about what it
// reports: real numbers only, no smoothing/cherry-picking, and every
// small-sample bucket is labeled as such rather than presented flat — the
// dashboard is a portfolio artifact, and an inflated or misleading number
// here is a bigger liability than an honest "not enough data yet" one.
const MIN_N = 20;

function summarize(rows) {
  const agg = aggregateTrades(rows);
  if (!agg) return null;
  // Reproduces this function's exact prior output shape (rounded fields,
  // avgReturnPct naming, meetsMinN) — see stats.js's comment for why the
  // shared function itself stays unrounded and unopinionated.
  return {
    n: agg.n,
    totalPnl: Number(agg.totalPnl.toFixed(2)),
    totalNotional: agg.totalNotional,
    avgReturnPct: Number(agg.avgPnlPct.toFixed(3)),
    winRatePct: Number(agg.winRatePct.toFixed(1)),
    meetsMinN: agg.n >= MIN_N,
  };
}

// Nightly/systematic trades only — see checkpoint.js for why on_demand
// trades (ad hoc, user-prompted, see onDemandTrade.js) are excluded from
// this analysis rather than blended in.
const closed = db
  .prepare(
    `SELECT p.date, p.ticker, p.direction, p.notional, p.realized_pnl, p.realized_pnl_pct, p.entry_filled_at, p.exit_filled_at,
            w.confidence, w.event_risk, w.peer_catalyst
     FROM paper_trades p
     LEFT JOIN watchlist_followups w ON p.date = w.date AND p.ticker = w.ticker
     WHERE p.status = 'closed' AND p.source = 'nightly'
     ORDER BY COALESCE(p.exit_filled_at, p.date)`
  )
  .all();

// Current portfolio exposure right now, regardless of source — same query
// paperTrade.js's cap check uses, so the dashboard shows exactly what the
// live enforcement sees, not a separately-computed approximation of it.
const currentExposure = db
  .prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(notional), 0) AS notional
     FROM paper_trades WHERE status IN ('entry_pending', 'open', 'exit_pending')`
  )
  .get();

// Reflexion-style lessons (see reflect.js / the `lessons` table) — a
// natural-language complement to the numeric sizing rules above, synthesized
// periodically from batches of the system's own losing trades. Surfaced
// publicly (not just fed into the prompt) because it's genuinely evidence of
// the system reviewing and learning from its own mistakes, which is exactly
// the kind of thing a portfolio dashboard should show rather than hide.
const lessons = db
  .prepare(
    `SELECT id, created_at, based_on_trade_count, lesson_text
     FROM lessons ORDER BY id DESC LIMIT 10`
  )
  .all()
  .map((l) => ({
    id: l.id,
    createdAt: l.created_at,
    basedOnTradeCount: l.based_on_trade_count,
    lessonText: l.lesson_text,
  }));

// Includes 'crypto_ondemand' (added 2026-09-26 — see onDemandCrypto.js)
// alongside the original stock 'on_demand' source: both are one-session,
// Claude-analyzed, dashboard-triggered trades, just for different asset
// classes, so they share this same "On-Demand Trades" list rather than
// needing a separate crypto-specific section. `source` is exposed per row
// so the dashboard can badge crypto trades distinctly if it wants to.
const onDemandClosed = db
  .prepare(
    `SELECT date, ticker, direction, realized_pnl, realized_pnl_pct, exit_filled_at, source
     FROM paper_trades WHERE status = 'closed' AND source IN ('on_demand', 'crypto_ondemand', 'nightly_crypto')
     ORDER BY COALESCE(exit_filled_at, date) DESC LIMIT 20`
  )
  .all();

// Positions submitted but not yet closed — without this, a trade triggered
// from the dashboard is invisible for a full trading cycle (order queues
// after-hours, fills at next open, closes the session after that). Shown
// separately on the dashboard as "pending" so a trigger produces immediate
// visible feedback instead of apparent silence.
const onDemandPending = db
  .prepare(
    `SELECT date, ticker, direction, status, notional, source
     FROM paper_trades WHERE source IN ('on_demand', 'crypto_ondemand', 'nightly_crypto') AND status != 'closed'
     ORDER BY date DESC LIMIT 20`
  )
  .all();

// Nightly automated crypto track record (added 2026-09-26 — see
// cryptoNightly.js) — its own evidence pool, completely separate from the
// stock 'nightly' summary above and never blended with it. Reuses the same
// summarize()/aggregateTrades helper so the numbers are computed identically
// (rounding, win-rate math) to every other bucket on this dashboard.
const cryptoNightlyClosed = db
  .prepare(
    `SELECT date, ticker, direction, notional, realized_pnl, realized_pnl_pct, exit_filled_at
     FROM paper_trades WHERE status = 'closed' AND source = 'nightly_crypto'
     ORDER BY COALESCE(exit_filled_at, date)`
  )
  .all();
const cryptoNightlySummary = summarize(cryptoNightlyClosed);

// Crypto equity curve — same cumulative-P&L-over-closed-trades shape as the
// stock equityCurve below, but combining BOTH crypto sources ('crypto_ondemand'
// button-triggered and 'nightly_crypto' automated) into one chronological
// line, since the user wants to see "the agent's investments and any
// miscellaneous investments" together on one graph. `source` is carried per
// point so the dashboard can badge which kind each point is, same as the
// "Recent Crypto Trades" list already does.
const cryptoClosedForCurve = db
  .prepare(
    `SELECT date, ticker, direction, realized_pnl, realized_pnl_pct, exit_filled_at, source
     FROM paper_trades WHERE status = 'closed' AND source IN ('crypto_ondemand', 'nightly_crypto')
     ORDER BY COALESCE(exit_filled_at, date)`
  )
  .all();
let cryptoCumulative = 0;
const cryptoEquityCurve = cryptoClosedForCurve.map((r) => {
  cryptoCumulative += r.realized_pnl;
  return {
    date: r.exit_filled_at ? r.exit_filled_at.slice(0, 10) : r.date,
    ticker: r.ticker,
    direction: r.direction,
    source: r.source,
    tradePnl: Number(r.realized_pnl.toFixed(2)),
    tradePnlPct: r.realized_pnl_pct,
    cumulativePnl: Number(cryptoCumulative.toFixed(2)),
  };
});

const overallSummary = summarize(closed);

// Directional accuracy is a separate metric from P&L — whether the flagged
// thesis played out, independent of position size. Reported alongside P&L
// specifically because the two can (and currently do) diverge; showing only
// one would misrepresent the system in either an overly flattering or overly
// harsh direction.
//
// CHANGED 2026-09-27: this used to be Claude's own verdict word
// ("played_out" / "partial" / "missed") on its own calls, which turned out
// to be generous: 68% "played out" vs. 54% of calls where the price actually
// moved the called way, with 23 "played out" verdicts on moves in the wrong
// direction. The headline figure is now PRICE-CHECKED: the sign of the
// code-computed next-day move (result_pct_change) vs. the trade's direction.
// Claude's self-grade is still reported, separately and labeled, so the gap
// stays visible. Stock calls only (crypto tickers contain "/").
const priceChecked = db
  .prepare(
    `SELECT w.result_pct_change AS r, p.direction AS d
     FROM watchlist_followups w
     JOIN paper_trades p ON p.date = w.date AND p.ticker = w.ticker AND p.source = 'nightly'
     WHERE w.ticker NOT LIKE '%/%' AND w.result_pct_change IS NOT NULL AND p.direction IS NOT NULL`
  )
  .all();
const signed = (r, d) => (d === "short" ? -r : r);
const resolvedN = priceChecked.length;
const directionalHits = priceChecked.filter((x) => signed(x.r, x.d) > 0).length;
const directionalHitRatePct = resolvedN > 0 ? Number(((directionalHits / resolvedN) * 100).toFixed(1)) : null;
// Normal-approximation 95% range for a proportion, in percentage points.
const directionalCi95 = resolvedN > 1
  ? (() => { const ph = directionalHits / resolvedN, h = 1.96 * Math.sqrt((ph * (1 - ph)) / resolvedN); return [Number(((ph - h) * 100).toFixed(1)), Number(((ph + h) * 100).toFixed(1))]; })()
  : null;

const selfGraded = db
  .prepare(`SELECT outcome FROM watchlist_followups WHERE ticker NOT LIKE '%/%' AND outcome IN ('played_out', 'partial', 'missed')`)
  .all();
const selfGradeN = selfGraded.length;
const selfGradePct = selfGradeN > 0 ? Number(((selfGraded.filter((x) => x.outcome === "played_out").length / selfGradeN) * 100).toFixed(1)) : null;

// Equity curve: cumulative realized P&L over time, one point per closed trade
// in resolution order. This is a paper-trading curve on simulated capital,
// labeled as such on the dashboard — never presented as real returns.
// Carries ticker/direction/per-trade P&L too (not just the cumulative line)
// so the dashboard can show a real tooltip per point instead of just "trade
// #12" with no context.
let cumulative = 0;
let peak = 0;
let maxDrawdown = 0;
// SPY benchmark (see src/benchmarkMath.js and db.js's benchmark_bars).
// Empty until src/fetchBenchmark.js has run at least once in production.
const spyBars = Object.fromEntries(
  db.prepare(`SELECT date, open, close FROM benchmark_bars WHERE symbol = 'SPY'`).all().map((b) => [b.date, { open: b.open, close: b.close }])
);
const benchmark = {
  symbol: "SPY",
  ...summarizeBenchmark(closed, spyBars),
  buyAndHold: closed.length ? spyBuyAndHold(spyBars, closed.map((r) => r.entry_filled_at?.slice(0, 10) ?? r.date).sort()[0]) : null,
};
let spyCumulative = 0;
let spyCurveBroken = false; // once any trade lacks bars, stop drawing the SPY line rather than draw a wrong one

const equityCurve = closed.map((r) => {
  cumulative += r.realized_pnl;
  const bm = benchmarkTrade(r, spyBars);
  if (!bm) spyCurveBroken = true;
  else spyCumulative += bm.spyPnl;
  peak = Math.max(peak, cumulative);
  maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  return {
    date: r.exit_filled_at ? r.exit_filled_at.slice(0, 10) : r.date,
    ticker: r.ticker,
    direction: r.direction,
    tradePnl: Number(r.realized_pnl.toFixed(2)),
    tradePnlPct: r.realized_pnl_pct,
    cumulativePnl: Number(cumulative.toFixed(2)),
    spyCumulativePnl: spyCurveBroken ? null : Number(spyCumulative.toFixed(2)),
  };
});

function bucketRows(keyFn, labels) {
  return labels
    .map((label) => ({ label, ...summarize(closed.filter((r) => keyFn(r) === label)) }))
    .filter((b) => b.n); // drop empty buckets rather than showing a misleading zero row
}

const buckets = {
  direction: bucketRows((r) => r.direction ?? "long", ["long", "short"]),
  confidence: bucketRows((r) => r.confidence, ["high", "medium", "low"]),
  eventRisk: bucketRows((r) => (r.event_risk === 1 ? "event_risk" : r.event_risk === 0 ? "no_event_risk" : null), [
    "event_risk",
    "no_event_risk",
  ]),
};

// Shorts-only, tracked-not-enforced hypothesis (added 2026-09-25 — see the
// peer_catalyst comment in db.js). Reported on its own so it's clearly
// scoped to shorts rather than implying it's been validated for longs too.
const shortsOnly = closed.filter((r) => (r.direction ?? "long") === "short");
const peerCatalystBuckets = [
  { label: "peer_catalyst", ...summarize(shortsOnly.filter((r) => r.peer_catalyst === 1)) },
  { label: "isolated_unconfirmed", ...summarize(shortsOnly.filter((r) => r.peer_catalyst === 0)) },
].filter((b) => b.n);
if (peerCatalystBuckets.length) buckets.peerCatalystShorts = peerCatalystBuckets;

// Per-ticker breakdown (n>=3 — below that it's one or two trades, not a
// pattern). This already existed in checkpoint.js's console output but was
// never surfaced on the dashboard itself; it's genuinely useful ("which
// names has this actually been right about") and belongs alongside the
// other sizing-lever breakdowns.
const byTickerMap = {};
for (const r of closed) (byTickerMap[r.ticker] ??= []).push(r);
const byTicker = Object.entries(byTickerMap)
  .map(([ticker, rows]) => ({ label: ticker, ...summarize(rows) }))
  .filter((t) => t.n >= 3)
  .sort((a, b) => b.avgReturnPct - a.avgReturnPct);

// Best/worst single trade and current streak — cheap, real, genuinely
// informative numbers that were being computed locally (computePnL.js) but
// never made it to the public dashboard.
const bestTrade = closed.length
  ? [...closed].sort((a, b) => b.realized_pnl_pct - a.realized_pnl_pct)[0]
  : null;
const worstTrade = closed.length
  ? [...closed].sort((a, b) => a.realized_pnl_pct - b.realized_pnl_pct)[0]
  : null;

let currentStreak = 0;
let streakType = null;
for (let i = closed.length - 1; i >= 0; i--) {
  const isWin = closed[i].realized_pnl > 0;
  if (streakType === null) {
    streakType = isWin ? "win" : "loss";
    currentStreak = 1;
  } else if ((isWin && streakType === "win") || (!isWin && streakType === "loss")) {
    currentStreak += 1;
  } else {
    break;
  }
}

// Buy-and-hold allocation positions (see config.js's FUND_ALLOCATION/
// CRYPTO_ALLOCATION and paperTrade.js's openAllocationPositions) — reported
// regardless of status (pending fill, open/held, or failed) so the Mutual
// Funds/Crypto tabs can show real state ("submitted, not filled yet" looks
// different from "held") rather than only ever showing closed history like
// onDemand above (these positions are never meant to close).
function loadHoldings(source) {
  return db
    .prepare(
      `SELECT ticker, notional, status, entry_price, entry_filled_at, qty
       FROM paper_trades WHERE source = ? AND status != 'closed' ORDER BY ticker`
    )
    .all(source)
    .map((r) => {
      // Latest nightly mark-to-market for this ticker (see
      // fund_holding_value_snapshots) — null until the first snapshot after
      // the buy fills. Powers the per-holding value/unrealized P&L display.
      // Only attach a snapshot taken on/after THIS position's fill, and only
      // for a filled position, so a re-bought ticker never shows the
      // previous (sold) position's value.
      const filledDay = r.entry_filled_at ? r.entry_filled_at.slice(0, 10) : null;
      const rawSnap = ["open", "exit_pending", "exit_failed"].includes(r.status) ? latestHoldingSnapStmt.get(r.ticker) : null;
      const snap = rawSnap && (!filledDay || rawSnap.date >= filledDay) ? rawSnap : null;
      return {
        ticker: r.ticker,
        notional: r.notional,
        status: r.status,
        entryPrice: r.entry_price,
        entryFilledAt: r.entry_filled_at,
        qty: r.qty,
        marketValue: snap?.market_value ?? null,
        unrealizedPnl: snap?.unrealized_pnl ?? null,
        unrealizedPnlPct: snap?.unrealized_pnl_pct ?? null,
        valueAsOf: snap?.date ?? null,
      };
    });
}
const latestHoldingSnapStmt = db.prepare(
  `SELECT date, market_value, unrealized_pnl, unrealized_pnl_pct FROM fund_holding_value_snapshots
   WHERE ticker = ? ORDER BY date DESC LIMIT 1`
);

// Sold buy-and-hold positions (see paperTrade.js's sellHeldPosition) —
// realized P&L from the actual sell fill, newest first, plus the running
// total shown as "Realized gains" on the Mutual Funds tab. Simulated only.
const fundSold = db
  .prepare(
    `SELECT ticker, notional, entry_price, exit_price, realized_pnl, realized_pnl_pct, exit_filled_at
     FROM paper_trades WHERE source = 'fund_hold' AND status = 'closed' ORDER BY exit_filled_at DESC`
  )
  .all()
  .map((r) => ({
    ticker: r.ticker,
    notional: r.notional,
    entryPrice: r.entry_price,
    exitPrice: r.exit_price,
    realizedPnl: r.realized_pnl,
    realizedPnlPct: r.realized_pnl_pct,
    soldAt: r.exit_filled_at,
  }));
const fundRealizedPnl = Number(fundSold.reduce((sum, r) => sum + (r.realizedPnl ?? 0), 0).toFixed(2));
const fundHoldings = loadHoldings("fund_hold");
const cryptoHoldings = loadHoldings("crypto_hold");

// Most recent day's fund/index ETF snapshots (see config.js's
// FUND_WATCHLIST and db.js's fund_snapshots table) — real, live daily
// performance for the dashboard's Mutual Funds tab. Empty until the nightly
// pipeline has run at least once since this feature was added.
const latestFundDateRow = db.prepare(`SELECT MAX(date) AS d FROM fund_snapshots`).get();
const fundSnapshots = latestFundDateRow?.d
  ? db
      .prepare(`SELECT ticker, label, close, pct_change FROM fund_snapshots WHERE date = ? ORDER BY ticker`)
      .all(latestFundDateRow.d)
      .map((r) => ({ ticker: r.ticker, label: r.label, close: r.close, pctChange: r.pct_change }))
  : [];

const recentBriefs = db
  .prepare(
    `SELECT date, top_winner, winner_pct, top_loser, loser_pct, watchlist_tickers
     FROM briefs ORDER BY date DESC LIMIT 14`
  )
  .all()
  .map((b) => ({
    date: b.date,
    topWinner: b.top_winner,
    winnerPct: b.winner_pct,
    topLoser: b.top_loser,
    loserPct: b.loser_pct,
    watchlistTickers: b.watchlist_tickers ? b.watchlist_tickers.split("|") : [],
  }));

// Full top-5 gainers/losers from the most recent session (see db.js's
// winners_json/losers_json comment) — powers the Dashboard tab's "Top 5
// Movers" section. Falls back to empty arrays gracefully for any brief row
// saved before this field existed (parse errors and missing values both
// land there, not a thrown error).
function safeParseMovers(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
const latestBriefRow = db
  .prepare(`SELECT date, winners_json, losers_json FROM briefs ORDER BY date DESC LIMIT 1`)
  .get();
const dailyMovers = {
  asOfDate: latestBriefRow?.date ?? null,
  gainers: safeParseMovers(latestBriefRow?.winners_json),
  losers: safeParseMovers(latestBriefRow?.losers_json),
};

// Fund holdings value-over-time (see db.js's fund_holding_value_snapshots
// table + index.js's nightly snapshot step) — aggregates across every
// currently/previously-held fund_hold ticker (both the fixed 5-fund
// allocation and any custom-ticker buys, same source) into one
// per-date {marketValue, costBasis, unrealizedPnl} series for the Mutual
// Funds tab's "Fund Holdings Value Over Time" chart. Summed per date, not
// per-ticker, since the chart shows the whole fund portfolio's value, not
// any single holding's. Empty until at least one nightly run has occurred
// since a fund_hold position existed.
const fundValueHistoryRows = db
  .prepare(
    `SELECT date, SUM(market_value) AS total_market_value, SUM(cost_basis) AS total_cost_basis, SUM(unrealized_pnl) AS total_unrealized_pnl
     FROM fund_holding_value_snapshots GROUP BY date ORDER BY date`
  )
  .all();
const fundValueHistory = fundValueHistoryRows.map((r) => ({
  date: r.date,
  totalMarketValue: Number(r.total_market_value.toFixed(2)),
  totalCostBasis: Number(r.total_cost_basis.toFixed(2)),
  unrealizedPnl: Number(r.total_unrealized_pnl.toFixed(2)),
}));

// Every dashboard invest request and its outcome (see db.js's
// invest_requests) — most recent 30, newest first. Claude's reasoning is
// trimmed for payload size; the dashboard shows it behind a "Why" toggle.
const ANALYSIS_MAX_CHARS = 1500;
const recentRequests = db
  .prepare(`SELECT created_at, kind, ticker, amount, outcome, detail, analysis FROM invest_requests ORDER BY id DESC LIMIT 30`)
  .all()
  .map((r) => ({
    createdAt: r.created_at,
    kind: r.kind,
    ticker: r.ticker,
    amount: r.amount,
    outcome: r.outcome,
    detail: r.detail,
    analysis: r.analysis && r.analysis.length > ANALYSIS_MAX_CHARS ? r.analysis.slice(0, ANALYSIS_MAX_CHARS) + "…" : r.analysis,
  }));

// ---- AI honesty (added 2026-09-30) ----
// Measures Claude as a forecaster, separately from P&L:
//   - weekly: Claude's self-grade vs. the price-checked hit rate, per week,
//     so the dashboard shows whether the self-grading gap is shrinking.
//   - byConfidence: does "high" confidence actually beat "low"?
//   - verdicts: how often "played out" came with the price moving the
//     WRONG way, and "missed" with the price moving the RIGHT way.
// Stock nightly calls only. Display only; never feeds sizing or picks.
const honestyRows = db
  .prepare(
    `SELECT w.date, w.outcome, w.confidence, w.result_pct_change AS r, p.direction AS d,
            CASE WHEN p.status = 'closed' THEN p.realized_pnl_pct END AS tradePct
     FROM watchlist_followups w
     JOIN paper_trades p ON p.date = w.date AND p.ticker = w.ticker AND p.source = 'nightly'
     WHERE w.ticker NOT LIKE '%/%' AND w.result_pct_change IS NOT NULL AND p.direction IS NOT NULL`
  )
  .all()
  .map((x) => ({ ...x, right: (x.d === "short" ? -x.r : x.r) > 0 }));
const pct1 = (a, b) => (b > 0 ? Number(((a / b) * 100).toFixed(1)) : null);
const mondayOf = (d) => {
  const t = new Date(d + "T12:00:00Z");
  const back = (t.getUTCDay() + 6) % 7;
  return new Date(t.getTime() - back * 864e5).toISOString().slice(0, 10);
};
const weekMap = new Map();
for (const x of honestyRows) {
  const k = mondayOf(x.date);
  const w = weekMap.get(k) ?? { week: k, n: 0, right: 0, verdictN: 0, playedOut: 0 };
  w.n += 1;
  if (x.right) w.right += 1;
  if (["played_out", "partial", "missed"].includes(x.outcome)) {
    w.verdictN += 1;
    if (x.outcome === "played_out") w.playedOut += 1;
  }
  weekMap.set(k, w);
}
// Weeks with fewer than 5 graded calls (usually the current, partial week)
// are left off the chart: one or two calls make a meaningless 0% or 100%.
const HONESTY_MIN_WEEK_N = 5;
const honestyWeekly = [...weekMap.values()]
  .filter((w) => w.n >= HONESTY_MIN_WEEK_N)
  .sort((a, b) => a.week.localeCompare(b.week))
  .map((w) => ({ week: w.week, n: w.n, priceCheckedPct: pct1(w.right, w.n), selfGradePct: pct1(w.playedOut, w.verdictN), selfGradeN: w.verdictN }));
const honestyByConfidence = ["high", "medium", "low"]
  .map((c) => {
    const xs = honestyRows.filter((x) => x.confidence === c);
    const traded = xs.filter((x) => x.tradePct != null);
    return {
      confidence: c,
      n: xs.length,
      priceCheckedPct: pct1(xs.filter((x) => x.right).length, xs.length),
      avgTradePct: traded.length ? Number((traded.reduce((a, x) => a + x.tradePct, 0) / traded.length).toFixed(2)) : null,
      tradeN: traded.length,
    };
  })
  .filter((b) => b.n > 0);
const po = honestyRows.filter((x) => x.outcome === "played_out");
const mi = honestyRows.filter((x) => x.outcome === "missed");
const honesty = {
  weekly: honestyWeekly,
  byConfidence: honestyByConfidence,
  verdicts: {
    playedOutN: po.length,
    playedOutButWrongN: po.filter((x) => !x.right).length,
    missedN: mi.length,
    missedButRightN: mi.filter((x) => x.right).length,
  },
};

// ---- Launch readiness: Gate A of roadmap.md's draft pass/fail bar ----
// (added 2026-09-30). Statuses are computed where the repo can know them
// (clean-run streak, kill switch, dry-run mirror); the rest are manual
// steps and stay "not done" until someone changes them here on purpose.
const REQUIRED_CLEAN_RUNS = 20;
const nightlyRuns = db.prepare(`SELECT run_at, clean FROM pipeline_runs WHERE workflow = 'nightly' ORDER BY id DESC`).all();
let cleanStreak = 0;
for (const r of nightlyRuns) { if (r.clean) cleanStreak += 1; else break; }
const firstLogged = nightlyRuns.length ? nightlyRuns.at(-1).run_at.slice(0, 10) : null;
const mirrorRows = db.prepare(`SELECT pick_date, ticker, notional, status, note FROM live_dryrun_orders ORDER BY id DESC LIMIT 12`).all();
const lastMirrorDate = mirrorRows[0]?.pick_date ?? null;
// Account check (Gate A item): per-symbol fractional support comes from
// Alpaca's asset records (asset_checks, via src/checkAssets.js). The
// settlement answer comes from Alpaca's own documentation (see
// status-memo.md, September 30): accounts under $2,000 are "limited margin"
// at 1x buying power, and Alpaca covers the settlement float, so sale
// proceeds can be reused immediately.
const assetRows = db.prepare(`SELECT symbol, fractionable, tradable, checked_at FROM asset_checks`).all();
const assetBySym = Object.fromEntries(assetRows.map((r) => [r.symbol, r]));
const uncheckedSyms = WATCHLIST_FOR_CHECK.filter((s) => !assetBySym[s]);
const nonFractional = WATCHLIST_FOR_CHECK.filter((s) => assetBySym[s] && !(assetBySym[s].fractionable && assetBySym[s].tradable));
const assetCheckedAt = assetRows.length ? assetRows.map((r) => r.checked_at).sort().at(-1).slice(0, 10) : null;
const accountItem =
  uncheckedSyms.length === WATCHLIST_FOR_CHECK.length
    ? { status: "in_progress", detail: "Settlement confirmed from Alpaca's docs (1x buying power, proceeds reusable immediately). Fractional-share check against Alpaca's asset records pending." }
    : uncheckedSyms.length === 0 && nonFractional.length === 0
      ? { status: "done", detail: `All ${WATCHLIST_FOR_CHECK.length} watchlist stocks support fractional shares (checked with Alpaca ${assetCheckedAt}). Settlement: 1x buying power, proceeds reusable immediately.` }
      : { status: "in_progress", detail: `Fractional issues: ${[...nonFractional, ...uncheckedSyms.map((s) => s + " (unchecked)")].join(", ")}. The mirror would need to skip these.` };

const launchReadiness = {
  requiredCleanRuns: REQUIRED_CLEAN_RUNS,
  cleanStreak,
  loggedRuns: nightlyRuns.length,
  countingSince: firstLogged,
  killSwitchOn: tradingHalted(),
  items: [
    { key: "scope", label: "Scope: nightly long picks only, fractional shares, $30", status: lastMirrorDate ? "done" : "in_progress",
      detail: lastMirrorDate ? "Modeled every night by the dry-run mirror below." : "Dry-run mirror built; first run pending." },
    { key: "separation", label: "Separate live workflow, unreachable from the public dashboard", status: "done",
      detail: "Built inert: no live endpoint or keys exist in the code, and the dashboard's Worker can't trigger it." },
    { key: "killswitch", label: "Kill switch checked before every order", status: "done",
      detail: "One repository setting halts all new orders." },
    { key: "reliability", label: `${REQUIRED_CLEAN_RUNS} consecutive clean nightly runs`, status: cleanStreak >= REQUIRED_CLEAN_RUNS ? "done" : "in_progress",
      detail: nightlyRuns.length ? `${cleanStreak} of ${REQUIRED_CLEAN_RUNS} so far (counting since ${firstLogged}).` : "Counting starts with the next nightly run." },
    { key: "account", label: "Confirm small-account settlement and fractional support with Alpaca", ...accountItem },
    { key: "stoprule", label: "Stop rule: pause live trading after a 20% drop from the high", status: "todo", detail: "Only matters once live; to be built into the live path." },
    { key: "decision", label: "The go-live decision, made and logged by the owner", status: "todo", detail: "Not an automatic step, by design." },
  ],
  mirror: mirrorRows.filter((r) => r.pick_date === lastMirrorDate).map((r) => ({ date: r.pick_date, ticker: r.ticker, notional: r.notional, status: r.status, note: r.note })),
};

// ---- Long-horizon track (added 2026-10-01; see src/longHorizon.js) ----
// Wrapped so a problem here can never break the nightly export.
let longHorizon = null;
try {
  const periods = db.prepare(`SELECT id, formed_date, model, note FROM lh_periods ORDER BY id`).all();
  const spyDates = db.prepare(`SELECT date FROM benchmark_bars WHERE symbol = 'SPY' ORDER BY date`).all().map((r) => r.date);
  const withHoldings = periods
    .map((p) => ({
      ...p,
      holdings: db.prepare(`SELECT symbol FROM lh_forecasts WHERE period_id = ? AND held = 1 ORDER BY rank`).all(p.id).map((r) => r.symbol),
      startDate: spyDates.find((d) => d > p.formed_date) ?? null, // entered at the next session's open
    }))
    .filter((p) => p.holdings.length > 0);
  if (withHoldings.length) {
    const latest = withHoldings.at(-1);
    const symbols = [...new Set(withHoldings.flatMap((p) => p.holdings)), "SPY"];
    const bars = {};
    for (const s of symbols) {
      bars[s] = Object.fromEntries(db.prepare(`SELECT date, open, close FROM benchmark_bars WHERE symbol = ?`).all(s).map((b) => [b.date, { open: b.open, close: b.close }]));
    }
    const valued = withHoldings.filter((p) => p.startDate).map((p) => ({ startDate: p.startDate, symbols: p.holdings }));
    const series = portfolioSeries(valued, bars);
    longHorizon = {
      formedDate: latest.formed_date,
      startDate: latest.startDate,
      note: latest.note,
      periods: withHoldings.length,
      holdings: latest.holdings,
      ranking: db.prepare(
        `SELECT symbol, industry, cagr_p10, cagr_p50, cagr_p90, margin_2031, implied_return, rank, held, reasoning, status
         FROM lh_forecasts WHERE period_id = ? ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END, rank`
      ).all(latest.id).map((r) => ({
        symbol: r.symbol, industry: r.industry, cagr: [r.cagr_p10, r.cagr_p50, r.cagr_p90], margin: r.margin_2031,
        impliedReturn: r.implied_return, rank: r.rank, held: !!r.held, reasoning: r.reasoning, status: r.status,
      })),
      series,
    };
  }
} catch (err) {
  console.error("exportSite: long-horizon block failed (non-fatal):", err.message);
}

// Dated log of every change to the strategy or its measurement, shown on the
// dashboard so results can be read against what changed when. Add to it in
// the same commit as any future change.
const changeLog = [
  { date: "2026-10-01", kind: "Fix", text: "Fixed a data bug: the nightly crypto agent had only been receiving prices for XRP (one of its 10 coins), so it never found a trade. It now sees all 10. Crypto results before this date reflect the bug." },
  { date: "2026-10-01", kind: "Experiment", text: "Started a separate long-horizon track: Claude forecasts company fundamentals, code ranks them, and a virtual top-5 portfolio is tracked against SPY. It places no orders and doesn't touch the nightly strategy." },
  { date: "2026-09-30", kind: "Safety", text: "Added a kill switch, a clean-run log, and a dry-run of a $30 live account. Nothing about which trades get made changed." },
  { date: "2026-09-29", kind: "Strategy", text: "Shorts now need a specific, stated reason, and the agent is no longer forced to make 3-5 picks a night. Shorts had been the main source of losses." },
  { date: "2026-09-27", kind: "Measurement", text: "The direction hit rate is now checked against real prices. Claude's own, more generous grade is shown separately." },
  { date: "2026-09-27", kind: "Measurement", text: "Every trade is now compared with simply holding SPY over the same window." },
  { date: "2026-09-26", kind: "Safety", text: "Positions now close by their own share count, with guards so different strategies can't net against each other." },
  { date: "2026-09-25", kind: "Decision", text: "Kept short-side sizing unchanged despite weak results, to avoid acting twice on the same small sample." },
  { date: "2026-09-10", kind: "Strategy", text: "Position size is cut in half for low confidence, upcoming events, and shorts, based on the system's own results." },
  { date: "2026-08-24", kind: "Strategy", text: "Claude started rating its own confidence on each pick." },
  { date: "2026-08-20", kind: "Strategy", text: "Simulated trades can be long or short." },
  { date: "2026-08-17", kind: "Strategy", text: "Simulated paper trading began." },
];

const output = {
  generatedAt: new Date().toISOString(),
  minSampleSize: MIN_N,
  overview: {
    closedTrades: overallSummary?.n ?? 0,
    avgReturnPct: overallSummary?.avgReturnPct ?? null,
    totalPnl: overallSummary?.totalPnl ?? null,
    totalNotional: overallSummary?.totalNotional ?? null,
    winRatePct: overallSummary?.winRatePct ?? null,
    directionalHitRatePct,
    directionalResolvedN: resolvedN,
    directionalCi95,
    claudeSelfGradePct: selfGradePct,
    claudeSelfGradeN: selfGradeN,
    maxDrawdownUsd: Number(maxDrawdown.toFixed(2)),
    bestTrade: bestTrade && { ticker: bestTrade.ticker, date: bestTrade.date, pnlPct: bestTrade.realized_pnl_pct },
    worstTrade: worstTrade && { ticker: worstTrade.ticker, date: worstTrade.date, pnlPct: worstTrade.realized_pnl_pct },
    currentStreak: streakType && { type: streakType, count: currentStreak },
  },
  equityCurve,
  benchmark,
  honesty,
  launchReadiness,
  longHorizon,
  changeLog,
  buckets,
  byTicker,
  methodology: {
    baseNotionalUsd: PAPER_TRADE_BASE_NOTIONAL,
    sizingAdjustments: SIZING_ADJUSTMENTS,
  },
  portfolioRisk: {
    currentOpenPositions: currentExposure.n,
    currentDeployedUsd: currentExposure.notional,
    maxConcurrentPositions: PORTFOLIO_LIMITS.maxConcurrentPositions,
    maxTotalNotionalUsd: PORTFOLIO_LIMITS.maxTotalNotionalUsd,
  },
  recentBriefs,
  dailyMovers,
  fundHoldings,
  fundSold,
  fundRealizedPnl,
  fundValueHistory,
  cryptoHoldings,
  cryptoEquityCurve,
  recentRequests,
  cryptoNightlyOverview: {
    closedTrades: cryptoNightlySummary?.n ?? 0,
    avgReturnPct: cryptoNightlySummary?.avgReturnPct ?? null,
    totalPnl: cryptoNightlySummary?.totalPnl ?? null,
    winRatePct: cryptoNightlySummary?.winRatePct ?? null,
    meetsMinN: cryptoNightlySummary?.meetsMinN ?? false,
  },
  fundSnapshots: {
    asOfDate: latestFundDateRow?.d ?? null,
    items: fundSnapshots,
  },
  lessons,
  onDemand: onDemandClosed.map((r) => ({
    date: r.date,
    ticker: r.ticker,
    direction: r.direction,
    pnl: r.realized_pnl,
    pnlPct: r.realized_pnl_pct,
    source: r.source,
  })),
  onDemandPending: onDemandPending.map((r) => ({
    date: r.date,
    ticker: r.ticker,
    direction: r.direction,
    status: r.status,
    notional: r.notional,
    source: r.source,
  })),
};

const dir = path.resolve("docs");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(output, null, 2), "utf-8");
console.log(`exportSite: wrote docs/data.json (${closed.length} closed trades, ${recentBriefs.length} recent briefs)`);

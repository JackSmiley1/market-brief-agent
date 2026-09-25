import "dotenv/config";
import fs from "fs";
import path from "path";
import { db } from "./db.js";
import { PAPER_TRADE_BASE_NOTIONAL, SIZING_ADJUSTMENTS, PORTFOLIO_LIMITS } from "./config.js";
import { aggregateTrades } from "./stats.js";

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
    `SELECT p.date, p.ticker, p.direction, p.notional, p.realized_pnl, p.realized_pnl_pct, p.exit_filled_at,
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

const onDemandClosed = db
  .prepare(
    `SELECT date, ticker, direction, realized_pnl, realized_pnl_pct, exit_filled_at
     FROM paper_trades WHERE status = 'closed' AND source = 'on_demand'
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
    `SELECT date, ticker, direction, status, notional
     FROM paper_trades WHERE source = 'on_demand' AND status != 'closed'
     ORDER BY date DESC LIMIT 20`
  )
  .all();

const overallSummary = summarize(closed);

// Directional accuracy is a separate metric from P&L — whether the flagged
// thesis played out, independent of position size. Reported alongside P&L
// specifically because the two can (and currently do) diverge; showing only
// one would misrepresent the system in either an overly flattering or overly
// harsh direction.
const graded = db
  .prepare(`SELECT outcome FROM watchlist_followups WHERE outcome IS NOT NULL`)
  .all();
const validOutcomes = { played_out: 0, partial: 0, missed: 0, unclear: 0 };
for (const row of graded) validOutcomes[row.outcome] = (validOutcomes[row.outcome] ?? 0) + 1;
const resolvedN = validOutcomes.played_out + validOutcomes.partial + validOutcomes.missed;
const directionalHitRatePct = resolvedN > 0 ? Number(((validOutcomes.played_out / resolvedN) * 100).toFixed(1)) : null;

// Equity curve: cumulative realized P&L over time, one point per closed trade
// in resolution order. This is a paper-trading curve on simulated capital,
// labeled as such on the dashboard — never presented as real returns.
// Carries ticker/direction/per-trade P&L too (not just the cumulative line)
// so the dashboard can show a real tooltip per point instead of just "trade
// #12" with no context.
let cumulative = 0;
let peak = 0;
let maxDrawdown = 0;
const equityCurve = closed.map((r) => {
  cumulative += r.realized_pnl;
  peak = Math.max(peak, cumulative);
  maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  return {
    date: r.exit_filled_at ? r.exit_filled_at.slice(0, 10) : r.date,
    ticker: r.ticker,
    direction: r.direction,
    tradePnl: Number(r.realized_pnl.toFixed(2)),
    tradePnlPct: r.realized_pnl_pct,
    cumulativePnl: Number(cumulative.toFixed(2)),
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
    maxDrawdownUsd: Number(maxDrawdown.toFixed(2)),
    bestTrade: bestTrade && { ticker: bestTrade.ticker, date: bestTrade.date, pnlPct: bestTrade.realized_pnl_pct },
    worstTrade: worstTrade && { ticker: worstTrade.ticker, date: worstTrade.date, pnlPct: worstTrade.realized_pnl_pct },
    currentStreak: streakType && { type: streakType, count: currentStreak },
  },
  equityCurve,
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
  })),
  onDemandPending: onDemandPending.map((r) => ({
    date: r.date,
    ticker: r.ticker,
    direction: r.direction,
    status: r.status,
    notional: r.notional,
  })),
};

const dir = path.resolve("docs");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(output, null, 2), "utf-8");
console.log(`exportSite: wrote docs/data.json (${closed.length} closed trades, ${recentBriefs.length} recent briefs)`);

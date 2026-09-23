import "dotenv/config";
import fs from "fs";
import path from "path";
import { db } from "./db.js";
import { PAPER_TRADE_BASE_NOTIONAL, SIZING_ADJUSTMENTS } from "./config.js";

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
  if (rows.length === 0) return null;
  const totalPnl = rows.reduce((s, r) => s + r.realized_pnl, 0);
  const totalNotional = rows.reduce((s, r) => s + r.notional, 0);
  const avgReturnPct = rows.reduce((s, r) => s + r.realized_pnl_pct, 0) / rows.length;
  const wins = rows.filter((r) => r.realized_pnl > 0).length;
  return {
    n: rows.length,
    totalPnl: Number(totalPnl.toFixed(2)),
    totalNotional,
    avgReturnPct: Number(avgReturnPct.toFixed(3)),
    winRatePct: Number(((wins / rows.length) * 100).toFixed(1)),
    meetsMinN: rows.length >= MIN_N,
  };
}

const closed = db
  .prepare(
    `SELECT p.date, p.ticker, p.direction, p.notional, p.realized_pnl, p.realized_pnl_pct, p.exit_filled_at,
            w.confidence, w.event_risk
     FROM paper_trades p
     LEFT JOIN watchlist_followups w ON p.date = w.date AND p.ticker = w.ticker
     WHERE p.status = 'closed'
     ORDER BY COALESCE(p.exit_filled_at, p.date)`
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
let cumulative = 0;
const equityCurve = closed.map((r) => {
  cumulative += r.realized_pnl;
  return { date: r.exit_filled_at ? r.exit_filled_at.slice(0, 10) : r.date, cumulativePnl: Number(cumulative.toFixed(2)) };
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
  },
  equityCurve,
  buckets,
  methodology: {
    baseNotionalUsd: PAPER_TRADE_BASE_NOTIONAL,
    sizingAdjustments: SIZING_ADJUSTMENTS,
  },
  recentBriefs,
};

const dir = path.resolve("docs");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(output, null, 2), "utf-8");
console.log(`exportSite: wrote docs/data.json (${closed.length} closed trades, ${recentBriefs.length} recent briefs)`);

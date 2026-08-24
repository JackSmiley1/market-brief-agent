import "dotenv/config";
import { db } from "./db.js";

// Joins the grading table (which now carries Claude's self-rated
// confidence per pick) against paper_trades' realized P&L on (date,
// ticker), to check whether stated confidence actually predicts outcome —
// both directionally (does "high" correlate with more played_out verdicts)
// and financially (does "high" correlate with better realized P&L). Rows
// from before confidence tracking existed have confidence = NULL and are
// excluded, not treated as a rating.
const rows = db
  .prepare(
    `SELECT w.confidence, w.outcome, p.status AS trade_status, p.realized_pnl, p.realized_pnl_pct
     FROM watchlist_followups w
     LEFT JOIN paper_trades p ON w.date = p.date AND w.ticker = p.ticker
     WHERE w.confidence IS NOT NULL`
  )
  .all();

if (rows.length === 0) {
  console.log("No confidence-rated picks yet — this field was only just added, so nothing to analyze until the next few nights of picks resolve.");
  process.exit(0);
}

console.log(`Confidence-rated picks so far: ${rows.length}\n`);

const order = ["high", "medium", "low"];
for (const level of order) {
  const subset = rows.filter((r) => r.confidence === level);
  if (subset.length === 0) continue;

  const graded = subset.filter((r) => r.outcome && r.outcome !== "unclear");
  const playedOut = graded.filter((r) => r.outcome === "played_out").length;
  const directionalRate = graded.length > 0 ? (playedOut / graded.length) * 100 : null;

  const closed = subset.filter((r) => r.trade_status === "closed");
  const avgPnlPct = closed.length > 0 ? closed.reduce((s, r) => s + r.realized_pnl_pct, 0) / closed.length : null;
  const wins = closed.filter((r) => r.realized_pnl > 0).length;

  console.log(`${level.toUpperCase()} confidence: ${subset.length} pick(s)`);
  console.log(
    `  Directional: ${directionalRate !== null ? directionalRate.toFixed(1) + "% played out" : "not enough graded data yet"} (n=${graded.length})`
  );
  console.log(
    `  P&L: ${avgPnlPct !== null ? avgPnlPct.toFixed(2) + "% avg return, " + wins + "/" + closed.length + " wins" : "not enough closed trades yet"} (n=${closed.length})`
  );
}

console.log("\nSample size is still small — this is the newest tracked metric, treat it as even more directional than the accuracy/P&L numbers above it.");

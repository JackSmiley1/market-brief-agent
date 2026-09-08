import fs from "fs";
import path from "path";
import { db } from "./db.js";

const mostRecentBriefDateStmt = db.prepare(`SELECT MAX(date) AS d FROM briefs`);

// Used to detect a stale/repeat trading session (e.g. a market holiday,
// where the cron still fires but Alpaca returns the same last-real-session
// bar again) before doing anything else — see fetchMarketData.js's barDate.
export function getMostRecentBriefDate() {
  return mostRecentBriefDateStmt.get().d;
}

export function saveBriefMarkdown(date, briefText) {
  const dir = path.resolve("logs/briefs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${date}.md`), briefText, "utf-8");
}

// Upserts by date — re-runs (manual triggers, retries, local testing)
// replace that day's row instead of creating duplicates.
const upsertBriefStmt = db.prepare(`
  INSERT INTO briefs (date, top_winner, winner_pct, top_loser, loser_pct, watchlist_tickers)
  VALUES (@date, @topWinner, @winnerPct, @topLoser, @loserPct, @watchlistTickers)
  ON CONFLICT(date) DO UPDATE SET
    top_winner = excluded.top_winner,
    winner_pct = excluded.winner_pct,
    top_loser = excluded.top_loser,
    loser_pct = excluded.loser_pct,
    watchlist_tickers = excluded.watchlist_tickers
`);

// Simple structured row — expand this schema as Phase 2 needs more fields
export function appendBriefLog(date, row) {
  upsertBriefStmt.run({
    date,
    topWinner: row.topWinner ?? null,
    winnerPct: row.winnerPct ?? null,
    topLoser: row.topLoser ?? null,
    loserPct: row.loserPct ?? null,
    watchlistTickers: (row.watchlistTickers ?? []).join("|"),
  });
}

const deleteFollowUpsForDateStmt = db.prepare(`DELETE FROM watchlist_followups WHERE date = ?`);
const insertFollowUpStmt = db.prepare(
  `INSERT INTO watchlist_followups (date, ticker, setup, confidence) VALUES (?, ?, ?, ?)`
);

const validConfidence = new Set(["high", "medium", "low"]);

// Persists the tickers/setups Claude flagged in today's "Watchlist for
// Tomorrow" section, keyed by date, so tomorrow's run can check whether they
// played out. Replaces (not appends to) any existing rows for this date.
// node:sqlite's DatabaseSync has no .transaction() helper (unlike
// better-sqlite3), so this wraps manually with BEGIN/COMMIT/ROLLBACK.
export function saveWatchlistFollowUp(date, items) {
  db.exec("BEGIN");
  try {
    deleteFollowUpsForDateStmt.run(date);
    for (const item of items) {
      // Store null rather than silently coercing a malformed/missing
      // confidence to some default — a bad value should read as "not
      // rated" in the data, not masquerade as a real "medium" rating.
      const confidence = validConfidence.has(item.confidence) ? item.confidence : null;
      insertFollowUpStmt.run(date, item.ticker, item.setup, confidence);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const mostRecentPriorDateStmt = db.prepare(
  `SELECT MAX(date) AS d FROM watchlist_followups WHERE date < ?`
);
const followUpsForDateStmt = db.prepare(
  `SELECT ticker, setup FROM watchlist_followups WHERE date = ?`
);

// Returns the most recent stored entries strictly before `date`, skipping
// weekends/holidays automatically since this queries whatever dates actually
// have rows rather than assuming yesterday = the last trading day. Returns
// the source date too, since the grading write-back needs to know which
// date's rows to update.
export function loadMostRecentWatchlist(beforeDate) {
  const row = mostRecentPriorDateStmt.get(beforeDate);
  if (!row?.d) return { date: null, items: [] };
  return { date: row.d, items: followUpsForDateStmt.all(row.d) };
}

const updateGradingStmt = db.prepare(`
  UPDATE watchlist_followups
  SET outcome = ?, result_pct_change = ?
  WHERE date = ? AND ticker = ?
`);

// Writes Claude's outcome verdict plus the code-computed (not model-reported)
// pctChange back onto the original date's rows, turning that day's picks
// into a graded, queryable record.
export function saveGrading(date, items) {
  db.exec("BEGIN");
  try {
    for (const item of items) {
      updateGradingStmt.run(item.outcome, item.resultPctChange ?? null, date, item.ticker);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

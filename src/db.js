import { DatabaseSync } from "node:sqlite";
import path from "path";

const dbPath = path.resolve("logs/brief-data.db");
export const db = new DatabaseSync(dbPath);

// Using Node's built-in SQLite (available since Node 22.5, no separate
// native binary to download or compile) instead of better-sqlite3, after
// better-sqlite3's prebuilt native binary segfaulted reproducibly on
// GitHub Actions' ubuntu-latest runner (exit 139) while working fine
// locally and in other Linux environments — a classic native-addon/runner
// ABI mismatch. This removes that entire class of failure permanently.

// journal_mode = MEMORY avoids the create-then-delete pattern of the
// default on-disk rollback journal, which fails on this repo's folder due
// to its sync layer (likely iCloud Desktop sync) with a delete-permission
// error. Fine for this use case: single local/CI writer, low-stakes data.
db.exec("PRAGMA journal_mode = MEMORY");

db.exec(`
  CREATE TABLE IF NOT EXISTS briefs (
    date TEXT PRIMARY KEY,
    top_winner TEXT,
    winner_pct REAL,
    top_loser TEXT,
    loser_pct REAL,
    watchlist_tickers TEXT
  );

  CREATE TABLE IF NOT EXISTS watchlist_followups (
    date TEXT NOT NULL,
    ticker TEXT NOT NULL,
    setup TEXT,
    outcome TEXT,
    result_pct_change REAL,
    PRIMARY KEY (date, ticker)
  );

  -- Simulated (paper account, zero real capital) trades against Alpaca's
  -- paper trading API. One row per position, keyed by the date its entry
  -- was flagged. Orders are submitted after-hours (this pipeline runs at
  -- market close) so they queue and fill at the next session's open —
  -- entry_price/exit_price are filled in by reconciliation on a later run,
  -- not synchronously when the order is placed. status tracks where each
  -- position is in that lifecycle: entry_pending -> open -> exit_pending -> closed
  -- (or *_failed if Alpaca rejects/can't fill an order).
  CREATE TABLE IF NOT EXISTS paper_trades (
    date TEXT NOT NULL,
    ticker TEXT NOT NULL,
    entry_order_id TEXT,
    entry_price REAL,
    entry_filled_at TEXT,
    notional REAL,
    exit_order_id TEXT,
    exit_price REAL,
    exit_filled_at TEXT,
    status TEXT NOT NULL DEFAULT 'entry_pending',
    realized_pnl REAL,
    realized_pnl_pct REAL,
    PRIMARY KEY (date, ticker)
  );
`);

// Migration helper: SQLite has no "ADD COLUMN IF NOT EXISTS", so add and
// swallow the specific "duplicate column" error on repeat runs instead.
// Needed because paper_trades already has live rows in production —
// CREATE TABLE IF NOT EXISTS above does nothing for an existing table.
function addColumnIfMissing(table, columnDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

// winners_json/losers_json: full top-5 gainers/losers (ticker + pctChange)
// from that night's WATCHLIST scan — the same list already computed in
// index.js for news-fetching and Claude's prompt, previously only the
// single top winner/loser (top_winner/winner_pct/top_loser/loser_pct above)
// ever made it to storage. Added 2026-09-25 to power a "Top 5 Movers"
// section on the dashboard's Dashboard tab, alongside the crypto and fund
// movers sections. JSON text, not a separate table — this is small,
// display-only data with no query needs beyond "the most recent row's
// value," so a normalized table would be unnecessary overhead here.
addColumnIfMissing("briefs", "winners_json TEXT");
addColumnIfMissing("briefs", "losers_json TEXT");

// direction/qty: added when short-selling support was introduced. Existing
// rows default to 'long' (accurate — they were all long-only buys prior to
// this), qty is backfilled by the next reconciliation pass for open rows,
// stays null for already-closed historical rows (their P&L was already
// computed correctly under the long-only assumption that was true then).
addColumnIfMissing("paper_trades", "direction TEXT NOT NULL DEFAULT 'long'");
addColumnIfMissing("paper_trades", "qty REAL");

// source: 'nightly' for the fixed-watchlist systematic picks the sizing
// rules (config.js's SIZING_ADJUSTMENTS) were actually derived from and
// validated against, 'on_demand' for ad hoc user-prompted trades (see
// onDemandTrade.js). checkpoint.js and exportSite.js filter to 'nightly'
// only when evaluating those sizing rules — mixing in ad hoc trades would
// quietly contaminate the n>=20 evidence gate with a different, uncontrolled
// selection process. Existing rows default to 'nightly', which is accurate:
// on_demand trading didn't exist before this column was added.
addColumnIfMissing("paper_trades", "source TEXT NOT NULL DEFAULT 'nightly'");

// confidence: Claude's own self-rated high/medium/low for each pick at the
// time it was flagged, stored on the grading table (not paper_trades) since
// it's a property of the analysis/setup itself, not the execution — lets
// computeConfidence.js join this against paper_trades' realized P&L on
// (date, ticker) to check whether stated confidence actually predicts
// outcome. Null (not defaulted) for historical rows — those picks were
// never rated, so there's no honest value to backfill.
addColumnIfMissing("watchlist_followups", "confidence TEXT");

// event_risk: Claude's own self-rated flag for whether a pick has a
// scheduled earnings/regulatory/binary event that could gap the price
// beyond a normal day's move. Added after the CRM trade (2026-08-25,
// shorted into an earnings report, -15.59% — the worst trade in the
// dataset) exposed that position sizing had no way to account for this
// risk at all. Used by paperTrade.js to size positions down, not just
// tracked passively. Null for historical rows (never rated).
addColumnIfMissing("watchlist_followups", "event_risk INTEGER");

// peer_catalyst: Claude's own self-rated flag for whether a setup names a
// specific peer company's earnings/guidance/news, or a specific sector-wide
// trigger, as the reason this ticker should move — vs. an isolated,
// unconfirmed, or purely technical setup with no peer/sector read-through.
// Added 2026-09-25 after research (internal trade-history analysis + a
// cross-check against real 2026 short-selling outcomes) found this was the
// single strongest differentiator among this system's own short trades:
// peer/sector-catalyst shorts averaged +0.64% (n=12, 75% win rate) vs.
// -1.53% for everything else. That sample is well below the project's own
// n>=20 bar (see checkpoint.js), so this field exists to TRACK the pattern,
// not to size against it yet — no sizing rule reads this column. Once
// enough trades accumulate on both sides, checkpoint.js/exportSite.js can
// tell us honestly whether it holds up. Null for historical rows (added
// after they were rated) and for long picks this hasn't been validated on.
addColumnIfMissing("watchlist_followups", "peer_catalyst INTEGER");

// Reflection loop (see reflect.js) — a Reflexion-style mechanism distinct
// from the numeric sizing rules in config.js. Sizing answers "how much to
// risk"; this answers "what pattern should tonight's picks watch out for,"
// synthesized in natural language from a batch of the system's own recent
// losing trades (original setup reasoning + actual outcome), not just their
// win/loss tally. Gated the same way checkpoint.js gates sizing changes —
// only runs on a large-enough new batch of losses, and is explicitly allowed
// to conclude "no clear pattern" rather than forcing an insight. based_on_ids
// stores which paper_trades rows a lesson was drawn from (comma-separated),
// so a lesson is never silently re-derived from trades already reflected on.
db.exec(`
  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    based_on_trade_count INTEGER NOT NULL,
    based_on_ids TEXT NOT NULL,
    lesson_text TEXT NOT NULL
  );
`);

// Daily closing snapshot for the index/fund ETF proxies in config.js's
// FUND_WATCHLIST (2026-09-25) — powers the dashboard's Mutual Funds tab with
// real, live daily performance instead of leaving that tab preview-only.
// Deliberately its own table, not reusing paper_trades or watchlist_followups:
// these tickers are never analyzed by Claude, never sized, and never
// paper-traded, only fetched and recorded as-is via the same fetchMarketData
// call already used for WATCHLIST (no new API key or extra service needed).
db.exec(`
  CREATE TABLE IF NOT EXISTS fund_snapshots (
    date TEXT NOT NULL,
    ticker TEXT NOT NULL,
    label TEXT NOT NULL,
    close REAL,
    pct_change REAL,
    PRIMARY KEY (date, ticker)
  );
`);

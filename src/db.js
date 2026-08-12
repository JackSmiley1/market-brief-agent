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
`);

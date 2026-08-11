import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve("logs/brief-data.db");
export const db = new Database(dbPath);

// The default on-disk rollback journal creates-then-deletes a temp file on
// every write, which fails on this folder's sync layer (iCloud Desktop sync
// most likely) with SQLITE_IOERR_DELETE. MEMORY mode keeps the journal in
// RAM instead — fine for this use case (single local writer, low-stakes
// data, not a high-concurrency production DB) and avoids touching disk for
// anything but the single committable .db file itself.
db.pragma("journal_mode = MEMORY");

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

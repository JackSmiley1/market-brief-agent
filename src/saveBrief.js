import fs from "fs";
import path from "path";

export function saveBriefMarkdown(date, briefText) {
  const dir = path.resolve("logs/briefs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${date}.md`), briefText, "utf-8");
}

// Simple structured row — expand this schema as Phase 2 needs more fields
export function appendBriefLog(date, row) {
  const csvPath = path.resolve("logs/brief-log.csv");
  const header = "date,top_winner,winner_pct,top_loser,loser_pct,watchlist_tickers";
  const newLine = [
    date,
    row.topWinner ?? "",
    row.winnerPct ?? "",
    row.topLoser ?? "",
    row.loserPct ?? "",
    (row.watchlistTickers ?? []).join("|"),
  ].join(",");

  let dataLines = [];
  if (fs.existsSync(csvPath)) {
    const raw = fs.readFileSync(csvPath, "utf-8").trim();
    dataLines = raw.length > 0 ? raw.split("\n").slice(1) : [];
  }

  // Overwrite any existing row for this date instead of appending a
  // duplicate. Re-runs (manual triggers, retries, local testing) should
  // replace that day's entry, not silently corrupt the historical ledger
  // this accuracy tracking depends on.
  dataLines = dataLines.filter((line) => !line.startsWith(`${date},`));
  dataLines.push(newLine);

  fs.writeFileSync(csvPath, [header, ...dataLines].join("\n") + "\n", "utf-8");
}

const FOLLOWUP_PATH = path.resolve("logs/watchlist-followup.json");

function readFollowUpStore() {
  if (!fs.existsSync(FOLLOWUP_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(FOLLOWUP_PATH, "utf-8"));
  } catch (err) {
    console.warn("readFollowUpStore: failed to parse watchlist-followup.json, starting fresh:", err.message);
    return {};
  }
}

// Persists the tickers/setups Claude flagged in today's "Watchlist for
// Tomorrow" section, keyed by date, so tomorrow's run can check whether they
// played out.
export function saveWatchlistFollowUp(date, items) {
  const store = readFollowUpStore();
  store[date] = items;
  fs.writeFileSync(FOLLOWUP_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// Returns the most recent stored entry strictly before `date`, skipping
// weekends/holidays automatically since we key by whatever dates actually
// have entries rather than assuming yesterday = the last trading day.
export function loadMostRecentWatchlist(beforeDate) {
  const store = readFollowUpStore();
  const priorDates = Object.keys(store).filter((d) => d < beforeDate).sort();
  if (priorDates.length === 0) return [];
  return store[priorDates[priorDates.length - 1]] ?? [];
}

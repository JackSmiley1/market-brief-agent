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
  const header = "date,top_winner,winner_pct,top_loser,loser_pct,watchlist_tickers\n";
  const line = [
    date,
    row.topWinner ?? "",
    row.winnerPct ?? "",
    row.topLoser ?? "",
    row.loserPct ?? "",
    (row.watchlistTickers ?? []).join("|"),
  ].join(",") + "\n";

  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, header + line, "utf-8");
  } else {
    fs.appendFileSync(csvPath, line, "utf-8");
  }
}

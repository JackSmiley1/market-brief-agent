import "dotenv/config";
import { fetchMarketData } from "./fetchMarketData.js";
import { fetchMarketNews, fetchCompanyNews } from "./fetchNews.js";
import { generateBrief } from "./generateBrief.js";
import { saveBriefMarkdown, appendBriefLog, saveWatchlistFollowUp, loadMostRecentWatchlist } from "./saveBrief.js";

function todayISO() {
  // toISOString() reports UTC, which has already rolled to the next
  // calendar day by ~8pm ET — any run after that gets mislabeled with
  // tomorrow's date. Use the actual US/Eastern trading-day date instead.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

async function run() {
  const date = todayISO();
  console.log(`Running brief for ${date}...`);

  const marketData = await fetchMarketData();
  const marketNews = await fetchMarketNews();

  const sorted = [...marketData].sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));
  const topMovers = sorted.slice(0, 5);

  const moverNews = [];
  for (const mover of topMovers) {
    const news = await fetchCompanyNews(mover.symbol, date, date);
    moverNews.push({ symbol: mover.symbol, news });
  }

  const previousWatchlist = loadMostRecentWatchlist(date);
  const { briefText, followUpItems } = await generateBrief({ marketData, marketNews, moverNews, date, previousWatchlist });
  saveBriefMarkdown(date, briefText);
  saveWatchlistFollowUp(date, followUpItems);

  const winner = [...marketData].sort((a, b) => b.pctChange - a.pctChange)[0];
  const loser = [...marketData].sort((a, b) => a.pctChange - b.pctChange)[0];
  appendBriefLog(date, {
    topWinner: winner?.symbol,
    winnerPct: winner?.pctChange,
    topLoser: loser?.symbol,
    loserPct: loser?.pctChange,
    watchlistTickers: topMovers.map((m) => m.symbol),
  });

  console.log(`Brief saved: logs/briefs/${date}.md`);
}

run().catch((err) => {
  console.error("Brief run failed:", err);
  process.exit(1);
});

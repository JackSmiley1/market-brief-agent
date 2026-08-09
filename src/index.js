import "dotenv/config";
import { fetchMarketData } from "./fetchMarketData.js";
import { fetchMarketNews, fetchCompanyNews } from "./fetchNews.js";
import { generateBrief } from "./generateBrief.js";
import { saveBriefMarkdown, appendBriefLog } from "./saveBrief.js";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

  const briefText = await generateBrief({ marketData, marketNews, moverNews, date });
  saveBriefMarkdown(date, briefText);

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

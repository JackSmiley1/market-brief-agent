import "dotenv/config";
import { fetchMarketData } from "./fetchMarketData.js";
import { fetchMarketNews, fetchCompanyNews } from "./fetchNews.js";
import { generateBrief } from "./generateBrief.js";
import { matchPreviousWatchlist } from "./buildPrompt.js";
import {
  saveBriefMarkdown,
  appendBriefLog,
  saveWatchlistFollowUp,
  loadMostRecentWatchlist,
  saveGrading,
} from "./saveBrief.js";
import { runPaperTradingCycle } from "./paperTrade.js";

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

  // Must match buildPrompt.js's Winners/Losers split exactly (top 5 gainers +
  // top 5 losers by pctChange) — NOT top-5-by-absolute-magnitude. On days
  // where gains outpace losses (or vice versa), a magnitude-only cut fetches
  // news for one side and leaves every ticker on the other side without any
  // company-specific news, which then shows up as false "no catalyst
  // identified" verdicts that are really just missing data, not an unclear
  // situation.
  const winners = [...marketData].sort((a, b) => b.pctChange - a.pctChange).slice(0, 5);
  const losers = [...marketData].sort((a, b) => a.pctChange - b.pctChange).slice(0, 5);
  const topMovers = [...winners, ...losers].filter(
    (m, i, arr) => arr.findIndex((x) => x.symbol === m.symbol) === i
  );

  const moverNews = [];
  for (const mover of topMovers) {
    const news = await fetchCompanyNews(mover.symbol, date, date);
    moverNews.push({ symbol: mover.symbol, news });
  }

  const { date: previousDate, items: previousWatchlist } = loadMostRecentWatchlist(date);
  const followUpResults = matchPreviousWatchlist(previousWatchlist, marketData);

  const { briefText, followUpItems, gradingItems } = await generateBrief({
    marketData,
    marketNews,
    moverNews,
    date,
    followUpResults,
  });
  saveBriefMarkdown(date, briefText);
  saveWatchlistFollowUp(date, followUpItems);

  // Simulated (Alpaca paper account, zero real capital) trades layered on
  // top of tonight's watchlist picks. Wrapped separately so an Alpaca
  // order/API hiccup here can never take down brief generation, which is
  // saved above already and is the priority output regardless.
  try {
    const priceMap = Object.fromEntries(marketData.map((d) => [d.symbol, d.close]));
    await runPaperTradingCycle(date, followUpItems, priceMap);
  } catch (err) {
    console.error("Paper trading cycle failed (brief was still saved normally):", err.message);
  }

  if (previousDate && gradingItems.length > 0) {
    // Attach the code-computed pctChange (from followUpResults, not
    // anything Claude reported) to each graded ticker before writing back.
    const merged = gradingItems.map((g) => {
      const match = followUpResults.find((f) => f.ticker === g.ticker);
      return { ticker: g.ticker, outcome: g.outcome, resultPctChange: match?.result?.pctChange ?? null };
    });
    saveGrading(previousDate, merged);
    console.log(`Graded ${merged.length} ticker(s) from ${previousDate}.`);
  }

  const winner = winners[0];
  const loser = losers[0];
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

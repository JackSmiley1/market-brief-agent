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
  getMostRecentBriefDate,
  saveFundSnapshots,
} from "./saveBrief.js";
import { runPaperTradingCycle } from "./paperTrade.js";
import { db } from "./db.js";
import { FUND_WATCHLIST } from "./config.js";

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

  // Refuse to proceed on a stale/repeat trading session — this happens on
  // market holidays, where the cron still fires (it only checks weekday,
  // not holidays) but Alpaca just returns the same last-real-session bar
  // again. Confirmed in production on 2026-09-07 (Labor Day): the pipeline
  // silently reprocessed 2026-09-04's exact numbers under a new date,
  // double-grading two tickers and opening a redundant paper-trading batch.
  // Use whichever barDate is most common across the fetched symbols, since
  // a handful of individual fetch failures shouldn't block this check.
  const barDateCounts = {};
  for (const d of marketData) barDateCounts[d.barDate] = (barDateCounts[d.barDate] ?? 0) + 1;
  const consensusBarDate = Object.entries(barDateCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const lastBriefDate = getMostRecentBriefDate();
  if (consensusBarDate && lastBriefDate && consensusBarDate <= lastBriefDate) {
    console.log(
      `No new trading session since ${lastBriefDate} (latest available data is still dated ${consensusBarDate}, likely a market holiday) — skipping this run entirely rather than reprocessing stale data under today's date.`
    );
    return;
  }

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

  // Most recent Reflexion-style lesson (see reflect.js) — advisory context
  // only, folded into the prompt in buildPrompt.js. Null on nights where no
  // lesson has been recorded yet (gate not cleared) or none exists at all.
  const latestLessonRow = db
    .prepare(`SELECT lesson_text FROM lessons ORDER BY id DESC LIMIT 1`)
    .get();
  const latestLesson = latestLessonRow?.lesson_text ?? null;

  const { briefText, followUpItems, gradingItems } = await generateBrief({
    marketData,
    marketNews,
    moverNews,
    date,
    followUpResults,
    latestLesson,
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

  // Dashboard's Mutual Funds tab (real, not just preview) — a separate, tiny
  // fetch of index/fund ETF proxies, never analyzed by Claude or traded, just
  // recorded as-is. Wrapped the same way as paper trading above: this is
  // display data, not the pipeline's core output, so a hiccup here should
  // never be able to block a brief that already generated successfully.
  try {
    const fundData = await fetchMarketData(FUND_WATCHLIST.map((f) => f.ticker));
    const labelByTicker = Object.fromEntries(FUND_WATCHLIST.map((f) => [f.ticker, f.label]));
    saveFundSnapshots(date, fundData, labelByTicker);
    console.log(`Fund snapshots saved: ${fundData.length}/${FUND_WATCHLIST.length} tracked fund(s).`);
  } catch (err) {
    console.error("Fund snapshot fetch failed (brief was still saved normally):", err.message);
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

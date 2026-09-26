import "dotenv/config";
import { fetchCryptoMarketData } from "./fetchCryptoMarketData.js";
import { fetchCryptoNews } from "./fetchNews.js";
import { generateCryptoNightlyCall } from "./generateBrief.js";
import { matchPreviousWatchlist } from "./buildPrompt.js";
import {
  loadMostRecentCryptoWatchlist,
  saveCryptoWatchlistFollowUp,
  saveGrading,
  saveBriefMarkdown,
} from "./saveBrief.js";
import { reconcileEntries, reconcileExits, closeMaturePositions, openNewPositions } from "./paperTrade.js";
import { CRYPTO_WATCHLIST, CRYPTO_PAPER_TRADE_BASE_NOTIONAL } from "./config.js";

// Nightly automated crypto trading — the automatic counterpart to
// onDemandCrypto.js's button-triggered flow, added 2026-09-26 to run on the
// same cadence as the stock nightly pipeline (index.js), not just on
// request. Mirrors index.js's shape closely on purpose (fetch data -> grade
// yesterday's picks -> ask Claude for tonight's watchlist -> save -> open
// positions) but stays a fully separate script and source tag:
//   - source='nightly_crypto' (not 'nightly' or 'crypto_ondemand') — never
//     read by checkpoint.js's stock evidence gate, and distinct from the
//     on-demand crypto path so the two crypto flows (automatic vs.
//     button-triggered) can eventually be evaluated separately too.
//   - Long-only always (Alpaca's crypto product doesn't support shorting —
//     see buildPrompt.js's NIGHTLY_CRYPTO_SYSTEM_PROMPT).
//   - Flat CRYPTO_PAPER_TRADE_BASE_NOTIONAL sizing via notionalOverride, not
//     SIZING_ADJUSTMENTS (see config.js's comment — that formula is derived
//     from stock evidence and doesn't transfer to a different asset class).
//   - Reuses the SAME watchlist_followups table as stocks, safely, via the
//     crypto-scoped functions in saveBrief.js (ticker-shape filtered so a
//     same-date stock/crypto run can never clobber each other).
//   - Positions still close after one session (closeMaturePositions is
//     source-agnostic and doesn't exclude 'nightly_crypto' — only
//     'fund_hold'/'crypto_hold' are held indefinitely).
//
// Wired into .github/workflows/nightly-brief.yml as an additional step
// alongside the stock brief, not a separate cron — same commit, same
// concurrency group, no risk of the two racing each other.
//
// Usage: node src/cryptoNightly.js

function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

async function run() {
  const date = todayISO();
  console.log(`Running nightly crypto watchlist for ${date}...`);

  // Same reconcile-anything-pending step as every other trading entry point.
  await reconcileEntries();
  await reconcileExits();
  // Closes any 'nightly_crypto' (or 'nightly'/'on_demand'/'crypto_ondemand')
  // position that's been open one full session — source-agnostic, see
  // paperTrade.js's openPositionsStmt comment. Safe to call here even though
  // index.js's runPaperTradingCycle may have already called it tonight too
  // (nothing left to close the second time, same as onDemandTrade.js already
  // calling reconcile/close independently of the nightly pipeline).
  await closeMaturePositions();

  const marketData = await fetchCryptoMarketData(CRYPTO_WATCHLIST);
  if (marketData.length === 0) {
    console.error("No crypto market data returned at all — skipping tonight's crypto run (Alpaca API issue or all symbols invalid).");
    process.exit(1);
  }

  const news = await fetchCryptoNews();

  const { date: previousDate, items: previousWatchlist } = loadMostRecentCryptoWatchlist(date);
  const followUpResults = matchPreviousWatchlist(previousWatchlist, marketData);

  const { analysisText, followUpItems, gradingItems } = await generateCryptoNightlyCall({
    marketData,
    news,
    date,
    followUpResults,
  });

  saveBriefMarkdown(`crypto-${date}`, analysisText);
  saveCryptoWatchlistFollowUp(date, followUpItems);

  if (previousDate && gradingItems.length > 0) {
    const merged = gradingItems.map((g) => {
      const match = followUpResults.find((f) => f.ticker === g.ticker);
      return { ticker: g.ticker, outcome: g.outcome, resultPctChange: match?.result?.pctChange ?? null };
    });
    saveGrading(previousDate, merged);
    console.log(`Graded ${merged.length} crypto ticker(s) from ${previousDate}.`);
  }

  if (followUpItems.length === 0) {
    console.log("No coins flagged tonight — nothing cleared the bar for a long setup.");
    return;
  }

  console.log(`Flagged: ${followUpItems.map((p) => `${p.ticker} (confidence=${p.confidence}, eventRisk=${p.eventRisk})`).join("; ")}`);

  const items = followUpItems.map((p) => ({
    ticker: p.ticker,
    direction: "long", // Alpaca crypto is spot/long-only — see paperTrade.js/config.js comments
    confidence: p.confidence,
    eventRisk: p.eventRisk,
    notionalOverride: CRYPTO_PAPER_TRADE_BASE_NOTIONAL,
  }));
  await openNewPositions(date, items, {}, "nightly_crypto");
  console.log(`\nSimulated (paper) crypto position(s) submitted — zero real capital, source tagged 'nightly_crypto', $${CRYPTO_PAPER_TRADE_BASE_NOTIONAL} flat each.`);
}

run().catch((err) => {
  console.error("cryptoNightly failed:", err);
  process.exit(1);
});

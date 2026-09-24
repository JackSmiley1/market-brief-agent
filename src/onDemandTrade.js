import "dotenv/config";
import { fetchMarketData } from "./fetchMarketData.js";
import { fetchCompanyNews } from "./fetchNews.js";
import { generateOnDemandCall } from "./generateBrief.js";
import { openNewPositions, reconcileEntries, reconcileExits } from "./paperTrade.js";

// On-demand / prompted analysis — the counterpart to the nightly fixed-
// watchlist pipeline (index.js). Lets you ask about a specific ticker or
// small set of tickers right now instead of waiting for the scheduled run,
// still entirely on Alpaca's paper API (zero real capital). Trades opened
// here are tagged source='on_demand' in the db (see db.js) so they never
// get mixed into the nightly system's evidence-based sizing stats —
// checkpoint.js and the dashboard export both filter to source='nightly'
// for that analysis, on purpose.
//
// Usage:
//   node src/onDemandTrade.js AAPL,MSFT "thinking about AI capex names"
//   node src/onDemandTrade.js NVDA --analyze-only
//
// Without --analyze-only, any tickers Claude actually flags (it's allowed
// to flag none) get a simulated paper position opened immediately, same
// sizing rules (SIZING_ADJUSTMENTS in config.js) as the nightly system.

function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function daysAgoISO(n) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() - n * 24 * 60 * 60 * 1000)
  );
}

async function run() {
  const args = process.argv.slice(2);
  const analyzeOnly = args.includes("--analyze-only");
  const positional = args.filter((a) => a !== "--analyze-only");

  const tickerArg = positional[0];
  const query = positional.slice(1).join(" ") || "General analysis requested — is there a real setup here right now?";

  if (!tickerArg) {
    console.error('Usage: node src/onDemandTrade.js TICKER[,TICKER2,...] ["optional context"] [--analyze-only]');
    process.exit(1);
  }

  const symbols = tickerArg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const date = todayISO();

  console.log(`On-demand analysis for ${symbols.join(", ")} — ${date}${analyzeOnly ? " (analyze-only, no simulated trade)" : ""}`);

  // Reconcile anything left pending from a PRIOR entry/exit — nightly or
  // on-demand, this is source-agnostic, same as the nightly pipeline's own
  // reconcile step. Without this, an on-demand-opened position's fill only
  // ever gets recorded whenever the next scheduled nightly run happens to
  // reconcile it, even if the user triggers another on-demand request
  // sooner — there's no reason to make them wait for the cron just to see
  // yesterday's on-demand trade actually fill.
  await reconcileEntries();
  await reconcileExits();

  const marketData = await fetchMarketData(symbols);
  if (marketData.length === 0) {
    console.error("No market data returned for the requested ticker(s) — check the symbol(s) and try again.");
    process.exit(1);
  }
  const found = new Set(marketData.map((d) => d.symbol));
  const missing = symbols.filter((s) => !found.has(s));
  if (missing.length > 0) {
    console.warn(`No data returned for: ${missing.join(", ")} (invalid symbol, or not enough trading history) — continuing with the rest.`);
  }

  const news = [];
  for (const symbol of found) {
    const items = await fetchCompanyNews(symbol, daysAgoISO(7), date);
    news.push({ symbol, news: items });
  }

  const { analysisText, picks } = await generateOnDemandCall({ marketData, news, date, query });

  console.log("\n" + analysisText + "\n");

  if (picks.length === 0) {
    console.log("No simulated position opened — nothing here cleared the bar for a real setup.");
    return;
  }

  console.log(`Flagged: ${picks.map((p) => `${p.ticker} (${p.direction}, confidence=${p.confidence}, eventRisk=${p.eventRisk})`).join("; ")}`);

  if (analyzeOnly) {
    console.log("--analyze-only set — skipping simulated trade execution.");
    return;
  }

  const priceMap = Object.fromEntries(marketData.map((d) => [d.symbol, d.close]));
  await openNewPositions(date, picks, priceMap, "on_demand");
  console.log("\nSimulated (paper) position(s) submitted — zero real capital, source tagged 'on_demand'.");
}

run().catch((err) => {
  console.error("onDemandTrade failed:", err);
  process.exit(1);
});

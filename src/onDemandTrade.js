import "dotenv/config";
import { fetchMarketData } from "./fetchMarketData.js";
import { fetchCompanyNews } from "./fetchNews.js";
import { generateOnDemandCall } from "./generateBrief.js";
import { openNewPositions, reconcileEntries, reconcileExits } from "./paperTrade.js";
import { STOCK_ONDEMAND_LIMITS } from "./config.js";

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
//   node src/onDemandTrade.js NVDA "thinking about earnings" --amount=2500
//
// Without --analyze-only, any tickers Claude actually flags (it's allowed
// to flag none) get a simulated paper position opened immediately, same
// sizing rules (SIZING_ADJUSTMENTS in config.js) as the nightly system —
// UNLESS --amount=N is passed (added 2026-09-26, see config.js's
// STOCK_ONDEMAND_LIMITS), in which case that exact dollar amount is used
// for every flagged pick instead, same override mechanism (notionalOverride)
// crypto/fund-custom already use. Deliberately scoped to this on-demand
// path only — the nightly pipeline (index.js) never passes an amount and
// always sizes from real evidence, no exceptions.
//
// Accepts either a real ticker (AAPL) or a common single-word company/index
// name (Apple, Tesla, S&P) — resolved via NAME_TO_TICKER below. Anything not
// in that map is assumed to already be a ticker and passed through
// unchanged; fetchMarketData below will fail cleanly (clear error, no crash)
// if it turns out not to be a real one. Deliberately NOT a general-purpose
// company-name search (that would mean an extra API call and a new failure
// mode for every request) — just covers the names someone demoing this is
// actually likely to type.
const NAME_TO_TICKER = {
  apple: "AAPL", microsoft: "MSFT", google: "GOOGL", alphabet: "GOOGL",
  amazon: "AMZN", meta: "META", facebook: "META", tesla: "TSLA",
  nvidia: "NVDA", jpmorgan: "JPM", jpmorganchase: "JPM",
  bankofamerica: "BAC", goldmansachs: "GS", goldman: "GS",
  visa: "V", mastercard: "MA", exxon: "XOM", exxonmobil: "XOM",
  chevron: "CVX", jnj: "JNJ", johnsonandjohnson: "JNJ",
  unitedhealth: "UNH", pfizer: "PFE", walmart: "WMT", costco: "COST",
  homedepot: "HD", disney: "DIS", netflix: "NFLX", amd: "AMD",
  intel: "INTC", salesforce: "CRM", oracle: "ORCL", boeing: "BA",
  caterpillar: "CAT",
  // Indices / ETFs
  sp500: "SPY", spy: "SPY", nasdaq: "QQQ", qqq: "QQQ",
  dow: "DIA", dowjones: "DIA", russell: "IWM", russell2000: "IWM",
};

function resolveTicker(input) {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  return NAME_TO_TICKER[normalized] || input.toUpperCase();
}

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
  const amountArg = args.find((a) => a.startsWith("--amount="));
  const positional = args.filter((a) => a !== "--analyze-only" && !a.startsWith("--amount="));

  const tickerArg = positional[0];
  const query = positional.slice(1).join(" ") || "General analysis requested — is there a real setup here right now?";

  if (!tickerArg) {
    console.error('Usage: node src/onDemandTrade.js TICKER[,TICKER2,...] ["optional context"] [--analyze-only] [--amount=N]');
    process.exit(1);
  }

  let notionalOverride;
  if (amountArg) {
    const amount = Number(amountArg.slice("--amount=".length));
    if (!Number.isFinite(amount) || amount < STOCK_ONDEMAND_LIMITS.minUsd || amount > STOCK_ONDEMAND_LIMITS.maxUsd) {
      console.error(
        `--amount must be between $${STOCK_ONDEMAND_LIMITS.minUsd} and $${STOCK_ONDEMAND_LIMITS.maxUsd} (got "${amountArg.slice("--amount=".length)}").`
      );
      process.exit(1);
    }
    notionalOverride = amount;
  }

  const rawInputs = tickerArg.split(",").map((s) => s.trim()).filter(Boolean);
  const symbols = rawInputs.map(resolveTicker);
  const resolvedNames = rawInputs
    .map((raw, i) => (raw.toUpperCase() !== symbols[i] ? `${raw} → ${symbols[i]}` : null))
    .filter(Boolean);
  const date = todayISO();

  console.log(`On-demand analysis for ${symbols.join(", ")} — ${date}${analyzeOnly ? " (analyze-only, no simulated trade)" : ""}`);
  if (resolvedNames.length > 0) console.log(`Resolved company name(s): ${resolvedNames.join(", ")}`);

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
  if (notionalOverride !== undefined) {
    console.log(`--amount=${notionalOverride} set — every flagged pick will use this exact size instead of evidence-based sizing.`);
  }

  if (analyzeOnly) {
    console.log("--analyze-only set — skipping simulated trade execution.");
    return;
  }

  const priceMap = Object.fromEntries(marketData.map((d) => [d.symbol, d.close]));
  const items = notionalOverride !== undefined ? picks.map((p) => ({ ...p, notionalOverride })) : picks;
  await openNewPositions(date, items, priceMap, "on_demand");
  console.log("\nSimulated (paper) position(s) submitted — zero real capital, source tagged 'on_demand'.");
}

run().catch((err) => {
  console.error("onDemandTrade failed:", err);
  process.exit(1);
});

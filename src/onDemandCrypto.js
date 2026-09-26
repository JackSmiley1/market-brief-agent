import "dotenv/config";
import { fetchCryptoMarketData } from "./fetchCryptoMarketData.js";
import { fetchCryptoNews } from "./fetchNews.js";
import { generateCryptoOnDemandCall } from "./generateBrief.js";
import { openNewPositions, reconcileEntries, reconcileExits } from "./paperTrade.js";
import { CRYPTO_ONDEMAND_LIMITS } from "./config.js";

// On-demand crypto analysis — the Crypto tab's counterpart to
// onDemandTrade.js, added 2026-09-26 to replace the old fixed BTC/ETH-only
// buy-and-hold button. Key differences from the stock version:
//   - ONE symbol per request, not a comma list — the dashboard's crypto
//     button is built around "pick one coin, pick an amount," not a
//     watchlist scan.
//   - The USER supplies the dollar amount (see CRYPTO_ONDEMAND_LIMITS —
//     $25-$10,000), not config.js's SIZING_ADJUSTMENTS. Claude only decides
//     whether to invest at all, never how much (see paperTrade.js's
//     notionalOverride).
//   - Long-only, always. Alpaca's crypto product doesn't support margin or
//     short selling (confirmed directly against Alpaca's own docs, not
//     assumed) — there is no short path here to accidentally hit.
//   - Trades open here still close after one session, same as 'on_demand'
//     stock trades (NOT held indefinitely — that indefinite-hold behavior
//     is specific to the separate, still-existing 'fund_hold' allocation).
//
// Tagged source='crypto_ondemand' so it never mixes into the nightly
// evidence-based sizing analysis (checkpoint.js / exportSite.js's stock
// stats both filter to source='nightly').
//
// Usage:
//   node src/onDemandCrypto.js bitcoin 250
//   node src/onDemandCrypto.js SOL/USD 1000 "thinking about L1 rotation"
const NAME_TO_CRYPTO_SYMBOL = {
  bitcoin: "BTC/USD", btc: "BTC/USD",
  ethereum: "ETH/USD", eth: "ETH/USD",
  solana: "SOL/USD", sol: "SOL/USD",
  dogecoin: "DOGE/USD", doge: "DOGE/USD",
  litecoin: "LTC/USD", ltc: "LTC/USD",
  cardano: "ADA/USD", ada: "ADA/USD",
  polkadot: "DOT/USD", dot: "DOT/USD",
  chainlink: "LINK/USD", link: "LINK/USD",
  avalanche: "AVAX/USD", avax: "AVAX/USD",
  uniswap: "UNI/USD", uni: "UNI/USD",
  stellar: "XLM/USD", xlm: "XLM/USD",
  ripple: "XRP/USD", xrp: "XRP/USD",
  bitcoincash: "BCH/USD", bch: "BCH/USD",
  shibainu: "SHIB/USD", shiba: "SHIB/USD", shib: "SHIB/USD",
  polygon: "MATIC/USD", matic: "MATIC/USD",
  aave: "AAVE/USD",
  maker: "MKR/USD", mkr: "MKR/USD",
  usdcoin: "USDC/USD", usdc: "USDC/USD",
  tether: "USDT/USD", usdt: "USDT/USD",
  pepe: "PEPE/USD",
  yearnfinance: "YFI/USD", yfi: "YFI/USD",
  thegraph: "GRT/USD", grt: "GRT/USD",
};

// Resolved via the map above for common names, else assumed to already be a
// real Alpaca pair (either "SOL/USD" as typed, or a bare "SOL" normalized to
// "SOL/USD") — NOT a general-purpose coin search, same deliberate tradeoff
// onDemandTrade.js makes for stock names. fetchCryptoMarketData below fails
// cleanly (clear warning, no crash, no trade) if it turns out not to be a
// real supported pair.
function resolveCryptoSymbol(input) {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (NAME_TO_CRYPTO_SYMBOL[normalized]) return NAME_TO_CRYPTO_SYMBOL[normalized];
  if (input.includes("/")) return input.toUpperCase();
  return `${input.toUpperCase()}/USD`;
}

function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

async function run() {
  const args = process.argv.slice(2);
  const rawSymbol = args[0];
  const amount = Number(args[1]);
  const query = args.slice(2).join(" ") || "General analysis requested — is this a reasonable entry point right now?";

  if (!rawSymbol || !Number.isFinite(amount)) {
    console.error('Usage: node src/onDemandCrypto.js SYMBOL AMOUNT ["optional context"]');
    process.exit(1);
  }
  if (amount < CRYPTO_ONDEMAND_LIMITS.minUsd || amount > CRYPTO_ONDEMAND_LIMITS.maxUsd) {
    console.error(
      `Amount must be between $${CRYPTO_ONDEMAND_LIMITS.minUsd} and $${CRYPTO_ONDEMAND_LIMITS.maxUsd} (got $${amount}).`
    );
    process.exit(1);
  }

  const symbol = resolveCryptoSymbol(rawSymbol);
  const date = todayISO();
  console.log(`On-demand crypto analysis for ${symbol} ($${amount}) — ${date}`);

  // Same reconcile-anything-pending step as onDemandTrade.js/investAllocation.js.
  await reconcileEntries();
  await reconcileExits();

  const marketData = await fetchCryptoMarketData([symbol]);
  if (marketData.length === 0) {
    console.error(
      `No market data returned for ${symbol} — check the symbol/name and try again. Alpaca supports 20+ coins across 56 pairs; not every name resolves automatically, but any real pair (e.g. "SOL/USD") can be typed directly.`
    );
    process.exit(1);
  }

  const news = await fetchCryptoNews();

  const { analysisText, decision } = await generateCryptoOnDemandCall({ marketData, news, date, query, amount });
  console.log("\n" + analysisText + "\n");

  if (!decision || decision.invest !== true) {
    console.log("No simulated position opened — nothing here cleared the bar for a real entry right now.");
    return;
  }

  console.log(
    `Investing $${amount} in ${symbol} (confidence=${decision.confidence ?? "?"}, eventRisk=${decision.eventRisk ?? "?"}).`
  );
  await openNewPositions(
    date,
    [
      {
        ticker: symbol,
        direction: "long", // Alpaca crypto is spot/long-only — see paperTrade.js/config.js comments
        confidence: decision.confidence,
        eventRisk: decision.eventRisk,
        notionalOverride: amount,
      },
    ],
    {},
    "crypto_ondemand"
  );
  console.log("\nSimulated (paper) crypto position submitted — zero real capital, source tagged 'crypto_ondemand'.");
}

run().catch((err) => {
  console.error("onDemandCrypto failed:", err);
  process.exit(1);
});

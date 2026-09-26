import axios from "axios";

// Alpaca's crypto market data lives on a different base/version than the
// stock bars used by fetchMarketData.js (v1beta3, not v2, and no "feed"
// param — that IEX-vs-SIP entitlement distinction is a stocks-only concept).
// Symbols use "BASE/QUOTE" format (e.g. "BTC/USD", "SOL/USD") — see
// onDemandCrypto.js for how a typed name/symbol resolves to this format.
const CRYPTO_DATA_BASE = "https://data.alpaca.markets/v1beta3/crypto/us";

const headers = {
  "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID,
  "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY,
};

// Unlike fetchMarketData.js's per-symbol loop, Alpaca's crypto bars endpoint
// accepts multiple symbols in a single request (a "symbols" query param,
// comma-separated) — one HTTP call covers everything requested. Currently
// only ever called with one symbol at a time (onDemandCrypto.js analyzes one
// crypto per request), but written to accept a list since the endpoint
// itself does, same spirit as fetchMarketData's own symbols param.
export async function fetchCryptoMarketData(symbols) {
  if (!symbols || symbols.length === 0) return [];

  const start = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = {
    symbols: symbols.join(","),
    timeframe: "1Day",
    limit: 6,
    start,
    sort: "desc", // see fetchMarketData.js's identical comment — avoids silently getting the OLDEST 6 bars in the window
  };

  let barsBySymbol;
  try {
    const res = await axios.get(`${CRYPTO_DATA_BASE}/bars`, { headers, params });
    barsBySymbol = res.data?.bars ?? {};
  } catch (err) {
    console.error(
      "fetchCryptoMarketData: request failed:",
      err.response?.data ? JSON.stringify(err.response.data) : err.message
    );
    return [];
  }

  const results = [];
  for (const symbol of symbols) {
    const bars = (barsBySymbol[symbol] ?? []).slice().reverse();
    if (bars.length < 2) {
      console.warn(
        `fetchCryptoMarketData: only got ${bars.length} bar(s) for ${symbol}, skipping (need at least 2 — check the symbol is a real Alpaca-supported pair, e.g. "BTC/USD").`
      );
      continue;
    }
    const today = bars[bars.length - 1];
    const prior = bars[bars.length - 2];
    const avgVolume = bars.slice(0, -1).reduce((sum, b) => sum + b.v, 0) / (bars.length - 1);
    const pctChange = ((today.c - prior.c) / prior.c) * 100;
    const volumeRatio = avgVolume > 0 ? today.v / avgVolume : null;

    results.push({
      symbol,
      close: today.c,
      priorClose: prior.c,
      pctChange: Number(pctChange.toFixed(2)),
      volume: today.v,
      avgVolume: Math.round(avgVolume),
      volumeRatio: volumeRatio !== null ? Number(volumeRatio.toFixed(2)) : null,
      barDate: today.t.slice(0, 10),
    });
  }
  return results;
}

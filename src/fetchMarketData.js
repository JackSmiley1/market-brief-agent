import axios from "axios";
import { WATCHLIST, ALPACA_DATA_BASE } from "./config.js";

const headers = {
  "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID,
  "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY,
};

// Fetch last 6 daily bars per symbol so we can compute today's move
// and a rough average-volume comparison.
async function fetchBarsForSymbol(symbol) {
  const url = `${ALPACA_DATA_BASE}/stocks/${symbol}/bars`;

  // Alpaca defaults `start` to "the beginning of the current day" if omitted,
  // which returns nothing on weekends/holidays (and even on trading days,
  // limits you to today's single bar). Going back 14 calendar days safely
  // covers 6 trading days across any combination of weekends/holidays.
  const start = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const params = {
    timeframe: "1Day",
    limit: 6,
    adjustment: "raw",
    start,
    // Paper accounts are only entitled to the IEX feed; the API defaults to
    // `sip`, which requires a paid subscription and silently returns no
    // data (not an error) when the account isn't entitled to it.
    feed: "iex",
    // `sort` defaults to ascending. With a 14-day window and limit:6, that
    // would silently hand back the OLDEST 6 bars in the window, not the
    // most recent 6 — stale data with no error to signal it. Request
    // newest-first instead, then reverse below to restore the
    // oldest-to-newest order the rest of this file assumes.
    sort: "desc",
  };
  const res = await axios.get(url, { headers, params });
  const bars = res.data.bars ?? [];
  return bars.reverse();
}

export async function fetchMarketData() {
  const results = [];
  for (const symbol of WATCHLIST) {
    try {
      const bars = await fetchBarsForSymbol(symbol);
      if (bars.length < 2) {
        console.warn(`fetchMarketData: only got ${bars.length} bar(s) for ${symbol}, skipping (need at least 2).`);
        continue;
      }

      const today = bars[bars.length - 1];
      const prior = bars[bars.length - 2];
      const avgVolume =
        bars.slice(0, -1).reduce((sum, b) => sum + b.v, 0) / (bars.length - 1);

      const pctChange = ((today.c - prior.c) / prior.c) * 100;
      const volumeRatio = today.v / avgVolume;

      results.push({
        symbol,
        close: today.c,
        priorClose: prior.c,
        pctChange: Number(pctChange.toFixed(2)),
        volume: today.v,
        avgVolume: Math.round(avgVolume),
        volumeRatio: Number(volumeRatio.toFixed(2)),
      });
    } catch (err) {
      console.error(`fetchMarketData: failed for ${symbol}:`, err.message);
    }
  }
  return results;
}

import axios from "axios";
import { FINNHUB_BASE } from "./config.js";

// General market news (top headlines)
//
// Deliberately fails open (returns []) rather than throwing. Unlike
// fetchMarketData.js — where a per-symbol try/catch already existed — this
// had no error handling at all until this pass: a single Finnhub hiccup
// (rate limit, timeout, outage) here would propagate straight through
// index.js's top-level catch and kill the ENTIRE nightly run, discarding a
// market-data fetch that had already succeeded and a brief that could still
// have been generated (with lighter context) instead of not at all. News
// context genuinely matters for brief quality, but a missing external news
// feed shouldn't be able to take down the whole pipeline the way a broken
// position-sizing formula should (see tests/config.test.js) — those are
// different failure severities and are now handled accordingly.
export async function fetchMarketNews(limit = 15) {
  const url = `${FINNHUB_BASE}/news`;
  const params = { category: "general", token: process.env.FINNHUB_KEY };
  try {
    const res = await axios.get(url, { params });
    return (res.data ?? []).slice(0, limit).map((item) => ({
      headline: item.headline,
      summary: item.summary,
      source: item.source,
      datetime: item.datetime,
    }));
  } catch (err) {
    console.error("fetchMarketNews: failed to fetch general market news, proceeding without it:", err.message);
    return [];
  }
}

// Company-specific news, used for the day's biggest movers only
// (don't call this for all 30+ tickers every run — target the movers).
// Same fail-open reasoning as fetchMarketNews above — called in a loop over
// ~10 movers in index.js, so without this, one bad Finnhub response for a
// single ticker would previously have taken the whole run down with it.
export async function fetchCompanyNews(symbol, fromDate, toDate) {
  const url = `${FINNHUB_BASE}/company-news`;
  const params = { symbol, from: fromDate, to: toDate, token: process.env.FINNHUB_KEY };
  try {
    const res = await axios.get(url, { params });
    return (res.data ?? []).slice(0, 5).map((item) => ({
      headline: item.headline,
      summary: item.summary,
      source: item.source,
    }));
  } catch (err) {
    console.error(`fetchCompanyNews: failed to fetch news for ${symbol}, proceeding without it:`, err.message);
    return [];
  }
}

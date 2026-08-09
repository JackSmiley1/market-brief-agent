import axios from "axios";
import { FINNHUB_BASE } from "./config.js";

// General market news (top headlines)
export async function fetchMarketNews(limit = 15) {
  const url = `${FINNHUB_BASE}/news`;
  const params = { category: "general", token: process.env.FINNHUB_KEY };
  const res = await axios.get(url, { params });
  return (res.data ?? []).slice(0, limit).map((item) => ({
    headline: item.headline,
    summary: item.summary,
    source: item.source,
    datetime: item.datetime,
  }));
}

// Company-specific news, used for the day's biggest movers only
// (don't call this for all 30+ tickers every run — target the movers)
export async function fetchCompanyNews(symbol, fromDate, toDate) {
  const url = `${FINNHUB_BASE}/company-news`;
  const params = { symbol, from: fromDate, to: toDate, token: process.env.FINNHUB_KEY };
  const res = await axios.get(url, { params });
  return (res.data ?? []).slice(0, 5).map((item) => ({
    headline: item.headline,
    summary: item.summary,
    source: item.source,
  }));
}

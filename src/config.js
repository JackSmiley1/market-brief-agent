export const WATCHLIST = [
  "SPY", "QQQ", "DIA", "IWM",
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
  "JPM", "BAC", "GS", "V", "MA",
  "XOM", "CVX",
  "JNJ", "UNH", "PFE",
  "WMT", "COST", "HD",
  "DIS", "NFLX",
  "AMD", "INTC", "CRM", "ORCL",
  "BA", "CAT"
  // adjust freely — this is your Phase 1 universe, not a permanent list
];

export const ALPACA_DATA_BASE = "https://data.alpaca.markets/v2";
export const FINNHUB_BASE = "https://finnhub.io/api/v1";

// paper-api, not api.alpaca.markets — this must only ever point at the
// paper trading endpoint. The ALPACA_KEY_ID in .env is itself a paper key
// (starts with "PK", not "AK"), so live orders would be rejected by Alpaca
// even if this URL were ever changed by mistake — but keep it pointed at
// paper-api explicitly as the primary safeguard, not the fallback one.
export const ALPACA_TRADING_BASE = "https://paper-api.alpaca.markets/v2";

// Fixed notional (dollar) amount per simulated position. Flat sizing on
// purpose — varying size by "conviction" would tangle two unproven things
// (signal quality and sizing quality) together in the P&L result. Keep this
// the only sizing knob so early P&L reads as a test of the picks themselves.
export const PAPER_TRADE_NOTIONAL = 1000;

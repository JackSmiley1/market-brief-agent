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

// Broad index/fund ETF proxies tracked separately from WATCHLIST, purely for
// the dashboard's Mutual Funds tab — these are never analyzed by Claude,
// never sized, and never paper-traded, only fetched nightly (via the same
// fetchMarketData used for WATCHLIST, so no new API key or extra service is
// needed) and displayed as-is. Honest naming note: Alpaca's market data
// covers ETFs, not literal mutual fund share classes (e.g. Vanguard's own
// VFIAX/VTSAX), which generally aren't quotable the same way through a
// standard brokerage data feed. VOO/VTI are Vanguard's own ETF equivalents
// of those funds (same underlying index, same manager, different wrapper),
// which is the closest honest real-data substitute available here — the
// dashboard says so explicitly rather than implying these are the mutual
// fund tickers themselves.
export const FUND_WATCHLIST = [
  { ticker: "SPY", label: "S&P 500 (SPY)" },
  { ticker: "VOO", label: "Vanguard S&P 500 ETF (VOO)" },
  { ticker: "VTI", label: "Vanguard Total Stock Market ETF (VTI)" },
  { ticker: "QQQ", label: "Nasdaq-100 (QQQ)" },
  { ticker: "DIA", label: "Dow Jones Industrial Average (DIA)" },
  { ticker: "IWM", label: "Russell 2000 (IWM)" },
];

// Buy-and-hold allocations (added 2026-09-25) — deliberately separate from
// everything above. These are never analyzed by Claude, never sized by the
// evidence-based SIZING_ADJUSTMENTS (that gate was derived from stock
// nightly-watchlist trade history and would be contaminated by mixing in a
// static long-only allocation), and never closed after one session the way
// nightly/on_demand positions are — see paperTrade.js's closeMaturePositions
// for the exclusion. Opened once via src/investAllocation.js (triggered from
// the dashboard's Invest buttons or manually), idempotent: re-running it
// checks for an existing open/pending position per ticker first rather than
// buying again.
//
// Fund picks: 5 of the 6 tracked FUND_WATCHLIST ETF proxies, dropping IWM
// (Russell 2000 / small-cap) as the "safest, most historically consistent"
// cut — small-caps are the most volatile of the six, so excluding it directly
// matches the stated selection criteria. The remaining five are large-cap/
// total-market index trackers, the closest honest match to "safe, broad
// index/mutual-fund-style investing" this system can actually execute.
export const FUND_ALLOCATION = {
  tickers: ["SPY", "VOO", "VTI", "QQQ", "DIA"],
  notionalPerPosition: 300, // see PORTFOLIO_LIMITS comment below for why this size
  source: "fund_hold",
};

// Superseded 2026-09-26 by src/onDemandCrypto.js — a Claude-analyzed,
// user-chosen-symbol, user-chosen-amount flow (see CRYPTO_ONDEMAND_LIMITS
// below), replacing this fixed BTC/ETH-only static allocation per an
// explicit product decision to support any Alpaca-supported crypto pair
// instead of just two hardcoded coins. Left here, commented, only as a
// record of what the dashboard's old "Invest in BTC & ETH" button did — not
// imported anywhere anymore. Any rows already written with source=
// 'crypto_hold' from before this change are still real (simulated) positions
// and are intentionally left alone (still excluded from close/wash-trade
// checks in paperTrade.js) rather than force-closed by this refactor.
// export const CRYPTO_ALLOCATION = {
//   symbols: ["BTC/USD", "ETH/USD"],
//   notionalPerPosition: 300,
//   source: "crypto_hold",
// };

// User-chosen dollar range for the Crypto tab's flexible "Invest" flow
// (src/onDemandCrypto.js) — the user types any Alpaca-supported crypto
// symbol/name and an amount in this range; Claude only decides whether to
// open a long position at all (Alpaca's crypto product is spot-only, no
// margin, no shorting — see the "Margin and Short Selling" note in Alpaca's
// docs), never how much to size it.
export const CRYPTO_ONDEMAND_LIMITS = { minUsd: 25, maxUsd: 10000 };

// User-chosen dollar range for the Mutual Funds tab's "invest in another
// fund" custom-ticker flow (src/investFundCustom.js) — same buy-and-hold,
// no-Claude-analysis logic as FUND_ALLOCATION above, just with a
// user-supplied ticker and amount instead of the fixed five. Reuses the same
// 'fund_hold' source (not a new one) so it shows up in the existing "Current
// Fund Holdings" list and existing exclusion rules with zero extra plumbing.
export const FUND_CUSTOM_LIMITS = { minUsd: 5, maxUsd: 10000 };

// Optional user-chosen dollar range for the stock on-demand invest bar
// (src/onDemandTrade.js's --amount flag), added 2026-09-26. A real, explicit
// departure from this project's own headline pitch — position size derived
// from real evidence, not fixed or guessed — but scoped ONLY to on-demand
// trades a person deliberately triggers by hand, never the nightly
// automated pipeline (index.js never passes an amount; nightly picks are
// always sized by computeNotional, no exceptions). Optional, not required:
// omit it and an on-demand trade still sizes exactly as before. Documented
// plainly in status-memo.md rather than left implicit, since this is exactly
// the kind of tradeoff this project has otherwise been careful to call out
// rather than quietly ship.
export const STOCK_ONDEMAND_LIMITS = { minUsd: 25, maxUsd: 10000 };

export const ALPACA_DATA_BASE = "https://data.alpaca.markets/v2";
export const FINNHUB_BASE = "https://finnhub.io/api/v1";

// paper-api, not api.alpaca.markets — this must only ever point at the
// paper trading endpoint. The ALPACA_KEY_ID in .env is itself a paper key
// (starts with "PK", not "AK"), so live orders would be rejected by Alpaca
// even if this URL were ever changed by mistake — but keep it pointed at
// paper-api explicitly as the primary safeguard, not the fallback one.
export const ALPACA_TRADING_BASE = "https://paper-api.alpaca.markets/v2";

// Base notional (dollar) amount per simulated position, before the
// evidence-based adjustments below. Sizing started flat on purpose — early
// on, varying size by "conviction" would have tangled two unproven things
// (signal quality and sizing quality) together in the P&L result, before
// there was any evidence either mattered. That phase is over: the
// September 8-10 checkpoint (59 closed trades) showed low confidence
// underperforming medium (-1.46% vs +0.71% avg return), shorts persistently
// losing net money across 26 trades despite a normal win rate, and the
// single worst trade in the dataset (CRM, -15.59%) was a low-confidence
// short into a scheduled earnings report. These are no longer guesses.
export const PAPER_TRADE_BASE_NOTIONAL = 1000;

// Multiplicative cuts applied on top of the base, stacking when more than
// one applies. E.g. a low-confidence, earnings-adjacent short sizes at
// 1000 * 0.5 * 0.5 * 0.5 = $125 — an 8x cut from flat sizing for exactly
// the combination that produced the worst trade so far.
export const SIZING_ADJUSTMENTS = {
  lowConfidence: 0.5,   // low confidence has underperformed medium in real data
  eventRisk: 0.5,       // scheduled earnings/regulatory events can gap price beyond a normal day's move
  shortDirection: 0.5,  // shorts are a persistent net loser across 26 real trades despite a ~50% win rate
};

// Computes the actual dollar size for a position from the base plus
// whichever adjustments apply. Exported (not inlined in paperTrade.js) so
// it's independently testable and the tuning knobs live in one obvious
// place rather than scattered through order-submission logic.
export function computeNotional({ confidence, eventRisk, direction }) {
  let notional = PAPER_TRADE_BASE_NOTIONAL;
  if (confidence === "low") notional *= SIZING_ADJUSTMENTS.lowConfidence;
  if (eventRisk === true) notional *= SIZING_ADJUSTMENTS.eventRisk;
  if (direction === "short") notional *= SIZING_ADJUSTMENTS.shortDirection;
  return Math.round(notional);
}

// Portfolio-level exposure caps — the gap the per-position sizing above
// never covered. computeNotional controls how big any ONE position is;
// nothing previously controlled how many were open AT ONCE or how much
// total capital was deployed simultaneously. A normal night opens 3-5
// nightly picks (~$2,000-4,000 notional combined at current sizing) plus
// whatever the prior night's positions still winding down (exit_pending)
// add on top — these caps are set generously above that normal range
// (roughly 1.5-2x a typical night) so ordinary operation is never blocked,
// while still providing a real ceiling against a pathological batch: a bug
// that repeatedly re-enters, an on-demand session run back-to-back many
// times, or a night where the model flags an unusually large watchlist.
// Counts/sums ALL open exposure regardless of source (nightly + on_demand)
// — this is about real (simulated) capital currently at risk in the one
// Alpaca paper account, not about keeping the sizing-evidence analysis
// clean (that's what the source column is for, see db.js).
//
// Raised again 2026-09-26 (from 22 / $8,500) for the new user-amount flows
// above: CRYPTO_ONDEMAND_LIMITS and FUND_CUSTOM_LIMITS both allow a single
// trade up to $10,000, which alone would have exceeded the old $8,500 total
// cap and silently blocked every legitimate max-size request (this check
// fails open/quiet by design elsewhere — see openNewPositions' cap-skip
// log — so a request that never even reaches Alpaca would have looked like
// nothing happened, not a clear error). $20,000 leaves room for one such
// trade plus the existing ~$2,000-4,000 typical nightly range and the
// permanent fund_hold allocation, without raising maxConcurrentPositions
// further (position *count* wasn't the constraint here, size was).
//
// Prior history: raised 2026-09-25 from 15 / $6,000 to make room for the
// original fixed buy-and-hold allocations (5 fund + 2 crypto @ $300 each).
export const PORTFOLIO_LIMITS = {
  maxConcurrentPositions: 22,
  maxTotalNotionalUsd: 20000,
};

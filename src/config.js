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

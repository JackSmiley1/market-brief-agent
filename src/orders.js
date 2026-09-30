// Pure order-construction helpers (added 2026-09-26). No db, no network,
// no side effects on import, so they can be unit tested directly (see
// tests/orders.test.js), per the scope note in tests/config.test.js.

export function isCrypto(symbol) {
  return symbol.includes("/");
}

// Builds the order that closes ONE paper_trades row by its own quantity:
// sell for a long, buy-to-cover for a short. Why not Alpaca's
// DELETE /positions/{symbol}: that liquidates every share of the symbol in
// the account, so closing a nightly SPY pick would also dump the Top 5
// Funds allocation's SPY shares held in the same account.
//
// Returns null when the caller should fall back to the whole-symbol close:
//   - crypto: Alpaca charges crypto fees in the asset received, so the
//     held quantity ends up slightly BELOW the order's filled_qty, and a
//     sell for filled_qty would be rejected. Crypto has no buy-and-hold
//     overlap today (legacy 'crypto_hold' only, no new rows), so the
//     whole-symbol close is both correct and safe there.
//   - no recorded qty (rows opened before qty tracking existed).
// The caller must check for a buy-and-hold overlap before using that
// fallback on a stock.
export function buildCloseOrder({ ticker, direction, qty }) {
  if (isCrypto(ticker)) return null;
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return null;
  return {
    symbol: ticker,
    qty: String(q),
    side: direction === "short" ? "buy" : "sell",
    type: "market",
    time_in_force: "day",
  };
}

// Symbol for Alpaca's /v2/positions/{symbol} path. Crypto orders use the
// slashed pair ("BTC/USD") but positions are keyed without it ("BTCUSD");
// a raw slash in the path also turns into an extra URL segment. Sending
// ".../positions/BTC/USD" returns 404 (see alpaca-py issue #537), which
// would have failed every crypto close. Stocks pass through unchanged.
export function positionPathSymbol(symbol) {
  return encodeURIComponent(symbol.replace("/", ""));
}

// Kill switch (added 2026-09-30). One GitHub repository variable,
// TRADING_HALTED, passed into every trading workflow step as an env var.
// When it's "true", nothing new is ordered anywhere (opens, closes, fund
// buys, sells); reconciliation of already-placed orders still runs.
// Case-insensitive; anything other than "true" means trading is allowed.
export function tradingHalted(env = process.env) {
  return String(env.TRADING_HALTED ?? "").trim().toLowerCase() === "true";
}

import "dotenv/config";
import axios from "axios";
import { db } from "./db.js";
import { ALPACA_TRADING_BASE, WATCHLIST } from "./config.js";

// Read-only Gate A check (added 2026-09-30): asks Alpaca's asset records
// whether each watchlist symbol is tradable, supports fractional shares
// (needed for a $30 account that splits into a few dollars per position),
// and is easy to borrow. Places no orders. Runs from the manual
// refresh-benchmark workflow only, never the nightly run.
//
// Usage: npm run check-assets

const headers = {
  "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID,
  "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY,
};
const upsert = db.prepare(`
  INSERT INTO asset_checks (symbol, tradable, fractionable, easy_to_borrow, checked_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(symbol) DO UPDATE SET tradable = excluded.tradable, fractionable = excluded.fractionable,
    easy_to_borrow = excluded.easy_to_borrow, checked_at = excluded.checked_at
`);

const now = new Date().toISOString();
const notFractionable = [];
let failures = 0;
for (const symbol of WATCHLIST) {
  try {
    const { data: a } = await axios.get(`${ALPACA_TRADING_BASE}/assets/${symbol}`, { headers });
    upsert.run(symbol, a.tradable ? 1 : 0, a.fractionable ? 1 : 0, a.easy_to_borrow ? 1 : 0, now);
    if (!a.fractionable) notFractionable.push(symbol);
  } catch (err) {
    failures += 1;
    console.error(`checkAssets: ${symbol} failed:`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
  }
}
console.log(`checkAssets: checked ${WATCHLIST.length - failures}/${WATCHLIST.length}; not fractionable: ${notFractionable.join(", ") || "none"}.`);
if (failures === WATCHLIST.length) process.exit(1);

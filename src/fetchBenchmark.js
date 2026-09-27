import "dotenv/config";
import axios from "axios";
import { db } from "./db.js";
import { ALPACA_DATA_BASE } from "./config.js";

// Refreshes SPY daily bars from the first paper trade's date to today, so
// the benchmark covers the whole track record (added 2026-09-27). Idempotent
// upsert: safe to run every night; the first run backfills everything.
// Read-only market data (same IEX feed and keys as fetchMarketData.js);
// places no orders.
//
// Usage: npm run benchmark

const SYMBOL = "SPY";
const headers = {
  "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID,
  "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY,
};

async function run() {
  const firstRow = db
    .prepare(`SELECT MIN(substr(COALESCE(entry_filled_at, date), 1, 10)) AS d FROM paper_trades WHERE COALESCE(entry_filled_at, date) GLOB '[0-9]*'`)
    .get();
  const firstDay = firstRow?.d;
  if (!firstDay) {
    console.log("fetchBenchmark: no dated trades yet, nothing to benchmark.");
    return;
  }
  // A few days of slack before the first trade.
  const start = new Date(Date.parse(firstDay) - 7 * 86400000).toISOString().slice(0, 10);

  const bars = [];
  let pageToken;
  do {
    const res = await axios.get(`${ALPACA_DATA_BASE}/stocks/${SYMBOL}/bars`, {
      headers,
      params: { timeframe: "1Day", start, adjustment: "all", feed: "iex", limit: 10000, page_token: pageToken },
    });
    bars.push(...(res.data.bars ?? []));
    pageToken = res.data.next_page_token || undefined;
  } while (pageToken);

  const upsert = db.prepare(`
    INSERT INTO benchmark_bars (date, symbol, open, close) VALUES (?, ?, ?, ?)
    ON CONFLICT(date, symbol) DO UPDATE SET open = excluded.open, close = excluded.close
  `);
  db.exec("BEGIN");
  try {
    // Daily bar timestamps are midnight ET expressed in UTC (e.g.
    // 2026-08-18T04:00:00Z), so the first 10 chars are the session date.
    for (const b of bars) upsert.run(b.t.slice(0, 10), SYMBOL, b.o, b.c);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  console.log(`fetchBenchmark: upserted ${bars.length} ${SYMBOL} bars from ${start} (${bars[0]?.t?.slice(0, 10)} -> ${bars.at(-1)?.t?.slice(0, 10)}).`);
}

run().catch((err) => {
  console.error("fetchBenchmark failed:", err.response?.data ? JSON.stringify(err.response.data) : err.message);
  process.exit(1);
});

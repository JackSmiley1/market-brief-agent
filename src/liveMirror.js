import { db } from "./db.js";
import { LIVE_MIRROR } from "./config.js";
import { tradingHalted } from "./orders.js";

// INERT live-account mirror for Gate A (added 2026-09-30). DRY RUN ONLY.
//
// After each nightly run, this works out what a separate $30, long-only
// live account would buy from that night's picks and records it in
// live_dryrun_orders. It sends NOTHING: this file makes no network calls,
// reads no API keys, and there is no live Alpaca endpoint anywhere in the
// repo (config.js's ALPACA_TRADING_BASE is hard-coded to paper). Turning
// this into real trading requires deliberately adding a live endpoint and
// live keys, which is Jack's call to make and log, not a flag to flip.
//
// Rules it models (Gate A scope): nightly picks only, longs only (shorting
// needs a $2,000 margin account), the $30 budget split evenly across that
// night's longs, skipping any slice under Alpaca's $1 fractional minimum,
// and it honors the same TRADING_HALTED kill switch as paper trading.
//
// Usage: node src/liveMirror.js   (the live-mirror.yml workflow runs it)

try {
  const latest = db.prepare(`SELECT MAX(date) AS d FROM paper_trades WHERE source = 'nightly'`).get()?.d;
  if (!latest) {
    console.log("liveMirror: no nightly picks yet.");
    process.exit(0);
  }
  const already = db.prepare(`SELECT COUNT(*) AS n FROM live_dryrun_orders WHERE pick_date = ?`).get(latest).n;
  if (already > 0) {
    console.log(`liveMirror: ${latest} already mirrored, nothing to do.`);
    process.exit(0);
  }
  const insert = db.prepare(`INSERT INTO live_dryrun_orders (created_at, pick_date, ticker, notional, status, note) VALUES (?, ?, ?, ?, ?, ?)`);
  const now = new Date().toISOString();
  const picks = db.prepare(`SELECT ticker, direction FROM paper_trades WHERE source = 'nightly' AND date = ? ORDER BY ticker`).all(latest);
  const longs = picks.filter((p) => p.direction === "long");
  const shorts = picks.filter((p) => p.direction === "short");

  if (tradingHalted()) {
    insert.run(now, latest, "-", null, "halted", "Kill switch on: no orders would be placed.");
    console.log("liveMirror: kill switch on, recorded as halted.");
  } else if (longs.length === 0) {
    insert.run(now, latest, "-", null, "no_longs", `No long picks tonight (${shorts.length} short pick(s) skipped: long-only account).`);
    console.log("liveMirror: no long picks, nothing would be bought.");
  } else {
    const each = Math.floor((LIVE_MIRROR.budgetUsd / longs.length) * 100) / 100;
    for (const p of longs) {
      if (each < LIVE_MIRROR.minOrderUsd) {
        insert.run(now, latest, p.ticker, each, "skipped_min", `$${each} is under the $${LIVE_MIRROR.minOrderUsd} fractional minimum.`);
      } else {
        insert.run(now, latest, p.ticker, each, "would_buy", "DRY RUN: nothing was sent to any broker.");
      }
    }
    for (const p of shorts) insert.run(now, latest, p.ticker, null, "skipped_short", "Long-only account: shorts need a $2,000 margin account.");
    console.log(`liveMirror: DRY RUN for ${latest}: would buy ${longs.map((p) => p.ticker).join(", ")} at $${each} each; skipped ${shorts.length} short(s). Nothing was sent.`);
  }
} catch (err) {
  console.error("liveMirror failed:", err.message);
  process.exit(1);
}

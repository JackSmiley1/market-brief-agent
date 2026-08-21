import "dotenv/config";
import { db } from "./db.js";

const closed = db
  .prepare(`SELECT date, ticker, entry_price, exit_price, notional, direction, realized_pnl, realized_pnl_pct FROM paper_trades WHERE status = 'closed' ORDER BY date`)
  .all();

const openCount = db.prepare(`SELECT COUNT(*) AS n FROM paper_trades WHERE status IN ('open', 'entry_pending', 'exit_pending')`).get().n;
const failedCount = db.prepare(`SELECT COUNT(*) AS n FROM paper_trades WHERE status IN ('entry_failed', 'exit_failed')`).get().n;

console.log(`Closed paper trades: ${closed.length} (from ${new Set(closed.map((r) => r.date)).size} distinct entry day(s))`);
if (openCount > 0) console.log(`In flight (not yet resolved): ${openCount}`);
if (failedCount > 0) console.log(`Failed (order rejected/canceled — excluded from P&L below): ${failedCount}`);

if (closed.length === 0) {
  console.log("\nNo closed trades yet — nothing to summarize.");
} else {
  const totalPnl = closed.reduce((sum, r) => sum + r.realized_pnl, 0);
  const totalNotional = closed.reduce((sum, r) => sum + r.notional, 0);
  const wins = closed.filter((r) => r.realized_pnl > 0).length;
  const losses = closed.filter((r) => r.realized_pnl < 0).length;
  const flat = closed.length - wins - losses;
  const avgPnlPct = closed.reduce((sum, r) => sum + r.realized_pnl_pct, 0) / closed.length;
  const best = [...closed].sort((a, b) => b.realized_pnl_pct - a.realized_pnl_pct)[0];
  const worst = [...closed].sort((a, b) => a.realized_pnl_pct - b.realized_pnl_pct)[0];

  console.log(`\nTotal realized P&L: $${totalPnl.toFixed(2)} on $${totalNotional.toFixed(0)} deployed (${((totalPnl / totalNotional) * 100).toFixed(2)}% blended return)`);
  console.log(`Win / loss / flat: ${wins} / ${losses} / ${flat}`);
  console.log(`Average return per trade: ${avgPnlPct.toFixed(2)}%`);
  console.log(`Best trade: ${best.ticker} (${best.date}) ${best.realized_pnl_pct.toFixed(2)}%`);
  console.log(`Worst trade: ${worst.ticker} (${worst.date}) ${worst.realized_pnl_pct.toFixed(2)}%`);

  for (const dir of ["long", "short"]) {
    const subset = closed.filter((r) => (r.direction ?? "long") === dir);
    if (subset.length === 0) continue;
    const subPnl = subset.reduce((sum, r) => sum + r.realized_pnl, 0);
    const subWins = subset.filter((r) => r.realized_pnl > 0).length;
    console.log(`  ${dir}: ${subset.length} trade(s), $${subPnl.toFixed(2)} P&L, ${subWins}/${subset.length} wins`);
  }

  if (closed.length < 20) {
    console.log("\nSample size is still small — treat this as directional, not conclusive, same caveat as the accuracy numbers.");
  }
}

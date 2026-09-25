// Shared trade-aggregation math, extracted out of checkpoint.js and
// exportSite.js — both previously had their own separately hand-written,
// near-identical implementation of this exact reduce/filter logic (n,
// total P&L, total notional, average return, win rate) that had drifted
// slightly apart in field names and rounding.
//
// Deliberately returns only the raw, UNROUNDED aggregates and leaves
// formatting entirely to the caller. checkpoint.js (a console report) and
// exportSite.js (the public dashboard's JSON) round and name fields
// differently on purpose — this module isn't trying to unify that, only to
// remove the duplicated arithmetic itself. Every caller was updated to
// reproduce its own exact prior output shape, verified by diffing real
// checkpoint.js/exportSite.js output before and after this change.
export function aggregateTrades(rows) {
  if (rows.length === 0) return null;
  const totalPnl = rows.reduce((s, r) => s + r.realized_pnl, 0);
  const totalNotional = rows.reduce((s, r) => s + r.notional, 0);
  const avgPnlPct = rows.reduce((s, r) => s + r.realized_pnl_pct, 0) / rows.length;
  const wins = rows.filter((r) => r.realized_pnl > 0).length;
  const winRatePct = (wins / rows.length) * 100;
  return { n: rows.length, totalPnl, totalNotional, avgPnlPct, wins, winRatePct };
}

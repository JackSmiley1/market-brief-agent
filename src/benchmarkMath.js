// Pure SPY-benchmark math (added 2026-09-27). No db, no network, no side
// effects on import, so it's unit tested directly (tests/benchmark.test.js).
//
// The question it answers: "was each trade better than just holding SPY
// over the exact same window?" Every nightly entry and exit fills at the
// 9:30 ET open (confirmed from the fill timestamps), so a trade's window is
// SPY's open on the entry-fill date -> SPY's open on the exit-fill date.
//
// Two separate comparisons, because they answer different questions:
//   - spyPnl: the same dollars held LONG in SPY over the same window. The
//     opportunity-cost view ("what if I'd just bought the index").
//   - marketAdjustedPct: the trade's return with the market's move removed,
//     signed by direction (long: trade - SPY, short: trade + SPY). Positive
//     means the pick beat what the market alone would have done in that
//     direction, i.e. stock-picking skill, separate from market direction.

// barsByDate: { "YYYY-MM-DD": { open, close } } for SPY.
export function benchmarkTrade(trade, barsByDate) {
  const entryDay = trade.entry_filled_at?.slice(0, 10);
  const exitDay = trade.exit_filled_at?.slice(0, 10);
  const a = entryDay && barsByDate[entryDay];
  const b = exitDay && barsByDate[exitDay];
  if (!a || !b || !(a.open > 0) || !(b.open > 0)) return null;
  const spyPct = (b.open / a.open - 1) * 100;
  const tradePct = trade.realized_pnl_pct;
  const marketAdjustedPct = trade.direction === "short" ? tradePct + spyPct : tradePct - spyPct;
  return {
    spyPct: round(spyPct, 3),
    spyPnl: round((trade.notional * spyPct) / 100, 2),
    marketAdjustedPct: round(marketAdjustedPct, 3),
  };
}

// trades: closed trades with entry_filled_at, exit_filled_at, direction,
// notional, realized_pnl, realized_pnl_pct. Trades without SPY bars for
// both ends are excluded from every figure (never silently zero-filled).
export function summarizeBenchmark(trades, barsByDate) {
  const matched = [];
  for (const t of trades) {
    const bm = benchmarkTrade(t, barsByDate);
    if (bm) matched.push({ t, bm });
  }
  const n = matched.length;
  if (n === 0) return { n: 0 };
  const sum = (f) => matched.reduce((acc, x) => acc + f(x), 0);
  const adj = matched.map((x) => x.bm.marketAdjustedPct);
  const stats = meanCi(adj);
  const side = (dir) => {
    const xs = matched.filter((x) => x.t.direction === dir).map((x) => x.bm.marketAdjustedPct);
    return xs.length ? { n: xs.length, ...meanCi(xs) } : { n: 0 };
  };
  return {
    n,
    excluded: trades.length - n,
    strategyPnl: round(sum((x) => x.t.realized_pnl), 2),
    spySameDollarsPnl: round(sum((x) => x.bm.spyPnl), 2),
    strategyAvgPct: round(sum((x) => x.t.realized_pnl_pct) / n, 3),
    spyAvgPct: round(sum((x) => x.bm.spyPct) / n, 3),
    marketAdjustedAvgPct: stats.mean,
    marketAdjustedCi95: stats.ci95,
    long: side("long"),
    short: side("short"),
  };
}

// SPY buy-and-hold from the open of `fromDay` to the latest close on/after it.
export function spyBuyAndHold(barsByDate, fromDay) {
  const days = Object.keys(barsByDate).filter((d) => d >= fromDay).sort();
  if (days.length === 0) return null;
  const first = barsByDate[days[0]], last = barsByDate[days.at(-1)];
  if (!(first.open > 0) || !(last.close > 0)) return null;
  return { from: days[0], to: days.at(-1), pct: round((last.close / first.open - 1) * 100, 2) };
}

function meanCi(xs) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean: round(mean, 3), ci95: null };
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const half = 1.96 * (sd / Math.sqrt(n));
  return { mean: round(mean, 3), ci95: [round(mean - half, 3), round(mean + half, 3)] };
}

function round(x, d) {
  return Number(x.toFixed(d));
}

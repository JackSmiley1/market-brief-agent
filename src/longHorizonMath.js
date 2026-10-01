// Pure math for the long-horizon track (added 2026-10-01). No db, no
// network. Tested in tests/longHorizon.test.js.
//
// FutureSearch-style split: Claude forecasts the BUSINESS (revenue growth and
// a future profit margin, with a p10-p90 range); this code turns that into a
// valuation and a ranking. Claude never picks the stocks directly.
//
// Implied annual return: grow today's revenue at the forecast median rate
// for `years`, apply the forecast margin to get future earnings, value those
// at one uniform exit P/E (the same for every stock, so the ranking is driven
// only by the forecasts vs. today's price), and annualize against today's
// market cap. Dividends and buybacks are ignored for simplicity, so it is a
// RANKING signal, not a price target.

export const DEFAULTS = { years: 5, exitPE: 18 };

export function impliedAnnualReturn({ revenueNowM, marketCapM, cagrPct, marginPct }, opts = DEFAULTS) {
  const { years, exitPE } = { ...DEFAULTS, ...opts };
  if (!(revenueNowM > 0) || !(marketCapM > 0) || !Number.isFinite(cagrPct) || !Number.isFinite(marginPct)) return null;
  const futureRevenue = revenueNowM * Math.pow(1 + cagrPct / 100, years);
  const futureEarnings = futureRevenue * (marginPct / 100);
  if (futureEarnings <= 0) return -100; // forecast losses rank last
  const futureValue = futureEarnings * exitPE;
  return Number(((Math.pow(futureValue / marketCapM, 1 / years) - 1) * 100).toFixed(2));
}

// Current revenue (in $ millions) from whichever Finnhub fields exist.
export function revenueNowFrom(metric = {}, profile = {}) {
  const cap = profile.marketCapitalization ?? metric.marketCapitalization;
  const ps = metric.psTTM ?? metric.psAnnual;
  if (cap > 0 && ps > 0) return cap / ps;
  const rps = metric.revenuePerShareTTM ?? metric.revenuePerShareAnnual;
  const shares = profile.shareOutstanding;
  if (rps > 0 && shares > 0) return rps * shares;
  return null;
}

// Top-n by implied return, ties broken by ticker for determinism.
export function pickTop(rows, n = 5) {
  return rows
    .filter((r) => Number.isFinite(r.impliedReturn))
    .sort((a, b) => b.impliedReturn - a.impliedReturn || a.symbol.localeCompare(b.symbol))
    .slice(0, n);
}

// Equal-weight, buy-and-hold value of one period's holdings, chained across
// rebalances, vs. SPY over the same windows.
// periods: [{ startDate, symbols }] sorted by startDate (startDate = the
//   first trading day AFTER the forecast, entered at its open).
// bars: { SYMBOL: { 'YYYY-MM-DD': { open, close } } }
// Returns [{ date, portfolioPct, spyPct }] for every date with complete data.
export function portfolioSeries(periods, bars) {
  const out = [];
  let carryP = 1, carryS = 1;
  for (let i = 0; i < periods.length; i++) {
    const { startDate, symbols } = periods[i];
    const endDate = periods[i + 1]?.startDate ?? "9999-12-31";
    const spy = bars.SPY || {};
    const entry = Object.fromEntries(symbols.map((s) => [s, bars[s]?.[startDate]?.open]));
    const spyEntry = spy[startDate]?.open;
    if (!spyEntry || symbols.some((s) => !(entry[s] > 0))) return out; // can't value this period yet
    const dates = Object.keys(spy).filter((d) => d >= startDate && d < endDate).sort();
    let lastP = 1, lastS = 1;
    for (const d of dates) {
      if (symbols.some((s) => !(bars[s]?.[d]?.close > 0))) continue;
      lastP = symbols.reduce((a, s) => a + bars[s][d].close / entry[s], 0) / symbols.length;
      lastS = spy[d].close / spyEntry;
      out.push({ date: d, portfolioPct: Number(((carryP * lastP - 1) * 100).toFixed(2)), spyPct: Number(((carryS * lastS - 1) * 100).toFixed(2)) });
    }
    carryP *= lastP;
    carryS *= lastS;
  }
  return out;
}

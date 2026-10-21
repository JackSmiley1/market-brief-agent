// Pure performance math for the research Worker (added 2026-10-20).
// No network, no Worker APIs: imported by research-worker.js and unit-tested
// in tests/research.test.js. Every number shown on a research page comes
// from here, computed from real daily bars. Claude never supplies a figure.
//
// bars: [{ t: "YYYY-MM-DD", c: close, v: volume }], oldest first.

const DAY = 86400000;

function closeOnOrBefore(bars, isoDate) {
  // Last bar dated on or before isoDate, or null if history doesn't reach it.
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= isoDate) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? ans : null;
}

function shiftDate(isoDate, days) {
  return new Date(Date.parse(isoDate + "T00:00:00Z") - days * DAY).toISOString().slice(0, 10);
}

function pct(from, to) {
  return from > 0 ? ((to / from) - 1) * 100 : null;
}

// Returns for 1 session, 10/30 calendar days, year to date, 1 year, 5 years.
// A window is null (not estimated) when history doesn't reach back far enough.
export function periodReturns(bars) {
  if (!bars || bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const out = { asOf: last.t, last: last.c };
  const win = (key, idx) => {
    out[key] = idx === null || idx === bars.length - 1 ? null
      : { pct: round(pct(bars[idx].c, last.c), 2), fromDate: bars[idx].t, fromClose: bars[idx].c };
  };
  win("d1", bars.length - 2);
  win("d10", closeOnOrBefore(bars, shiftDate(last.t, 10)));
  win("d30", closeOnOrBefore(bars, shiftDate(last.t, 30)));
  win("ytd", closeOnOrBefore(bars, `${Number(last.t.slice(0, 4)) - 1}-12-31`));
  win("y1", closeOnOrBefore(bars, shiftDate(last.t, 365)));
  // 5 years: allow a few days of slack for a weekend/holiday at the start of history.
  const i5 = closeOnOrBefore(bars, shiftDate(last.t, 5 * 365 + 1));
  win("y5", i5 !== null && Date.parse(bars[i5].t) >= Date.parse(shiftDate(last.t, 5 * 365 + 10)) ? i5 : null);
  if (out.y5) out.y5.annualizedPct = round((Math.pow(1 + out.y5.pct / 100, 1 / 5) - 1) * 100, 2);
  return out;
}

// Risk and positioning stats over the last 365 calendar days.
// periodsPerYear: 252 for stocks/ETFs, 365 for crypto.
export function riskStats(bars, periodsPerYear = 252) {
  if (!bars || bars.length < 20) return null;
  const last = bars[bars.length - 1];
  const start = closeOnOrBefore(bars, shiftDate(last.t, 365)) ?? 0;
  const yr = bars.slice(start);
  const rets = [];
  for (let i = 1; i < yr.length; i++) rets.push(Math.log(yr[i].c / yr[i - 1].c));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
  let peak = -Infinity, maxDd = 0;
  for (const b of yr) { peak = Math.max(peak, b.c); maxDd = Math.min(maxDd, b.c / peak - 1); }
  const hi = Math.max(...yr.map((b) => b.c)), lo = Math.min(...yr.map((b) => b.c));
  const prior = bars.slice(Math.max(0, bars.length - 31), bars.length - 1).map((b) => b.v).filter((v) => v > 0);
  const avgVol = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
  return {
    windowStart: yr[0].t,
    volatilityPct: round(sd * Math.sqrt(periodsPerYear) * 100, 1),
    maxDrawdownPct: round(maxDd * 100, 1),
    high52: hi, low52: lo,
    fromHighPct: round(pct(hi, last.c), 1),
    fromLowPct: round(pct(lo, last.c), 1),
    volumeVsAvg: avgVol && last.v ? round(last.v / avgVol, 2) : null,
  };
}

// Difference in percentage points between two periodReturns objects.
export function relativeReturns(a, b) {
  if (!a || !b) return null;
  const out = {};
  for (const k of ["d1", "d10", "d30", "ytd", "y1", "y5"]) {
    out[k] = a[k] && b[k] ? round(a[k].pct - b[k].pct, 2) : null;
  }
  return out;
}

function round(x, d) {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  const m = 10 ** d;
  return Math.round(x * m) / m;
}

// Finnhub's industry label -> SPDR sector ETF, for a "vs its sector" line.
// Unknown industries get no sector comparison rather than a guessed one.
export const SECTOR_ETF = {
  "Technology": "XLK", "Semiconductors": "SMH", "Software": "XLK",
  "Communications": "XLC", "Media": "XLC", "Telecommunication": "XLC",
  "Banking": "XLF", "Financial Services": "XLF", "Insurance": "XLF",
  "Health Care": "XLV", "Pharmaceuticals": "XLV", "Biotechnology": "XLV", "Life Sciences Tools & Services": "XLV",
  "Energy": "XLE", "Oil & Gas": "XLE",
  "Utilities": "XLU",
  "Real Estate": "XLRE",
  "Retail": "XLY", "Automobiles": "XLY", "Hotels, Restaurants & Leisure": "XLY", "Consumer products": "XLP",
  "Beverages": "XLP", "Food Products": "XLP", "Tobacco": "XLP",
  "Aerospace & Defense": "XLI", "Machinery": "XLI", "Industrial Conglomerates": "XLI", "Airlines": "XLI",
  "Logistics & Transportation": "XLI", "Road & Rail": "XLI", "Building": "XLI", "Construction": "XLI",
  "Chemicals": "XLB", "Metals & Mining": "XLB", "Packaging": "XLB",
};

// Common names people type -> Alpaca crypto pair.
export const CRYPTO_NAMES = {
  bitcoin: "BTC", ethereum: "ETH", ether: "ETH", solana: "SOL", dogecoin: "DOGE", ripple: "XRP",
  cardano: "ADA", avalanche: "AVAX", chainlink: "LINK", litecoin: "LTC", polkadot: "DOT",
  bitcoincash: "BCH", shibainu: "SHIB", shiba: "SHIB", uniswap: "UNI", aave: "AAVE", tezos: "XTZ",
  stellar: "XLM", polygon: "POL", sushi: "SUSHI", curve: "CRV", maker: "MKR", graph: "GRT", yearn: "YFI",
  pepe: "PEPE", tether: "USDT", usdcoin: "USDC", trump: "TRUMP",
};

export function resolveCrypto(input) {
  const raw = String(input || "").trim();
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = CRYPTO_NAMES[key] || raw.toUpperCase().replace(/\/?USDT?$|\/USD$/, "").replace(/[^A-Z0-9]/g, "");
  return base ? `${base}/USD` : null;
}

// Fund families people type on the Funds tab -> their main ETFs.
export const FUND_FAMILIES = {
  vanguard: ["VOO (S&P 500)", "VTI (total US market)", "VXUS (international)", "BND (US bonds)", "VUG (growth)"],
  fidelity: ["FBND (bonds)", "FTEC (tech)", "FSKAX is a mutual fund: try ITOT or VTI for the total US market"],
  schwab: ["SCHB (total US market)", "SCHX (large caps)", "SCHD (dividends)", "SCHF (international)"],
  ishares: ["IVV (S&P 500)", "ITOT (total US market)", "IEFA (international)", "AGG (US bonds)"],
  blackrock: ["IVV (S&P 500)", "ITOT (total US market)", "IEFA (international)", "AGG (US bonds)"],
  spdr: ["SPY (S&P 500)", "DIA (Dow)", "XLK (tech)", "GLD (gold)"],
  invesco: ["QQQ (Nasdaq-100)", "RSP (equal-weight S&P 500)"],
  statestreet: ["SPY (S&P 500)", "DIA (Dow)", "GLD (gold)"],
};

// Popular mutual fund share classes -> an ETF tracking the same index.
// Alpaca has no mutual fund prices, so these are redirected, with a note.
export const MUTUAL_TO_ETF = {
  VFIAX: "VOO", VFINX: "VOO", VTSAX: "VTI", VTSMX: "VTI", VTIAX: "VXUS", VBTLX: "BND", VBMFX: "BND",
  VIGAX: "VUG", VVIAX: "VTV", VIMAX: "VO", VSMAX: "VB", VGSLX: "VNQ", VTABX: "BNDX", VWIAX: null,
  FXAIX: "IVV", FSKAX: "ITOT", FTIHX: "IXUS", FXNAX: "AGG", FZROX: "ITOT", FZILX: "IXUS",
  SWPPX: "IVV", SWTSX: "SCHB", SWISX: "SCHF", SWAGX: "SCHZ",
};

export function fundHint(input) {
  const key = String(input || "").toLowerCase().replace(/[^a-z]/g, "").replace(/(funds?|etfs?|investments?|group)$/, "");
  return FUND_FAMILIES[key] || null;
}

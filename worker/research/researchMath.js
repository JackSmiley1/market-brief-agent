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

// ---------- Accuracy check for the AI text (added 2026-10-21) ----------
// Pulls every figure out of a report's text (percentages, dollar amounts,
// percentage points, multiples) and checks each against the numbers the
// report was given: computed returns/stats/metrics, plus any number that
// appears in the news headlines and summaries it was shown. A figure that
// can't be matched is reported, not silently dropped. "Couldn't be matched"
// isn't proof of an error (the model may have done its own arithmetic),
// so the page words it that way.

const APPROX_RE = /(about|roughly|around|approximately|nearly|almost|close to|more than|over|under|less than|just under|just over|~)\s*$/i;
const FIELDS = ["headline", "today", "recentTrend", "longRun", "vsMarket", "drivers", "marketBackdrop", "risks", "watch", "bottomLine"];

function collectNumbers(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === "number" && Number.isFinite(obj)) out.push(obj);
  else if (Array.isArray(obj)) obj.forEach((x) => collectNumbers(x, out));
  else if (typeof obj === "object") Object.values(obj).forEach((x) => collectNumbers(x, out));
  return out;
}

function newsNumbers(news) {
  const text = [...(news?.company || []), ...(news?.market || [])].map((n) => `${n.headline || ""} ${n.summary || ""}`).join(" ");
  return [...text.matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
}

function extractFigures(text) {
  const out = [];
  const add = (m, value, kind) => {
    const start = Math.max(0, m.index - 70);
    const before = text.slice(start, m.index);
    const raw = m[0].trim();
    const decimals = (raw.match(/\.(\d+)/) || ["", ""])[1].length;
    out.push({ raw, value, kind, decimals, approx: APPROX_RE.test(before), context: text.slice(start, Math.min(text.length, m.index + m[0].length + 50)).replace(/\s+/g, " ").trim() });
  };
  // $3.5 trillion / $248.97 / $1.2B
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(trillion|billion|million|T\b|B\b|M\b)?/gi)) {
    const n = Number(m[1].replace(/,/g, "")), u = (m[2] || "").toLowerCase();
    add(m, n * (u.startsWith("t") ? 1e6 : u.startsWith("b") ? 1e3 : u.startsWith("m") ? 1 : 0) || n, u ? "cap" : "price");
  }
  // 12.5 percentage points / 3.1 pts / 3.1 points
  for (const m of text.matchAll(/([+-−]?\d+(?:\.\d+)?)\s*(percentage points?|pts?\b|points?\b)/gi)) add(m, Math.abs(Number(m[1].replace("−", "-"))), "pts");
  // 2.07% / 2.1 percent
  for (const m of text.matchAll(/([+-−]?\d+(?:\.\d+)?)\s*(%|percent\b)/gi)) add(m, Math.abs(Number(m[1].replace("−", "-"))), "pct");
  // 31.2x / 1.4×
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*[x×](?![a-z])/gi)) add(m, Number(m[1]), "mult");
  return out;
}

function matches(fig, candidates) {
  const v = fig.value;
  const exactTol = 0.5 * 10 ** -fig.decimals + 1e-9;
  for (const c0 of candidates) {
    const c = Math.abs(c0);
    if (Math.abs(c - v) <= exactTol) return true;
    if (fig.approx && Math.abs(c - v) <= Math.max(1, 0.06 * c)) return true;
    if (fig.kind === "cap" && c > 0 && Math.abs(c - v) / c <= 0.06) return true; // "$3.5T" for 3,497,000M
  }
  return false;
}

// quote: the /quote object the report was written from. news: {company, market}.
export function verifyReport(report, quote, news) {
  const text = FIELDS.map((k) => (Array.isArray(report?.[k]) ? report[k].join(" \n") : report?.[k] || "")).join(" \n");
  const { series, ...numbersOnly } = quote || {};
  const dataNums = collectNumbers(numbersOnly);
  const allowed = [...dataNums, ...newsNumbers(news)];
  const figures = extractFigures(text);
  // A figure counted twice by overlapping patterns ("5 pts" and "5%" can't overlap, but "$5%" could) is de-duplicated by position.
  const seen = new Set();
  const unique = figures.filter((f) => { const k = f.context + "|" + f.raw; if (seen.has(k)) return false; seen.add(k); return true; });
  const unmatched = unique.filter((f) => !matches(f, allowed)).map(({ raw, context }) => ({ figure: raw, context }));
  return {
    checked: unique.length,
    matched: unique.length - unmatched.length,
    unmatched: unmatched.slice(0, 10),
    status: unique.length === 0 ? "no-figures" : unmatched.length === 0 ? "verified" : "unmatched",
    method: "Every percentage, dollar amount, percentage-point figure and multiple in the text was compared with the computed data and the news it was given.",
  };
}

// ---------- Report sessions (added 2026-10-21) ----------
// Decides which cached report a lookup should share, so a report written
// at 10 AM isn't served as "today" at 3 PM:
//   intraday: US market open (9:30 AM to 4:20 PM ET on a weekday whose
//             session has started). One report per symbol per clock hour.
//             The 20 extra minutes cover the free feed's 15-minute delay,
//             so the closing report includes the real close.
//   closing:  market closed. One report per symbol per completed session,
//             reused until the next session opens.
//   crypto:   trades 24/7. One report per symbol per UTC hour.
function etParts(now) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

export function reportSession(type, asOf, now = new Date()) {
  if (type === "crypto") {
    const hour = now.toISOString().slice(0, 13);
    return { phase: "crypto", sessionDate: hour.slice(0, 10), bucket: `h${hour.slice(11, 13)}`, ttl: 3 * 3600,
      pricesAsOf: now.toISOString() };
  }
  const et = etParts(now);
  const weekday = !["Sat", "Sun"].includes(et.weekday);
  const open = weekday && asOf === et.date && et.minutes >= 9 * 60 + 30 && et.minutes < 16 * 60 + 20;
  if (open) {
    return { phase: "intraday", sessionDate: et.date, bucket: `i${String(Math.floor(et.minutes / 60)).padStart(2, "0")}`, ttl: 3 * 3600,
      pricesAsOf: new Date(now.getTime() - 16 * 60000).toISOString() };
  }
  return { phase: "closing", sessionDate: asOf, bucket: "close", ttl: 4 * 24 * 3600, pricesAsOf: null };
}

export function reportKey(type, symbol, session) {
  return `rep:${session.sessionDate}:${type}:${symbol}:${session.bucket}`;
}

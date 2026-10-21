// Great Lakes Investments research — Cloudflare Worker (added 2026-10-20).
//
// The research back end for the public dashboard. GitHub Pages is static and
// can't hold API keys, so this Worker holds them and answers three requests:
//
//   GET  /quote?type=stock|fund|crypto&q=AAPL   performance numbers (free: prices only)
//   POST /report  {"type":"stock","q":"AAPL"}   full AI breakdown (one Claude call)
//   GET  /recent                                 reports generated today and yesterday
//
// Every number comes from market data via researchMath.js. Claude writes the
// explanation around those numbers and is told not to introduce any of its own.
//
// Cost control (reports are the only paid part):
//   - one cached report per symbol per day: everyone after the first visitor
//     gets the cached copy free
//   - REPORTS_PER_IP_PER_DAY new reports per visitor per day
//   - REPORTS_PER_DAY new reports site-wide per day
//
// Secrets (wrangler secret put): ANTHROPIC_API_KEY, ALPACA_KEY_ID,
// ALPACA_SECRET_KEY, FINNHUB_KEY. KV namespace binding: RESEARCH.
// Nothing here can place an order: it only reads market data.

import { periodReturns, riskStats, relativeReturns, SECTOR_ETF, resolveCrypto } from "./researchMath.js";

const ALLOWED_ORIGINS = ["https://jacksmiley1.github.io", "http://localhost:8000", "http://localhost:8765"];
const MODEL = "claude-sonnet-5";
const REPORTS_PER_IP_PER_DAY = 5;
const REPORTS_PER_DAY = 60;
const QUOTE_TTL = 15 * 60;            // seconds a quote stays cached
const REPORT_TTL = 3 * 24 * 3600;     // reports are keyed by date; kept a few days for /recent
const ALPACA_DATA = "https://data.alpaca.markets";
const FINNHUB = "https://finnhub.io/api/v1";
const TYPES = new Set(["stock", "fund", "crypto"]);

// ---------- helpers ----------
function cors(req, resp) {
  const origin = req.headers.get("Origin");
  resp.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  resp.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type");
  resp.headers.set("Vary", "Origin");
  return resp;
}
const json = (req, body, status = 200) =>
  cors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function etDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}
function isoDaysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

async function getJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

// ---------- market data ----------
async function stockBars(env, symbol) {
  const headers = { "APCA-API-KEY-ID": env.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": env.ALPACA_SECRET_KEY };
  const start = isoDaysAgo(5 * 365 + 20);
  // Consolidated (SIP) data is free when it's at least 15 minutes old; fall
  // back to the IEX feed if the account isn't entitled.
  const end = new Date(Date.now() - 16 * 60000).toISOString();
  for (const feed of ["sip", "iex"]) {
    const out = [];
    let token = null;
    try {
      do {
        const u = new URL(`${ALPACA_DATA}/v2/stocks/${encodeURIComponent(symbol)}/bars`);
        u.search = new URLSearchParams({ timeframe: "1Day", start, end, adjustment: "all", feed, limit: "10000", ...(token ? { page_token: token } : {}) });
        const j = await getJson(u.toString(), { headers });
        for (const b of j.bars || []) out.push({ t: b.t.slice(0, 10), c: b.c, v: b.v });
        token = j.next_page_token;
      } while (token);
      if (out.length) return { bars: out, feed };
    } catch (e) {
      if (feed === "iex") throw e;
    }
  }
  return { bars: [], feed: "iex" };
}

async function cryptoBars(env, pair) {
  const out = [];
  let token = null;
  do {
    const u = new URL(`${ALPACA_DATA}/v1beta3/crypto/us/bars`);
    u.search = new URLSearchParams({ symbols: pair, timeframe: "1Day", start: isoDaysAgo(5 * 365 + 20), limit: "10000", ...(token ? { page_token: token } : {}) });
    const j = await getJson(u.toString(), { headers: { "APCA-API-KEY-ID": env.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": env.ALPACA_SECRET_KEY } });
    for (const b of (j.bars && j.bars[pair]) || []) out.push({ t: b.t.slice(0, 10), c: b.c, v: b.v });
    token = j.next_page_token;
  } while (token);
  // The current UTC day is still forming; keep it (it's "today so far") but
  // the page labels it as such.
  return { bars: out, feed: "alpaca-crypto" };
}

async function finnhub(env, path, params = {}) {
  const u = new URL(`${FINNHUB}${path}`);
  u.search = new URLSearchParams({ ...params, token: env.FINNHUB_KEY });
  try { return await getJson(u.toString()); } catch { return null; }
}

// What someone typed -> candidate tickers, best first. Something shaped like a
// ticker is tried as-is; a company name (or a ticker-shaped word that turns
// out to have no prices, like "apple") goes through Finnhub's US symbol search.
function tickerShaped(raw) {
  return /^[A-Za-z]{1,5}([.-][A-Za-z])?$/.test(raw) ? raw.toUpperCase().replace("-", ".") : null;
}
async function searchTicker(env, raw) {
  if (!/^[A-Za-z0-9 .&'-]{2,40}$/.test(raw)) return null;
  const s = await finnhub(env, "/search", { q: raw, exchange: "US" });
  const hit = (s?.result || []).find((r) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(r.symbol));
  return hit ? hit.symbol : null;
}

async function buildQuote(env, type, q) {
  if (type === "crypto") {
    const pair = resolveCrypto(q);
    if (!pair || !/^[A-Z0-9]{2,10}\/USD$/.test(pair)) return { error: "Unrecognized coin. Try a symbol like BTC, ETH or SOL." };
    const [{ bars }, bench] = await Promise.all([
      cryptoBars(env, pair),
      pair === "BTC/USD" ? stockBars(env, "SPY").then((r) => ({ symbol: "SPY", ...r })) : cryptoBars(env, "BTC/USD").then((r) => ({ symbol: "BTC/USD", ...r })),
    ]);
    if (bars.length < 2) return { error: `No price history for ${pair} on Alpaca. Alpaca covers about 20 major coins.` };
    const returns = periodReturns(bars);
    const benchReturns = periodReturns(bench.bars);
    return {
      type, symbol: pair, name: pair.replace("/USD", ""), feed: "alpaca-crypto", historyStart: bars[0].t,
      returns, stats: riskStats(bars, 365),
      benchmark: { symbol: bench.symbol, returns: benchReturns, diff: relativeReturns(returns, benchReturns) },
      sector: null, profile: null, metrics: null,
      series: bars.map((b) => [b.t, b.c]),
      note: "Crypto trades around the clock; the latest bar is the current UTC day so far.",
    };
  }

  const raw = String(q || "").trim();
  let symbol = tickerShaped(raw);
  let mainBars = symbol ? await stockBars(env, symbol).catch(() => ({ bars: [] })) : { bars: [] };
  if (mainBars.bars.length < 2) {
    const found = await searchTicker(env, raw);
    if (found && found !== symbol) { symbol = found; mainBars = await stockBars(env, symbol).catch(() => ({ bars: [] })); }
  }
  if (!symbol) return { error: "Couldn't find that ticker or company. Try the ticker symbol, e.g. AAPL." };
  const [main, spy, profile, metric] = await Promise.all([
    Promise.resolve(mainBars),
    stockBars(env, "SPY"),
    type === "stock" ? finnhub(env, "/stock/profile2", { symbol }) : Promise.resolve(null),
    type === "stock" ? finnhub(env, "/stock/metric", { symbol, metric: "all" }) : Promise.resolve(null),
  ]);
  if (main.bars.length < 2) return { error: `No US price history found for ${symbol}.` };
  const sectorEtf = profile?.finnhubIndustry ? SECTOR_ETF[profile.finnhubIndustry] : null;
  const sectorBars = sectorEtf && sectorEtf !== symbol ? (await stockBars(env, sectorEtf).catch(() => ({ bars: [] }))).bars : [];
  const returns = periodReturns(main.bars);
  const spyReturns = symbol === "SPY" ? null : periodReturns(spy.bars);
  const sectorReturns = sectorBars.length ? periodReturns(sectorBars) : null;
  const m = metric?.metric || {};
  return {
    type, symbol, feed: main.feed, historyStart: main.bars[0].t,
    name: profile?.name || symbol,
    returns, stats: riskStats(main.bars, 252),
    benchmark: spyReturns ? { symbol: "SPY", returns: spyReturns, diff: relativeReturns(returns, spyReturns) } : null,
    sector: sectorReturns ? { symbol: sectorEtf, industry: profile.finnhubIndustry, returns: sectorReturns, diff: relativeReturns(returns, sectorReturns) } : null,
    profile: profile && profile.name ? {
      name: profile.name, industry: profile.finnhubIndustry || null, exchange: profile.exchange || null,
      marketCapM: profile.marketCapitalization ?? null, ipo: profile.ipo || null, weburl: profile.weburl || null,
    } : null,
    metrics: type === "stock" ? {
      peTTM: m.peTTM ?? m.peBasicExclExtraTTM ?? null, beta: m.beta ?? null,
      dividendYieldPct: m.currentDividendYieldTTM ?? m.dividendYieldIndicatedAnnual ?? null,
      revenueGrowthTTMPct: m.revenueGrowthTTMYoy ?? null, netMarginTTMPct: m.netProfitMarginTTM ?? null,
    } : null,
    series: main.bars.map((b) => [b.t, b.c]),
    note: type === "fund" ? "ETF prices. Mutual fund share classes (like VFIAX) aren't covered by this data source." : null,
  };
}

async function getQuote(env, type, q) {
  const key = `q:${type}:${String(q).trim().toUpperCase()}`;
  const cached = await env.RESEARCH.get(key, "json");
  if (cached) return cached;
  const quote = await buildQuote(env, type, q);
  if (!quote.error) await env.RESEARCH.put(key, JSON.stringify(quote), { expirationTtl: QUOTE_TTL });
  return quote;
}

// ---------- the AI report ----------
async function newsFor(env, quote) {
  const to = etDate(), from = isoDaysAgo(10);
  const trim = (n) => ({ date: new Date(n.datetime * 1000).toISOString().slice(0, 10), source: n.source, headline: n.headline, summary: String(n.summary || "").slice(0, 280) });
  let company = [];
  if (quote.type !== "crypto") {
    const c = await finnhub(env, "/company-news", { symbol: quote.symbol, from, to });
    company = (c || []).sort((a, b) => b.datetime - a.datetime).slice(0, 12).map(trim);
  } else {
    const c = await finnhub(env, "/news", { category: "crypto" });
    const base = quote.symbol.replace("/USD", "").toLowerCase(), nm = (quote.name || "").toLowerCase();
    company = (c || []).filter((n) => `${n.headline} ${n.summary}`.toLowerCase().match(new RegExp(`\\b(${base}|${nm})\\b`))).slice(0, 10).map(trim);
  }
  const g = await finnhub(env, "/news", { category: "general" });
  const market = (g || []).sort((a, b) => b.datetime - a.datetime).slice(0, 10).map(trim);
  return { company, market };
}

function numbersForPrompt(q) {
  const { series, ...rest } = q; // the chart series isn't needed in the prompt
  return rest;
}

const SYSTEM = `You are the research analyst for Great Lakes Investments, a student-run AI market research project. You write a clear, honest breakdown of one security's recent and long-run performance for a general audience.

Rules:
- Use ONLY the numbers given in DATA. Never introduce a price, percentage, date or statistic that isn't in DATA. Refer to numbers the way they're given.
- Explain moves with the NEWS provided when it plausibly explains them, citing the headline's date and source. If nothing in the news explains a move, say so plainly ("no clear company-specific catalyst in the news provided"); never invent a reason.
- Separate what the data shows from interpretation. Hedge interpretations.
- No buy, sell or hold recommendation, no price targets, no personal advice.
- Plain English, short sentences. A finance professor should find it rigorous; a first-year student should find it readable.

Respond with ONLY a JSON object, no markdown fences, with exactly these keys:
{
  "headline": "one sentence: the single most important takeaway",
  "today": "2-4 sentences: what happened in the latest session and the most likely reason",
  "recentTrend": "2-4 sentences: the 10-day and 30-day picture",
  "longRun": "2-4 sentences: year-to-date, 1-year and 5-year picture, including risk (volatility, drawdown)",
  "vsMarket": "2-3 sentences: how it compares with the benchmark and sector given",
  "drivers": ["up to 5 short bullets, each a specific news item or data point that matters, with date"],
  "marketBackdrop": "2-3 sentences: what the broader market news in DATA suggests about the environment",
  "risks": ["up to 4 short bullets: risks or open questions visible in the data or news"],
  "watch": ["up to 4 short bullets: concrete things to watch next (earnings dates only if in the news)"],
  "evidence": "one of: clear catalyst | partial explanation | no clear catalyst",
  "bottomLine": "2-3 sentences summarizing, explicitly not a recommendation"
}`;

async function writeReport(env, quote) {
  const news = await newsFor(env, quote);
  const body = {
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `DATA (computed from daily prices; percentages are total returns with dividends and splits adjusted for stocks/ETFs):\n${JSON.stringify(numbersForPrompt(quote))}\n\nNEWS about this security (last 10 days, newest first):\n${JSON.stringify(news.company)}\n\nBROADER MARKET NEWS (latest):\n${JSON.stringify(news.market)}\n\nToday's date (US Eastern): ${etDate()}. Security type: ${quote.type}.`,
    }],
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = (j.content || []).map((c) => c.text || "").join("").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let report;
  try { report = JSON.parse(text); } catch { throw new Error("The analysis came back in an unexpected format. Try again."); }
  return { report, news, model: MODEL, usage: j.usage || null };
}

async function bump(env, key, ttl) {
  const n = Number((await env.RESEARCH.get(key)) || 0) + 1;
  await env.RESEARCH.put(key, String(n), { expirationTtl: ttl });
  return n;
}

async function handleReport(req, env, type, q) {
  const quote = await getQuote(env, type, q);
  if (quote.error) return json(req, { error: quote.error }, 404);
  const day = etDate();
  const key = `rep:${day}:${type}:${quote.symbol}`;
  const cached = await env.RESEARCH.get(key, "json");
  if (cached) return json(req, { ...cached, cached: true });

  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const ipKey = `rl:${day}:ip:${ip}`, allKey = `rl:${day}:all`;
  const [ipCount, allCount] = await Promise.all([env.RESEARCH.get(ipKey), env.RESEARCH.get(allKey)]);
  if (Number(ipCount || 0) >= REPORTS_PER_IP_PER_DAY) {
    return json(req, { error: `Daily limit reached (${REPORTS_PER_IP_PER_DAY} new reports per visitor). Reports already written today are still free to view.` }, 429);
  }
  if (Number(allCount || 0) >= REPORTS_PER_DAY) {
    return json(req, { error: "The site's daily report budget is used up. Reports already written today are still free to view; new ones resume tomorrow." }, 429);
  }

  const { report, news, model, usage } = await writeReport(env, quote);
  const record = {
    type, symbol: quote.symbol, name: quote.name, date: day, generatedAt: new Date().toISOString(), model,
    report, numbersAsOf: quote.returns?.asOf ?? null, newsCount: news.company.length,
    sources: news.company.map((n) => ({ date: n.date, source: n.source, headline: n.headline })),
  };
  await env.RESEARCH.put(key, JSON.stringify(record), {
    expirationTtl: REPORT_TTL,
    metadata: { type, symbol: quote.symbol, name: quote.name, headline: String(report.headline || "").slice(0, 200), generatedAt: record.generatedAt },
  });
  await Promise.all([bump(env, ipKey, 2 * 86400), bump(env, allKey, 2 * 86400)]);
  return json(req, { ...record, cached: false, usage });
}

async function handleRecent(req, env) {
  const days = [etDate(), etDate(new Date(Date.now() - 86400000))];
  const items = [];
  for (const d of days) {
    const l = await env.RESEARCH.list({ prefix: `rep:${d}:` });
    for (const k of l.keys) items.push({ date: d, ...(k.metadata || {}) });
  }
  items.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  return json(req, { items: items.slice(0, 30) });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return cors(req, new Response(null, { status: 204 }));
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && url.pathname === "/quote") {
        const type = url.searchParams.get("type"), q = url.searchParams.get("q");
        if (!TYPES.has(type) || !q || q.length > 40) return json(req, { error: "Enter a ticker, fund or coin." }, 400);
        const quote = await getQuote(env, type, q);
        if (quote.error) return json(req, quote, 404);
        const reportCached = !!(await env.RESEARCH.get(`rep:${etDate()}:${type}:${quote.symbol}`));
        return json(req, { ...quote, reportCached });
      }
      if (req.method === "POST" && url.pathname === "/report") {
        let p; try { p = await req.json(); } catch { return json(req, { error: "Invalid request." }, 400); }
        if (!TYPES.has(p?.type) || !p?.q || String(p.q).length > 40) return json(req, { error: "Enter a ticker, fund or coin." }, 400);
        return await handleReport(req, env, p.type, p.q);
      }
      if (req.method === "GET" && url.pathname === "/recent") return await handleRecent(req, env);
      return json(req, { error: "Not found" }, 404);
    } catch (err) {
      return json(req, { error: `Something went wrong fetching data (${String(err.message || err).slice(0, 160)}). Try again in a minute.` }, 502);
    }
  },
};

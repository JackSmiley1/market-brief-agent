import "dotenv/config";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db.js";
import { WATCHLIST, FINNHUB_BASE, ALPACA_DATA_BASE } from "./config.js";
import { impliedAnnualReturn, revenueNowFrom, pickTop, DEFAULTS } from "./longHorizonMath.js";

// Long-horizon track (added 2026-10-01), inspired by FutureSearch's
// "Stockfisher" S&P 500 study: an AI forecasts each company's fundamentals
// years out, and code turns those forecasts into a ranking. A SEPARATE paper
// experiment: it places no orders, has its own tables, and is never read by
// the nightly strategy. Pre-registered in roadmap.md.
//
// Modes:
//   node src/longHorizon.js forecast   quarterly: forecast every watchlist
//                                       stock, form a new top-5 period
//   node src/longHorizon.js mark       daily: fetch closes for held stocks + SPY
//
// Workflow: .github/workflows/long-horizon.yml.

const mode = process.argv[2];
const ETFS = new Set(["SPY", "QQQ", "DIA", "IWM"]);
const MODEL = "claude-sonnet-5"; // same model as the nightly brief
const TOP_N = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alpacaHeaders = { "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY };
const todayET = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

async function finnhub(path, params) {
  const res = await axios.get(`${FINNHUB_BASE}${path}`, { params: { ...params, token: process.env.FINNHUB_KEY } });
  await sleep(1100); // free tier: 60 calls/minute
  return res.data;
}

// Keep only the fundamentals that matter for a long-horizon view, so the
// prompt stays small and the model isn't distracted by trading stats.
function fundamentalsSubset(metric = {}) {
  const keep = /growth|margin|roe|roa|roi|ps|pe|pb|eps|dividend|payout|freecash|fcf|revenue|debt|current|marketcap/i;
  return Object.fromEntries(Object.entries(metric).filter(([k, v]) => keep.test(k) && typeof v === "number"));
}

const SYSTEM = `You are a careful long-horizon equity analyst. You forecast a company's BUSINESS, not its stock price.
Use base rates: most large companies grow revenue in the low-to-mid single digits over five years, unusually high growth rarely persists, and margins tend to revert toward their industry's norm.
Give calibrated ranges: your p10 and p90 should each be wrong about 10% of the time.
Reply with ONLY a JSON object, no prose before or after.`;

function userPrompt({ symbol, profile, fundamentals, headlines }) {
  return `Company: ${profile.name ?? symbol} (${symbol}), industry: ${profile.finnhubIndustry ?? "unknown"}.
Current fundamentals (Finnhub; growth and margin figures are percentages):
${JSON.stringify(fundamentals)}
Recent headlines (context only; don't overweight short-term news):
${headlines.map((h) => "- " + h).join("\n") || "- none"}

Forecast:
1. Annual revenue growth rate (CAGR, %) over the next 5 years, as p10 / p50 / p90.
2. Net profit margin (%) in year 5.
Return exactly:
{"cagr": {"p10": number, "p50": number, "p90": number}, "netMargin5y": number, "reasoning": "two or three sentences: the main drivers and the main risk"}`;
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function forecast() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const formedDate = todayET();
  const periodId = db.prepare(`INSERT INTO lh_periods (formed_at, formed_date, model, note) VALUES (?, ?, ?, ?)`)
    .run(new Date().toISOString(), formedDate, MODEL, `exit P/E ${DEFAULTS.exitPE}, ${DEFAULTS.years}-year horizon, top ${TOP_N} equal weight`).lastInsertRowid;
  const insert = db.prepare(`INSERT INTO lh_forecasts (period_id, symbol, industry, revenue_now_m, market_cap_m, cagr_p10, cagr_p50, cagr_p90, margin_2031, implied_return, reasoning, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const from = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const rows = [];
  let fieldReport = null;

  for (const symbol of WATCHLIST.filter((s) => !ETFS.has(s))) {
    try {
      const profile = await finnhub("/stock/profile2", { symbol });
      const metric = (await finnhub("/stock/metric", { symbol, metric: "all" }))?.metric ?? {};
      const news = await finnhub("/company-news", { symbol, from, to: formedDate });
      if (!fieldReport) fieldReport = Object.keys(metric).length + " metric fields, e.g. " + Object.keys(fundamentalsSubset(metric)).slice(0, 12).join(", ");
      const revenueNowM = revenueNowFrom(metric, profile);
      const marketCapM = profile.marketCapitalization ?? metric.marketCapitalization ?? null;
      if (!(revenueNowM > 0) || !(marketCapM > 0)) {
        insert.run(periodId, symbol, profile.finnhubIndustry ?? null, revenueNowM, marketCapM, null, null, null, null, null, null, "no_fundamentals");
        console.warn(`longHorizon: ${symbol} skipped, missing revenue or market cap.`);
        continue;
      }
      const headlines = (Array.isArray(news) ? news : []).slice(0, 10).map((n) => n.headline).filter(Boolean);
      const msg = await client.messages.create({
        model: MODEL, max_tokens: 600, system: SYSTEM,
        messages: [{ role: "user", content: userPrompt({ symbol, profile, fundamentals: fundamentalsSubset(metric), headlines }) }],
      });
      const out = parseJson(msg.content.map((c) => c.text ?? "").join(""));
      const p10 = Number(out?.cagr?.p10), p50 = Number(out?.cagr?.p50), p90 = Number(out?.cagr?.p90), m5 = Number(out?.netMargin5y);
      if (![p10, p50, p90, m5].every(Number.isFinite) || !(p10 <= p50 && p50 <= p90)) {
        insert.run(periodId, symbol, profile.finnhubIndustry ?? null, revenueNowM, marketCapM, null, null, null, null, null, null, "bad_forecast");
        console.warn(`longHorizon: ${symbol} forecast unusable: ${JSON.stringify(out)}`);
        continue;
      }
      const impliedReturn = impliedAnnualReturn({ revenueNowM, marketCapM, cagrPct: p50, marginPct: m5 });
      insert.run(periodId, symbol, profile.finnhubIndustry ?? null, revenueNowM, marketCapM, p10, p50, p90, m5, impliedReturn, String(out.reasoning ?? "").slice(0, 600), "ok");
      rows.push({ symbol, impliedReturn });
      console.log(`longHorizon: ${symbol} growth p50 ${p50}% (${p10}..${p90}), margin ${m5}% -> implied ${impliedReturn}%/yr`);
    } catch (err) {
      console.error(`longHorizon: ${symbol} failed:`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
      insert.run(periodId, symbol, null, null, null, null, null, null, null, null, null, "error");
    }
  }

  const ranked = [...rows].sort((a, b) => b.impliedReturn - a.impliedReturn || a.symbol.localeCompare(b.symbol));
  const setRank = db.prepare(`UPDATE lh_forecasts SET rank = ? WHERE period_id = ? AND symbol = ?`);
  ranked.forEach((r, i) => setRank.run(i + 1, periodId, r.symbol));
  const top = pickTop(rows, TOP_N);
  const setHeld = db.prepare(`UPDATE lh_forecasts SET held = 1 WHERE period_id = ? AND symbol = ?`);
  for (const t of top) setHeld.run(periodId, t.symbol);
  console.log(`longHorizon: Finnhub returned ${fieldReport}.`);
  console.log(`longHorizon: period ${periodId} formed ${formedDate}: ${rows.length} forecasts, holding ${top.map((t) => t.symbol).join(", ")}.`);
  if (rows.length < TOP_N) process.exit(1); // too few usable forecasts: fail loudly
}

// Daily: closes for every symbol ever held, plus SPY, into benchmark_bars
// (the same dividend-adjusted daily bars table the SPY benchmark uses).
async function mark() {
  const first = db.prepare(`SELECT MIN(formed_date) AS d FROM lh_periods`).get()?.d;
  if (!first) { console.log("longHorizon mark: no periods yet."); return; }
  const symbols = [...new Set(db.prepare(`SELECT DISTINCT symbol FROM lh_forecasts WHERE held = 1`).all().map((r) => r.symbol)), "SPY"];
  const upsert = db.prepare(`INSERT INTO benchmark_bars (date, symbol, open, close) VALUES (?, ?, ?, ?)
    ON CONFLICT(date, symbol) DO UPDATE SET open = excluded.open, close = excluded.close`);
  for (const symbol of symbols) {
    try {
      let pageToken, n = 0;
      do {
        const res = await axios.get(`${ALPACA_DATA_BASE}/stocks/${symbol}/bars`, {
          headers: alpacaHeaders, params: { timeframe: "1Day", start: first, adjustment: "all", feed: "iex", limit: 10000, page_token: pageToken },
        });
        for (const b of res.data.bars ?? []) { upsert.run(b.t.slice(0, 10), symbol, b.o, b.c); n++; }
        pageToken = res.data.next_page_token || undefined;
      } while (pageToken);
      console.log(`longHorizon mark: ${symbol} ${n} bars.`);
    } catch (err) {
      console.error(`longHorizon mark: ${symbol} failed:`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
    }
  }
}

if (mode === "forecast") await forecast();
else if (mode === "mark") await mark();
else { console.error("Usage: node src/longHorizon.js forecast|mark"); process.exit(1); }

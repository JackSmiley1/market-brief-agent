// Cloudflare Worker — the one piece of server-side infrastructure this
// project actually needs. GitHub Pages is static; it can't hold secrets or
// run code on a request. This Worker is a thin, deliberately dumb proxy:
// it does exactly two things and nothing else.
//
//   1. Checks the PIN the dashboard sent against a secret only this Worker
//      knows (never the browser, never the repo).
//   2. If it matches, calls GitHub's workflow_dispatch API — using a
//      GitHub token that ALSO only lives here — to kick off one of exactly
//      four pre-approved workflow files, based on which action the request
//      names (never an arbitrary workflow or ticker the caller supplies):
//      on-demand-trade.yml (stock ticker analysis, the original
//      "Invest in:" bar), invest-allocation.yml (the fixed 5-fund $300
//      buy-and-hold allocation, added 2026-09-25), crypto-invest.yml (any
//      Alpaca-supported crypto pair, Claude-analyzed, user-chosen amount —
//      added 2026-09-26, replacing the old fixed BTC/ETH allocation), or
//      fund-custom-invest.yml (any ticker, buy-and-hold, user-chosen
//      amount — added 2026-09-26 alongside crypto-invest.yml).
//
// It never touches the database, never calls Alpaca/Anthropic/Finnhub
// directly, and never executes anything itself. All of that still happens
// exactly where it already did — inside the GitHub Actions job, using code
// already tested locally. This Worker's only job is "is this a legitimate
// request, and if so, tell GitHub to run the job."
//
// Honest limitation, stated plainly rather than oversold: a 4-digit PIN is
// a UX speed bump, not real authentication — it's brute-forceable in
// under 10,000 guesses with no rate limiting added yet. That's an
// acceptable tradeoff ONLY because the worst outcome of someone guessing
// it is a wasted Claude API call and a harmless simulated paper trade —
// never real money, never real capital, by construction (this Worker has
// no path to real trading even if it wanted one). Don't reuse this pattern
// for anything with real financial stakes without adding real auth and
// rate limiting first.

const ALLOWED_ORIGIN = "https://jacksmiley1.github.io";
const REPO = "JackSmiley1/market-brief-agent";
// 1-5 comma-separated letter-only entries, up to 20 chars each — wide enough
// to accept either a real ticker (AAPL) or a common single-word company/
// index name (Apple, Nvidia), since the GitHub Actions job now resolves
// names to tickers itself (see NAME_TO_TICKER in onDemandTrade.js). Still
// rejects spaces, digits, and punctuation — this is a garbage filter before
// the request ever reaches GitHub, not the real validation (that happens
// against actual market data in the job itself).
const TICKER_RE = /^[A-Za-z]{1,20}(,[A-Za-z]{1,20}){0,4}$/;
// Only this value is ever accepted for an allocation request — never
// derived from free-form caller input, so there's no way to smuggle a
// different workflow input through this field. 'crypto' was removed
// 2026-09-26 (see crypto-invest.yml/'crypto_ondemand' below, which replaced
// the old fixed BTC/ETH allocation).
const ALLOCATION_TYPES = new Set(["fund"]);

// Single bare symbol/ticker (letters+digits only, no comma list, no slash —
// the "/USD" pairing happens server-side in the GitHub Actions job, same
// name-resolution pattern as the stock ticker path below) for the crypto
// on-demand and custom-fund flows. A garbage filter before the request ever
// reaches GitHub, not the real validation (that happens against actual
// market data in the job itself).
const SYMBOL_RE = /^[A-Za-z0-9]{1,20}$/;

function isValidAmount(amount, min, max) {
  const n = Number(amount);
  return Number.isFinite(n) && n >= min && n <= max;
}

function withCors(resp) {
  resp.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  resp.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return resp;
}

function json(body, status = 200) {
  return withCors(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { ticker, pin, action, allocationType, symbol, amount, context } = payload || {};

    if (!pin || pin !== env.PIN) {
      // Deliberately vague — don't confirm/deny which part was wrong.
      return json({ error: "Invalid PIN" }, 401);
    }

    let workflowFile, dispatchInputs, successBody;

    if (action === "invest_allocation") {
      if (!ALLOCATION_TYPES.has(allocationType)) {
        return json({ error: "Invalid allocationType — must be 'fund'" }, 400);
      }
      workflowFile = "invest-allocation.yml";
      dispatchInputs = { allocationType };
      successBody = { ok: true, allocationType };
    } else if (action === "crypto_ondemand") {
      // Keep these in sync with config.js's CRYPTO_ONDEMAND_LIMITS — this
      // Worker is a separate deploy unit and can't import that file
      // directly, so the range is duplicated here on purpose rather than
      // left unenforced server-side.
      const cleanSymbol = String(symbol || "").trim().toUpperCase();
      if (!SYMBOL_RE.test(cleanSymbol)) {
        return json({ error: "Invalid crypto symbol format — letters/digits only, e.g. BTC or SOL" }, 400);
      }
      if (!isValidAmount(amount, 25, 10000)) {
        return json({ error: "Invalid amount — must be between $25 and $10,000" }, 400);
      }
      workflowFile = "crypto-invest.yml";
      dispatchInputs = {
        symbol: cleanSymbol,
        amount: String(amount),
        context: String(context || "Submitted via dashboard Crypto Invest button").slice(0, 300),
      };
      successBody = { ok: true, symbol: cleanSymbol, amount };
    } else if (action === "fund_custom") {
      // Keep in sync with config.js's FUND_CUSTOM_LIMITS — same reasoning
      // as crypto_ondemand above.
      const cleanTicker = String(ticker || "").trim().toUpperCase();
      if (!/^[A-Za-z]{1,10}$/.test(cleanTicker)) {
        return json({ error: "Invalid ticker format — letters only, e.g. VXUS" }, 400);
      }
      if (!isValidAmount(amount, 5, 10000)) {
        return json({ error: "Invalid amount — must be between $5 and $10,000" }, 400);
      }
      workflowFile = "fund-custom-invest.yml";
      dispatchInputs = { ticker: cleanTicker, amount: String(amount) };
      successBody = { ok: true, ticker: cleanTicker, amount };
    } else {
      // Default/original path — ticker analysis via the on-demand invest bar.
      const cleanTicker = String(ticker || "").trim().toUpperCase();
      if (!TICKER_RE.test(cleanTicker)) {
        return json({ error: "Invalid ticker format — use 1-6 letter symbols, comma-separated, max 5" }, 400);
      }
      // amount is OPTIONAL here (unlike crypto_ondemand/fund_custom above) —
      // omitting it keeps the original evidence-based sizing behavior;
      // providing it overrides sizing for this request only (see
      // config.js's STOCK_ONDEMAND_LIMITS and onDemandTrade.js's --amount
      // flag). Keep the range in sync with STOCK_ONDEMAND_LIMITS.
      let amountInput = "";
      if (amount !== undefined && amount !== null && amount !== "") {
        if (!isValidAmount(amount, 25, 10000)) {
          return json({ error: "Invalid amount — must be between $25 and $10,000" }, 400);
        }
        amountInput = String(amount);
      }
      workflowFile = "on-demand-trade.yml";
      dispatchInputs = { ticker: cleanTicker, context: "Submitted via dashboard Invest bar", amount: amountInput };
      successBody = { ok: true, ticker: cleanTicker, amount: amountInput || undefined };
    }

    const dispatchRes = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "market-brief-agent-invest-worker",
        },
        body: JSON.stringify({ ref: "main", inputs: dispatchInputs }),
      }
    );

    if (dispatchRes.status === 204) {
      return json(successBody);
    }

    const errText = await dispatchRes.text().catch(() => "");
    return json({ error: `GitHub dispatch failed (${dispatchRes.status}): ${errText.slice(0, 300)}` }, 502);
  },
};

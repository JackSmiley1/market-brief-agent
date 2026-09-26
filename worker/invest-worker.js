// Cloudflare Worker — the one piece of server-side infrastructure this
// project actually needs. GitHub Pages is static; it can't hold secrets or
// run code on a request. This Worker is a thin, deliberately dumb proxy:
// it does exactly two things and nothing else.
//
//   1. Checks the PIN the dashboard sent against a secret only this Worker
//      knows (never the browser, never the repo).
//   2. If it matches, calls GitHub's workflow_dispatch API — using a
//      GitHub token that ALSO only lives here — to kick off one of exactly
//      two pre-approved workflow files, based on which action the request
//      names (never an arbitrary workflow or ticker the caller supplies):
//      on-demand-trade.yml (ticker analysis, the original "Invest in:" bar)
//      or invest-allocation.yml (the static fund/crypto buy-and-hold
//      allocations, added 2026-09-25 for the Mutual Funds/Crypto tabs'
//      Invest buttons).
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
// Only these two values are ever accepted for an allocation request — never
// derived from free-form caller input, so there's no way to smuggle a
// different workflow input through this field.
const ALLOCATION_TYPES = new Set(["fund", "crypto"]);

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

    const { ticker, pin, action, allocationType } = payload || {};

    if (!pin || pin !== env.PIN) {
      // Deliberately vague — don't confirm/deny which part was wrong.
      return json({ error: "Invalid PIN" }, 401);
    }

    let workflowFile, dispatchInputs, successBody;

    if (action === "invest_allocation") {
      if (!ALLOCATION_TYPES.has(allocationType)) {
        return json({ error: "Invalid allocationType — must be 'fund' or 'crypto'" }, 400);
      }
      workflowFile = "invest-allocation.yml";
      dispatchInputs = { allocationType };
      successBody = { ok: true, allocationType };
    } else {
      // Default/original path — ticker analysis via the on-demand invest bar.
      const cleanTicker = String(ticker || "").trim().toUpperCase();
      if (!TICKER_RE.test(cleanTicker)) {
        return json({ error: "Invalid ticker format — use 1-6 letter symbols, comma-separated, max 5" }, 400);
      }
      workflowFile = "on-demand-trade.yml";
      dispatchInputs = { ticker: cleanTicker, context: "Submitted via dashboard Invest bar" };
      successBody = { ok: true, ticker: cleanTicker };
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

# Market Brief Agent

An autonomous research pipeline that generates a nightly market brief from live data, layers evidence-based simulated trades on top of it, grades its own calls against reality, and periodically reviews its own losing trades to write down what it's learned — all running unattended, every trading night, via GitHub Actions.

**Live dashboard:** https://jacksmiley1.github.io/market-brief-agent/
**Status memo (honest, current-state writeup):** [status-memo.md](./status-memo.md)
**Long-term roadmap (future phases — personal live trading, multi-user accounts, crypto, and the legal/licensing reality of each):** [roadmap.md](./roadmap.md)

## What it actually does, end to end

1. **Nightly (weekdays, 4:30pm ET, via GitHub Actions):** pulls end-of-day price/volume data for a fixed 32-ticker watchlist from Alpaca and same-day news from Finnhub, sends it to Claude for analysis.
2. Claude produces a written brief (market overview, winners/losers with causes, notable events, a 3-5 ticker watchlist for tomorrow) and, in a structured block ahead of the prose, a directional call (long/short), a self-rated confidence level, and an event-risk flag for each watchlist ticker.
3. Those calls are layered with **simulated** trades on Alpaca's paper trading API — position size is derived from real evidence in the system's own trade history (see Sizing rules below), not fixed or guessed.
4. The next night, each prior call is graded against what actually happened, using the code-computed price change (never a number Claude self-reports).
5. Separately, a **reflection loop** periodically reviews batches of the system's own losing trades and writes a short natural-language lesson, fed into future briefs as advisory context — distinct from and in addition to the numeric sizing rules.
6. A public dashboard is regenerated from the database after every run and committed back to the repo, so what's shown publicly is never more than one trading day stale.
7. A dashboard "Invest in: ___" bar lets a visitor trigger an on-demand analysis (and, if Claude finds a real setup, a simulated trade) for any ticker or company name outside the fixed nightly watchlist, via a Cloudflare Worker that proxies to a GitHub Actions workflow — same pipeline, same paper capital, tagged separately so it never contaminates the nightly system's evidence.

## The one hard boundary

This is Phase 1 of a longer-term plan. **There is no live trading, no real capital, and no product built for other people to use.** `ALPACA_TRADING_BASE` is hardcoded to `paper-api.alpaca.markets`, and the Alpaca key in use is itself a paper-only key — both by design, not just by convention. Moving past this requires a legal/registration step that has not been started. See the status memo for the full, unvarnished current state, including what hasn't worked yet.

## Sizing rules (evidence-based, not assumed)

Position size starts at a flat base and is cut for low self-rated confidence, scheduled-event risk, and short positions — each cut was added only after real data showed that factor correlating with worse outcomes (see `src/config.js` for the exact multipliers and the reasoning comments next to each one). A fixed rule enforced in `src/checkpoint.js` requires **n ≥ 20** closed trades in a comparison before it's treated as evidence real enough to justify a sizing change — anything below that is reported as directional only, never acted on.

## Reflection loop

`src/reflect.js` reviews the system's own closed losing trades (original thesis vs. actual outcome), gated so it only runs on a new-enough batch (not single anecdotes), and asks Claude to write 2-4 short, falsifiable, cross-trade observations — or to say plainly that there's no real pattern in the batch, rather than forcing one. Lessons are stored in the `lessons` table, folded into the next night's brief as explicitly advisory context (never a hard rule), and shown publicly on the dashboard's Lessons Learned section. `src/lessons.js` (`npm run lessons -- list` / `delete <id>`) lets a bad lesson be reviewed and removed without touching the database directly.

## Stack

Node.js (`node:sqlite`, no native binary dependency — chosen after `better-sqlite3` segfaulted reproducibly on GitHub Actions' runner), Alpaca (market data + paper trading, free tier), Finnhub (news, free tier), the Anthropic API (Claude), GitHub Actions (free scheduled + on-demand automation), GitHub Pages (free static hosting for the dashboard), and a single Cloudflare Worker (free tier) as the only server-side component — a thin, deliberately dumb proxy that checks a PIN and calls GitHub's `workflow_dispatch` API, with no business logic or secrets duplicated anywhere else. Free-tools-first by design, until there's a specific reason to pay for something.

## Repo layout

```
src/
  index.js            nightly pipeline entry point
  onDemandTrade.js     on-demand (dashboard-triggered or CLI) analysis + trade
  fetchMarketData.js   Alpaca price/volume data
  fetchNews.js         Finnhub news
  buildPrompt.js        prompt construction (nightly + on-demand)
  generateBrief.js      Claude API calls, structured-block parsing
  paperTrade.js         simulated order submission, reconciliation, portfolio risk caps
  reflect.js            reflection loop (loss review -> lesson synthesis)
  lessons.js             lesson management CLI (list/delete)
  checkpoint.js          sizing-lever evidence review (n>=20 gate)
  exportSite.js          generates docs/data.json for the public dashboard
  config.js              watchlist, sizing rules, portfolio risk caps
  db.js                  SQLite schema + migrations
  saveBrief.js           writes brief markdown + logs, reads back most recent watchlist/brief date
  computeAccuracy.js     standalone directional-accuracy report (superseded day-to-day by checkpoint.js)
  computePnL.js          standalone P&L report (superseded day-to-day by checkpoint.js)
  computeConfidence.js   standalone confidence-bucket report (superseded day-to-day by checkpoint.js)
worker/                 Cloudflare Worker for the dashboard's on-demand invest bar
docs/                   the public dashboard (index.html) + generated data.json
.github/workflows/      nightly-brief.yml, on-demand-trade.yml
status-memo.md          current, honest state of the project — read this for real numbers
roadmap.md              long-term vision + what it actually takes to get there
tests/                  npm test (Node's built-in test runner) — see Tests below
```

## Tests

`tests/config.test.js` covers `computeNotional` (the position-sizing formula) end to end — base sizing, each individual cut, the cuts stacking multiplicatively, and the exact worked example from `config.js`'s own comments. Honest scope note: most of `src/` is script-style (side effects against the live database at import time), so this is deliberately the one function that's both pure and the highest-stakes to get wrong, not a claim of full coverage. Runs via `npm test` (Node's built-in test runner, no dependency added), and as a required step before every nightly and on-demand run in both GitHub Actions workflows — a broken sizing formula fails the run loudly instead of silently mis-sizing a real order.

## Running locally

Requires Node 22.5+ (for `node:sqlite`). Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY`, `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY` (paper keys only), and `FINNHUB_KEY`, then:

```
npm install
npm run brief          # run tonight's pipeline once, locally
npm run invest -- NVDA "context"   # on-demand analysis/trade for one ticker
npm run checkpoint     # review sizing-lever evidence (n>=20 gate)
npm run reflect        # run the reflection loop against current losses
npm run lessons -- list
npm run export-site    # regenerate docs/data.json from the local db
```

In production, `npm run brief`, `npm run reflect`, and `npm run export-site` run automatically every weekday evening via `.github/workflows/nightly-brief.yml`.

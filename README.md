# Great Lakes Investments

*(The repo and package are named `market-brief-agent`; "Great Lakes Investments" is the public name on the site.)*

A student-built AI market research tool. Type in a US stock, an ETF or a major cryptocurrency and it shows:

- returns over **1 day, 10 days, 30 days, year to date, 1 year and 5 years**
- those same windows for the market (SPY; Bitcoin for crypto), the gap in percentage points, and, for stocks, its sector ETF
- a price chart, volatility, max drawdown, the 52-week range and volume versus average
- for stocks: market cap, P/E, beta, dividend yield, revenue growth and net margin
- an **AI breakdown** of why it moved: the latest session, the recent trend, the long run, versus the market, news drivers with dates and sources, the market backdrop, risks and what to watch, plus an evidence label (clear catalyst, partial explanation, or no clear catalyst)

**Live site:** https://jacksmiley1.github.io/market-brief-agent/
**Status memo (dated decisions and results, including the failures):** [status-memo.md](./status-memo.md)
**Roadmap:** [roadmap.md](./roadmap.md)

Educational research only. Not investment advice.

## How a lookup works

1. **Prices.** The research Worker (`worker/research/`) pulls up to five years of daily bars from Alpaca's market data, adjusted for splits and dividends.
2. **Numbers.** Code, not AI, computes every return, comparison and risk statistic (`worker/research/researchMath.js`, unit-tested).
3. **News and company data.** Ten days of company headlines, the latest market headlines, the company profile and key metrics come from Finnhub.
4. **Breakdown.** Claude receives the computed numbers and the headlines and fills in a fixed structure through Anthropic's tool-use mode. It's instructed to use only the numbers it's given, cite the news it relies on, say plainly when nothing explains a move, and never recommend buying or selling.

## How it keeps itself honest

- **The numbers never come from the model.** The tables are computed from prices. The written analysis sits next to them and is labeled as AI-generated.
- **"No clear catalyst" is an allowed answer.** Every report carries an evidence label.
- **No recommendations, no price targets.**
- **The failed experiment stays public.** See the Track Record below.

## Track Record: what came before

From Aug 18 to Oct 20, 2026, this project was an automated paper-trading system: Claude made daily calls on a fixed watchlist, simulated trades were placed on Alpaca's paper account, and everything was graded nightly against real prices and against simply holding SPY.

- **Result:** over 168 closed stock trades it lost about $395 in simulated money, while the same dollars in SPY were roughly flat to slightly up. On the day it was stopped (159 trades), its per-trade return versus SPY was below zero with 95% confidence. A mid-test rule change (requiring a specific catalyst for short calls) didn't fix it, and the nightly crypto picks won 1 of 11.
- **A second finding:** Claude graded its own calls more generously than prices did (about 58% vs 51% price-checked), which is why this tool computes numbers in code and labels the AI text.
- The full record, unedited, is on the site's **Track Record** tab and in [status-memo.md](./status-memo.md).

A separate **Long-Horizon** experiment continues. It's based on FutureSearch's finding that long-run business forecasts may be more predictable than short-term moves. Each quarter Claude forecasts five-year revenue growth and margins for a fixed list of large companies; code ranks them by implied return, and a virtual top-five portfolio is tracked against SPY. It places no orders, and it needs a year or more of data before it means anything.

## Architecture

| Piece | What it does | Cost |
|---|---|---|
| `docs/index.html` (GitHub Pages) | The whole site: one static page | Free |
| `worker/research/` (Cloudflare Worker) | `/quote` (prices and stats), `/report` (AI breakdown), `/recent`. Holds the API keys; caches one report per symbol per day; caps new reports at 5 per visitor and 60 site-wide per day | Free tier + Claude calls |
| `src/longHorizon.js`, `src/dailyMark.js` + `.github/workflows/long-horizon.yml` | Weekday price marks (no AI); quarterly forecasts | ~30 short Claude calls per quarter |
| `src/exportSite.js` | Builds `docs/data.json` (Track Record, Long-Horizon, index closes) from the SQLite log | Free |
| `worker/invest-worker.js` | Older Worker for the paper fund-holding buttons | Free |

The daily trading code (`src/index.js`, `paperTrade.js`, `cryptoNightly.js` and others) is kept for the record but locked by `DAILY_STRATEGY_ENDED` in `src/config.js`, so it exits before any AI call or order.

## Stack

Claude (Anthropic) for analysis, Alpaca for market data, Finnhub for news and fundamentals, Cloudflare Workers + KV for lookups and caching, GitHub Actions for scheduled jobs, GitHub Pages for the site, SQLite (`node:sqlite`) for the historical log. Node 22.

## Tests

```
npm install
npm test
```

These cover the research math (returns windows, risk stats, crypto and fund-name handling), order construction, benchmark math, long-horizon math and config safety.

## Deploying the research Worker

See [worker/research/README.md](./worker/research/README.md). In short: create the KV namespace, set four secrets with `wrangler secret put`, then `wrangler deploy`. Pushing to GitHub doesn't redeploy the Worker.

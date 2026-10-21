# Research Worker (Cloudflare)

The back end for the dashboard's research panels (Stocks, Funds, Crypto). It is a **separate Worker** from `worker/invest-worker.js`, which still handles fund buys and sells. It only reads market data and can't place orders.

| Request | What it does | Cost |
|---|---|---|
| `GET /quote?type=stock\|fund\|crypto&q=...` | 5 years of daily prices; 1d/10d/30d/YTD/1y/5y returns vs SPY (BTC for crypto) and the stock's sector ETF; volatility, drawdown, 52-week range; company stats | Free (Alpaca + Finnhub) |
| `POST /report` `{"type","q"}` | Full AI breakdown from Claude, using the numbers above plus 10 days of news | One Claude call per new report |
| `GET /recent` | Reports written today and yesterday | Free |

All math is in `researchMath.js` (unit-tested in `tests/research.test.js`). Claude only writes the explanation and is told to use only the numbers it's given.

## Cost controls (in `research-worker.js`)

- One report per symbol per day. Everyone after the first visitor gets the cached copy.
- `REPORTS_PER_IP_PER_DAY = 5` new reports per visitor per day.
- `REPORTS_PER_DAY = 60` new reports site-wide per day. That's the hard ceiling on daily Claude spend.

Change those numbers and redeploy to adjust.

## Deploy (one time, about 10 minutes)

From this folder (`worker/research`), in Terminal:

```
cd ~/Projects/"Finance Agent"/worker/research
wrangler kv namespace create RESEARCH
```

That prints an `id = "..."`. Open `wrangler.toml` here and replace `PASTE_KV_ID_HERE` with it. Then set the four secrets. Each command asks you to paste the value; it never goes in a file or in chat:

```
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put ALPACA_KEY_ID
wrangler secret put ALPACA_SECRET_KEY
wrangler secret put FINNHUB_KEY
wrangler deploy
```

These are the same keys the GitHub Actions use (GitHub doesn't let you read secrets back, so copy them from where you keep them: the Anthropic console, Alpaca's paper dashboard, Finnhub's dashboard).

`wrangler deploy` prints the URL. It should be `https://market-brief-research.market-brief-smiley-corp.workers.dev`. If it's different, update `RESEARCH_URL` in `docs/index.html`.

**Pushing to GitHub doesn't redeploy the Worker.** After changing anything in this folder, run `wrangler deploy` again.

## Quick check after deploying

```
curl "https://market-brief-research.market-brief-smiley-corp.workers.dev/quote?type=stock&q=AAPL" | head -c 400
```

You should see JSON starting with `{"type":"stock","symbol":"AAPL"`.

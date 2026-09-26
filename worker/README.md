# Invest Bar Backend (Cloudflare Worker)

Connects the dashboard's "Invest in:" bar (and, since 2026-09-25, the Mutual Funds/Crypto tabs' Invest buttons) to a real (simulated) trade. GitHub Pages is static and can't hold secrets or run code, so this small Worker is the only server-side piece in the whole project — it does nothing but check the PIN and tell GitHub Actions to run one of exactly two pre-approved workflow files: `on-demand-trade.yml` for ticker analysis, or `invest-allocation.yml` for the static fund/crypto buy-and-hold allocations. Either way, the actual work happens in code already tested locally (`onDemandTrade.js` / `investAllocation.js`).

**Whenever `invest-worker.js` changes** (like this update did), you need to run `wrangler deploy` again from this folder — pushing to GitHub only updates the source file in the repo, it does NOT redeploy the live Worker. See "Deploy steps" below; `wrangler login` should already be authorized from the first deploy, so this is just `wrangler deploy` again.

## What you need first

- A free Cloudflare account: https://dash.cloudflare.com/sign-up
- A GitHub fine-grained personal access token, scoped to **only** this repo (`JackSmiley1/market-brief-agent`), with **Actions: Read and write** permission and nothing else. Create one at https://github.com/settings/personal-access-tokens/new — set repository access to "Only select repositories" → this repo, and under Repository permissions, set Actions to Read and write.

## Deploy steps

```
cd worker
npm install -g wrangler          # Cloudflare's CLI, one-time
wrangler login                   # opens a browser to authorize your Cloudflare account
wrangler secret put PIN          # paste your PIN when prompted (start with 1234, change it any time)
wrangler secret put GITHUB_TOKEN # paste the fine-grained PAT from above
wrangler deploy
```

`wrangler deploy` prints your live Worker URL, something like:

```
https://market-brief-invest.<your-subdomain>.workers.dev
```

## Last step: connect the dashboard

Open `docs/index.html`, find this line near the top of the `<script>` block:

```js
const WORKER_URL = ""; // e.g. "https://market-brief-invest.<your-subdomain>.workers.dev"
```

Paste your Worker URL in between the quotes, then commit and push. The dashboard will show a clear "not connected yet" message until this step is done — it never silently pretends a trade was submitted.

## Changing the PIN later

```
cd worker
wrangler secret put PIN
```

Enter the new value when prompted — no redeploy needed, it takes effect on the next request.

## What this does NOT do

It never touches real money — there is no code path here or in `on-demand-trade.yml` that can reach a live trading endpoint (`ALPACA_TRADING_BASE` is hardcoded to `paper-api.alpaca.markets` in `src/config.js`, on purpose, as the primary safeguard). The PIN is a UX speed bump, not real authentication — see the comment at the top of `invest-worker.js` for the honest limitation and why it's an acceptable tradeoff only because nothing real is ever at stake.

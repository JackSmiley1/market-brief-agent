# Market Brief Agent — Status Memo
**September 24, 2026**

## What this is

An automated pipeline that generates a nightly market brief using live market data (Alpaca) and news (Finnhub), fed to Claude for analysis. Each brief includes a small watchlist of tickers with a directional call, a self-rated confidence level, and an event-risk flag. Those calls are layered with simulated trades on Alpaca's paper trading API — zero real capital, no live orders, no real users. The system grades its own prior calls each night against what actually happened, a checkpoint process reviews the resulting trade data on a fixed schedule, and a separate reflection process periodically synthesizes natural-language lessons from batches of its own losing trades and feeds them back into future briefs as advisory context.

Since the last version of this memo (September 13), the project gained a public-facing layer: a live dashboard (GitHub Pages) showing real pipeline output, an on-demand mode that lets a user prompt the system to analyze and simulate-trade a specific ticker or index outside the fixed nightly watchlist, and a Reflexion-style self-reflection loop. All of that sits on top of the same paper-trading pipeline — none of it changes the core constraint below.

This is Phase 1 of a longer-term plan. There is no live trading, no investor capital, and no product built for other people to use. That is a deliberate boundary, not a temporary limitation — moving past it requires a legal/registration step that has not been started.

## Current results (as of the September 25 nightly run, matching the live dashboard)

- 97 closed simulated trades
- Average return per trade: **-0.49%**
- Total realized P&L: **-$344.87** on $84,250 notional deployed (-0.41% blended)
- Win/loss split: 46 wins / 51 losses (47.4% win rate)
- Directional accuracy (does the call's thesis play out, independent of position sizing/P&L): **66.9%** across 133 graded calls
- Max drawdown: **-$348.63**
- Current streak: **1 loss**. The 8-loss streak reported at the previous checkpoint (93 trades) has since been broken; it's kept in this memo's history because the reflection-loop lesson below was generated against it.
- Best single trade: ORCL, +6.02% (Sept 2). Worst: CRM, -15.59% (Aug 25, a short into earnings — the trade that originally motivated the event-risk sizing cut).

The same gap flagged last time is still there: directional accuracy (67%) is meaningfully better than a coin flip, but blended P&L is still negative. That combination — often right about direction, still losing money — continues to point at sizing/risk-management as the live problem, not obviously signal quality.

## What's now statistically real, and what isn't yet

The project's own bar (n ≥ 20 per comparison before treating a pattern as real, not noise) now separates cleanly into two groups:

**Clears the bar:**
- Direction: longs average -0.11% (n=45), shorts average -0.83% (n=48). Both sides now have enough trades to trust this. Shorts are a real, sample-size-legitimate net loser — and this is *after* the September 10 sizing change that already cuts short positions to half size. That change reduced the dollar damage but has not fixed the underlying issue: shorts still lose more per dollar risked than longs. That's the single most concrete, evidence-backed finding in the project right now.
- Confidence: medium-confidence calls (n=43) average -0.04% — close to breakeven, the best-performing bucket that has enough data to trust.

**Still below the bar:**
- Confidence: low (n=19, one short of the threshold) and high (n=3) are too small to draw conclusions from yet, though low-confidence trades are currently averaging a concerning -1.64% — worth watching, not yet worth acting on.
- Event-risk: still effectively no usable data broken out by this flag. It exists and feeds into sizing, but there isn't yet a clean enough sample to say whether the discount is calibrated correctly.
- Per-ticker: largest sample is 14 tickers with n≥3 each — informative for spotting outliers, not yet a basis for per-ticker rules.

## Decision: short-side sizing stays as-is for now

September 25: explicitly considered and declined to change `SIZING_ADJUSTMENTS.shortDirection` (currently 0.5) in direct response to the short-side finding above. Two real alternatives were on the table (cut short sizing further, or pause opening new shorts entirely) and both were rejected in favor of leaving it unchanged while the peer/sector-catalyst hypothesis (below) accumulates real data. Reasoning: acting on the same 48-trade short-side evidence twice, once to write it down and again to change a number, within days of each other, is close to the overfitting-on-noise pattern this project's own n≥20 rule exists to prevent. This is a deliberate wait, not an oversight — revisit once peer-catalyst shorts have enough closed trades on both sides to actually test the hypothesis rather than guess at a fix.

## New: peer/sector-catalyst tracking on shorts

A September 25 research pass (reviewing this system's own past short setups' text, cross-checked against real 2026 short-selling outcomes reported in the market) found that shorts built on a named, specific peer or sector-wide catalyst averaged +0.64% (n=12, 75% win rate) against -1.53% for everything else, while shorts positioned ahead of an unknown earnings result or justified mainly by thin volume performed worst of all. That sample is well below the n≥20 bar used everywhere else in this project, so it is not yet a sizing rule — a new `peer_catalyst` field is now being rated on every nightly pick (shorts and longs, though the evidence so far is shorts-only) and tracked in `checkpoint.js` and the dashboard, the same way `event_risk` was tracked before it ever became a sizing cut. Nothing is enforced yet; this is deliberately just visibility until there's enough data to decide honestly.

## New: the reflection loop

As of tonight's run, a Reflexion-style mechanism (distinct from the numeric sizing rules above) reviewed the 48 losing trades that had accumulated since this feature was built and synthesized its first natural-language lesson — folded into future nightly briefs as advisory context, not a hard rule. The first lesson flagged three things worth watching: momentum-continuation theses failing regardless of direction across several names, low-volume "likely to fade" calls not holding up, and pre-earnings positioning producing outsized losses (already partially addressed by the existing event-risk sizing cut). It explicitly found no pattern tied to the confidence field. This is a qualitative complement to the quantitative sizing rules above, not a replacement for them, and it's gated the same way — it only fires on a large-enough new batch of losses rather than drawing conclusions from single trades.

## What hasn't happened at all

- No real market stress test: all data so far comes from a comparatively calm stretch. Performance under real volatility is unknown.
- No registration, compliance review, or attorney consultation regarding any future multi-user product. That conversation has not started.
- No fix yet for the short-side underperformance identified above — it's now clearly documented, not yet acted on beyond the existing 0.5x size cut.

## New: buy-and-hold fund/crypto allocations (September 26)

The dashboard's Mutual Funds and Crypto tabs each gained an "Invest" button that opens a real (simulated, paper-account) long position — a static, equal-weight, buy-and-hold basket, not analyzed or sized by Claude and not sized by the evidence-based `SIZING_ADJUSTMENTS` (that gate was derived from stock nightly-watchlist history and doesn't apply here). Funds: SPY, VOO, VTI, QQQ, DIA at $300 each (IWM excluded as the most volatile of the six tracked ETF proxies). Crypto: BTC/USD and ETH/USD at $300 each, via Alpaca's paper crypto trading (same account, same keys, no new service). Both are idempotent, buy-once allocations — tagged `fund_hold`/`crypto_hold` and excluded from the nightly evidence analysis, the same separation already used for `on_demand` trades. Unlike every other position type in this system, these are held indefinitely rather than closed after one session — a real architectural carve-out in `paperTrade.js`, not a UI-only addition. Full Claude-driven crypto analysis (the same treatment stocks get) remains a planned future phase, not yet built.

## Flexible crypto/fund invest + optional stock override (September 26)

The old fixed "Invest in BTC & ETH" allocation was replaced with a flexible flow (`src/onDemandCrypto.js`): type any Alpaca-supported crypto pair and a dollar amount ($25-$10,000), and Claude runs a real analysis to decide whether to open a long position at that amount — never a short, since Alpaca's crypto product is spot-only (confirmed directly against Alpaca's docs: "Cryptocurrencies can not be sold short"). Unlike the old allocation, these positions close after one session, same as stock on-demand trades, rather than being held indefinitely. The Mutual Funds tab kept its fixed $300×5 button as-is and gained a second one for any other ticker/amount ($5-$10,000), same buy-and-hold logic, no Claude analysis.

Separately, and worth being direct about: the stock on-demand invest bar (`src/onDemandTrade.js`) now accepts an *optional* dollar amount that, when set, overrides this project's own evidence-based sizing formula for that one request. This is a real, explicit departure from the project's stated pitch — position size derived from real evidence, not fixed or guessed — and it was a deliberate tradeoff, not an oversight: the amount is optional (omit it and sizing works exactly as before), and it is scoped only to on-demand trades a person deliberately triggers by hand. The nightly automated pipeline (`index.js`) never passes an amount and always sizes every pick from `computeNotional` — no exceptions, no code path to override it. So the headline claim ("sizing derived from real evidence") stays true for the system that actually generates this project's tracked results; it just no longer describes every trade a person can manually cause the system to place.

## New: nightly automated crypto trading (September 26)

`src/cryptoNightly.js` now runs every night, same cadence and same workflow file as the stock brief (a new step in `nightly-brief.yml`, not a separate cron — avoids any race on the shared committed db) — but it is its own, fully separate track record, not a crypto version of the stock pipeline's numbers. It scans a fixed 10-coin watchlist (BTC, ETH, SOL, XRP, ADA, DOGE, AVAX, LINK, LTC, DOT), grades yesterday's picks against real outcomes, and flags 0-4 coins a night worth a long entry — always long, since Alpaca's crypto product doesn't support shorting. Every pick sizes at a flat $500 (`CRYPTO_PAPER_TRADE_BASE_NOTIONAL`), explicitly not run through the stock-derived `SIZING_ADJUSTMENTS` — there is zero real evidence yet that any of those cuts (confidence, event risk) behave the same way in crypto as they do in equities, so flat sizing is the honest starting point, same as how stock sizing itself started before the September checkpoint existed. Tagged `source='nightly_crypto'`, its own bucket in `checkpoint.js`/`exportSite.js`'s evidence gates — never blended with the stock `'nightly'` numbers, and distinct from the button-triggered `'crypto_ondemand'` flow too, so all three can eventually be judged on their own separate merits.

One schema note worth being explicit about: this reuses the same `watchlist_followups` table the stock pipeline already writes to, rather than a new table — safe because Alpaca crypto symbols always contain a "/" (e.g. `BTC/USD`) and real stock tickers never do, so `saveBrief.js`'s crypto-specific read/write functions filter on that shape and can never delete or read the other pipeline's rows for the same calendar date, even though both now write to the same table on the same nights.

The dashboard's Crypto tab now shows this track record directly (closed trades, avg return, win rate, total P&L — same honest "not enough data yet" framing below n=20 that the stock Overview uses) plus a combined "Recent Crypto Trades" list covering both the automated nightly picks and anything triggered from the Invest form, each row tagged so it's clear which is which.

## New: crypto equity curve + fund holdings value-over-time charts (September 26)

Fixed a real gap: after the crypto and fund invest buttons went live, the dashboard had no chart for either — the Crypto tab's stat cards and the Mutual Funds tab's holdings list existed, but nothing visualized performance over time the way the stock Dashboard tab's equity curve already did.

Crypto got the easier version, since crypto trades close after one session just like stock on-demand trades: `exportSite.js` now builds `cryptoEquityCurve` from every closed trade across both crypto sources (`crypto_ondemand` button trades and `nightly_crypto` automated picks) combined into one cumulative-P&L series, tagged per-point so the chart's tooltip can flag which points were automated. Rendered on the Crypto tab as "Simulated Equity Curve," same interaction pattern as the stock chart.

Funds needed new infrastructure, since `fund_hold` positions are buy-and-hold and never close — there's no per-trade P&L to chart the way stocks/crypto have. A new table, `fund_holding_value_snapshots`, is now written nightly (in `index.js`, same resilience pattern as the fund-price-snapshot block next to it: wrapped so a hiccup here can never block a brief that already saved) by querying every open `fund_hold` position, fetching that night's close, and computing real `market_value`/`unrealized_pnl` in code — not anything Claude reports. `exportSite.js` aggregates this across every held ticker into one per-date series (`fundValueHistory`), and the Mutual Funds tab now shows "Fund Holdings Value Over Time": total market value vs. cost basis, two lines, so the gap between them visually is the unrealized P&L.

Both charts will read empty ("no data yet") until at least one more nightly run has happened since a real invest went through — this only backfills going forward, it doesn't retroactively reconstruct history for positions that were already open before tonight.


**Invest-button findings (September 26, verified against the repo and GitHub's public Actions pages):**
- The one crypto invest that ran (SOL, $25, run #36268745267) completed cleanly but changed nothing in the database: `onDemandCrypto.js` took its "no position opened" branch. That branch only prints Claude's reasoning to the Actions log and persists nothing, so a pass looks identical to "nothing happened" from the dashboard. This is a real UX gap, not a trading bug. The Saturday nightly crypto run also passed honestly (XRP down on thin volume, bearish news, long-only → sit out).
- Fund invest ("Invest in Top 5 Funds" and "Invest in Another Fund") has still never produced a single workflow run. The dashboard payloads, the Worker's routing, and both workflows' `inputs:` blocks all match, and the same Worker/token successfully dispatches crypto, so a code mismatch is ruled out. Still unconfirmed: what the dashboard shows after Confirm on a fund invest.


## New: every invest request is now visible, including passes (September 26)

Fixes the gap found above. A new `invest_requests` table logs every dashboard/CLI invest request with its outcome: order placed, Claude passed, no parseable decision (kept separate from a pass so a parse bug can't hide as one), skipped by the portfolio cap, already held, failed, or symbol not found. Claude's reasoning is stored with it. Each tab now has a "Your Invest Requests" list under its form, with a "Why" toggle for the reasoning. `openNewPositions` now returns a per-item result so skips and failures are logged accurately; the nightly caller ignores the return value, so nightly behavior is unchanged. Display/audit only, and never read by sizing, checkpoint, or grading. Requests made before this change (SOL $25, VXUS $100) aren't backfilled. VXUS still appears in Current Fund Holdings as a queued order.


## New: "Sell" on held fund positions + realized gains (September 26)

Each held position on the Mutual Funds tab now has a Sell button (shown on every held position, not only profitable ones, so losers can be cut too). It sells the whole position in the paper account at market through the same PIN-gated Worker (new `sell_position` action → `sell-position.yml` → `src/sellPosition.js`). The realized gain or loss is booked from the actual sell fill by the existing `reconcileExits()`. The tab now also shows each holding's latest value and unrealized P&L, a Sold Positions list, and a running "Realized gains (simulated)" total. This is simulated only: proceeds stay in the paper account. A real "withdraw earnings" would mean real capital and is out of scope by the project's hard boundary.

Two design choices worth knowing:
- **Exact-quantity sell, not a whole-symbol close.** The existing `closePosition()` uses `DELETE /positions/{symbol}`, which liquidates every share of that symbol in the account. The sell submits an order for the position's own filled qty, so a fund sale can't touch a nightly position in the same ticker.
- **Sold rows are re-keyed** off the shared `allocation` date sentinel at sell time, and the buy-once check now ignores closed rows. That lets a ticker be bought again after selling without overwriting the sold row's realized P&L.

Verified with a stubbed-Alpaca dry run on a throwaway copy of the db: sell → exit_pending → fill → closed with correct P&L; sell again → not_held; rebuy allowed with history intact; export and rendering correct. Not yet exercised against the live paper account.

**Fixed the same day (see below):** the nightly close used to close by whole symbol, which could have sold the fund allocation's shares in a shared ticker.

## Order-safety fixes before closing out Phase 1 (September 26)

- **Quantity-based closes everywhere.** `closeMaturePositions()` now closes each position by its own filled quantity (sell for a long, buy-to-cover for a short) via `src/orders.js`, instead of `DELETE /positions/{symbol}`. A nightly SPY close can no longer sell the Top 5 Funds allocation's SPY shares. Crypto keeps the whole-symbol close (Alpaca takes crypto fees in the asset received, so the held qty is slightly below the filled qty, and crypto has no fund overlap). A stock row with no recorded qty in a fund-held ticker is marked exit_failed for review rather than risking a whole-symbol close.
- **No netting conflicts.** A short on a ticker the fund allocation holds is skipped (Alpaca would sell the held shares instead of opening a short), and a fund buy is blocked while a live short in that ticker is open (it would cover the short instead of opening a holding). Both show up in the request log.
- **Crypto closes would have failed, now fixed.** The whole-symbol close sent `/positions/BTC/USD`; Alpaca keys crypto positions as `BTCUSD`, and the slashed path returns 404 (the same bug is documented in alpaca-py issue #537). No crypto position had closed yet, so this never fired, but it would have on the first one.
- **Nightly schedule is now DST-proof.** The cron moved from 20:30 to 21:30 UTC: after the close year-round (5:30pm ET summer, 4:30pm ET winter). The old time would have run at 3:30pm ET, before the close, from Nov 1.
- `tests/orders.test.js` adds 6 tests (14 total), and all conflict paths were exercised in a stubbed-Alpaca dry run against a throwaway db copy.


## Bottom line

This is a working, automated, self-grading, self-reflecting research pipeline with a public dashboard on top of it. Directional analysis continues to show real skill (67% hit rate), and for the first time one of the project's own risk-management hypotheses — that shorts underperform — has cleared the statistical bar it set for itself rather than remaining a hunch. It is not yet net profitable (-0.41% blended across 97 trades), has not been tested in a real down market, and remains entirely simulated. The honest next milestone is the same as last time: more volume, plus now an actual decision on what to do about the short-side result now that it's real rather than suspected.

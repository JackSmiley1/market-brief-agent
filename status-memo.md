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
- Direction right, price-checked: **52.7%** of 93 calls (95% range 42.5%–62.8%). Claude's own grade of its calls says 66.9% (n=133); see the September 27 note below.
- Max drawdown: **-$348.63**
- Current streak: **1 loss**. The 8-loss streak reported at the previous checkpoint (93 trades) has since been broken; it's kept in this memo's history because the reflection-loop lesson below was generated against it.
- Best single trade: ORCL, +6.02% (Sept 2). Worst: CRM, -15.59% (Aug 25, a short into earnings — the trade that originally motivated the event-risk sizing cut).

Correction (September 27): earlier versions of this memo read a 67% "directional accuracy" as meaningfully better than a coin flip and concluded the problem was sizing, not signal. That 67% was Claude's own verdict on its calls. Price-checked, it's 52.7%, statistically indistinguishable from 50%. So neither the signal nor the sizing is shown to work yet, and the shorts are the one clearly negative result.

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



## New: SPY benchmark + a draft Phase 2 bar (September 27)

- **SPY benchmark.** Every closed nightly trade is now compared with SPY over its exact window (both fills happen at the 9:30 ET open, so that's SPY's open-to-open move). The dashboard shows the same dollars held in SPY as a dashed line on the equity curve, plus a "Versus Just Holding SPY" section: strategy P&L vs. SPY, **market-adjusted** return per trade (the trade minus SPY, signed by direction) with its 95% range, split by long and short, and SPY buy-and-hold since the first trade. Prices come from `src/fetchBenchmark.js` (Alpaca IEX daily bars, dividend-adjusted), which runs nightly and via the manual "Refresh Benchmark" workflow. The math lives in `src/benchmarkMath.js` with 5 tests (19 total).
- **Draft Phase 2 pass/fail bar** is in `roadmap.md`, marked as not yet adopted. Gate A covers a $30 long-only live mechanics test (safety and separation, not evidence). Gate B covers going beyond $30: 150+ closed nightly long trades, market-adjusted return above zero with the 95% range's lower end above zero, positive after costs, and live results tracking paper. At the current pace, the earliest Gate B could be met is around the end of December 2026.

## Finding: Claude grades itself too generously (September 27)

The headline "directional hit rate" was Claude's own verdict word (played_out / partial / missed) on its prior calls. The verdicts were given the code-computed move, but the verdict itself was Claude's. Checked against the sign of that move: Claude said "played out" on 68% of matched calls where the price actually moved the called way 54% of the time, and 23 "played out" verdicts were on moves in the wrong direction. The dashboard now leads with the price-checked figure (52.7%, n=93) and shows Claude's self-grade beside it, labeled, so the gap stays visible. Sizing, the checkpoint, and the n≥20 rules never used the self-grade (they run on realized P&L), so no trading decision was affected. The grading window (close to close) also differs from the trade window (open to open), which is part of why a correct call can still lose money.


## Decision: no more forced shorts (September 29)

Shorts stay allowed, and their sizing is unchanged. But the nightly prompt no longer forces them. Before, it required 3-5 picks every night and told Claude "a wrong-but-decisive call is more useful than a hedge," which turned weak, two-sided setups into shorts with no real reason behind them. Now a short needs a stated, specific catalyst (named negative news, a guidance cut, a substantive downgrade, a regulatory or legal setback, or a named peer/sector read-through). A price drop, fading momentum, overextension, or thin volume doesn't qualify on its own. A setup that only leans short is dropped rather than forced or flipped to long, and the list may be shorter than 3 on some nights. Long-side instructions are unchanged. Reason: shorts are the one clearly losing side (market-adjusted 95% range −1.56% to −0.03% per trade, n=51). Jack chose this over pausing shorts outright.

Why the old shorts lost, per a September 29 review of our own trades plus published research: nearly every short was "watch whether yesterday's drop continues," which bets against the well-documented short-term reversal effect (recent losers tend to bounce, most strongly when the drop wasn't driven by fundamental news). Shorts justified by volume did worst (−1.72% average, n=22). The catalyst requirement lines up with evidence that short sellers' edge is concentrated around negative news, but this system enters a day late, and the 15 past shorts that cited a catalyst still averaged −1.10% (too few to conclude). Next ideas, deliberately not stacked on today's change: hedging shorts against SPY, and a separate long-only paper test of buying no-news losers (the reversal trade itself). Professional approaches reviewed (quant factor long/short, activist short research, short-interest signals, earnings drift) were either impractical at this scale or depend on multi-week holds.

Effect on the draft pass/fail bar: this is a prompt change, so short trades before and after September 29 shouldn't be pooled. The long-side count for Gate B is arguably unaffected, since long instructions didn't change, but the list-length change could shift which longs get picked. Treat that as an open question for the Drover conversation rather than settled.


## New: AI honesty tracking, launch readiness, kill switch, About tab (September 30)

- **"Is Claude Honest About Its Own Calls?"** (Dashboard): Claude's self-grade vs. the price-checked hit rate per week, verdict asymmetry, and whether its confidence ratings mean anything. First read: the self-grading gap is widening, not shrinking (the weeks of Sep 14 and Sep 21 graded themselves around 70-75% while prices said about 40%). Claude says "played out" on calls where the price went the wrong way far more often than it says "missed" on calls that went right. "Low" confidence calls do worst on return, but "high" has too few calls to judge. Display only, no effect on trading.
- **"Road to a $30 Live Test"** (Dashboard): Gate A as a live checklist, with a clean-run counter fed by a new `pipeline_runs` log (`src/logRun.js`, recorded from GitHub's own step outcomes, including steps allowed to fail). The nightly workflow's log, export, and commit steps now run even when an earlier step fails, so a broken night is recorded and published instead of silently skipped.
- **Kill switch:** a `TRADING_HALTED` repository variable (GitHub → Settings → Secrets and variables → Actions → Variables). When set to `true`, no workflow places any new order; reconciliation of existing orders continues. It's passed into every trading step and tested in `tests/orders.test.js`.
- **Inert live workflow** (`live-mirror.yml` → `src/liveMirror.js`): after each nightly run, it records what a $30 long-only account would buy (the budget split evenly across that night's longs, shorts skipped, $1 minimum). It is a dry run. There is no live endpoint or live key anywhere in the repo, and the Worker cannot trigger it. Going live would take a deliberate code change plus a logged decision.
- **About tab:** a plain-language explanation of the project, with no personal details.

## Schedule review (September 30): keep after-close, for now

GitHub's scheduler has been firing the nightly run 2.5 to 3.7 hours late (for example, 9:11 PM ET on Sep 28), consistent with other users' reports since late August. After-close analysis with next-open entry is the only timing that tolerates that, since anything finishing before 9:30 AM still works. A pre-market run would be fresher, since it would see overnight news, but on this scheduler it would sometimes miss the open. It would also need a more punctual trigger (for example, a Cloudflare Worker cron dispatching the workflow) and would restart the evidence count. The bigger open question is the one-day hold, not the clock time: research on short-term reversal and overnight returns suggests one-day, open-to-open trades mostly capture noise. That's worth testing as a separate paper experiment, not as a change to the main strategy.


## Gate A research: small-account rules at Alpaca (September 30)

From Alpaca's own documentation:
- **Under $2,000 equity:** a "limited margin" account at 1x buying power, meaning cash only, with no shorting and no leverage. This confirms the $30 test is long-only.
- **Settlement:** US stocks settle T+1. Alpaca covers the settlement float, so proceeds from a sale can buy the next position immediately; unsettled funds just can't be withdrawn. Daily turnover in a small account shouldn't hit settlement problems.
- **Fractional shares:** each symbol must be flagged `fractionable` by Alpaca. Fractional orders are day orders, and fractional sells are long-only. Our code already uses `time_in_force: "day"` for stocks. Per-symbol support for the watchlist is now checked directly against Alpaca's asset records by `src/checkAssets.js`, which runs in the manual Refresh Benchmark workflow, and the dashboard checklist reports the result.
- **Pattern day trader rule:** doesn't apply either way, since positions are held overnight. FINRA has also adopted new intraday margin standards that replace the PDT designation and its $25,000 minimum, with the effective date set by a later FINRA notice.


## October 1: honest context, a change log, and a long-horizon track

- **The loss, in context, not hidden.** The dashboard's headline P&L now also shows it as a share of all dollars traded (−0.45% of $90,500 as of today) and what the same dollars did in SPY. A new "What Changed, and When" section dates every strategy and measurement change, so results can be read against them.
- **Where the −$406 comes from:** shorts −$296 (56 trades) and low-confidence calls −$264 (23 trades), largely overlapping. Medium-confidence longs made +$37 (22 trades).
- **Candidate change, logged, not made: stop trading low-confidence calls** (keep grading them). Low-confidence calls averaged −1.43% per trade vs. −0.24% for medium. They clear the n≥20 minimum, but the difference isn't statistically significant yet (t ≈ −1.3), and Jack chose not to change the strategy while the September 29 short rule is being tested. Revisit with more data, or with Dr. Drover.
- **Long-horizon track:** a separate, FutureSearch-inspired experiment (see roadmap.md for design and success bar). Its own workflow (`long-horizon.yml`): quarterly forecasts, plus daily price marks after each nightly run. It has its own Long-Horizon tab, places no orders, and doesn't touch the nightly strategy or the clean-run count.


## Fix: nightly crypto only ever saw XRP (October 1)

From its launch on September 26 through September 30, the nightly crypto agent received price data for only one of its 10 coins (XRP/USD), so it passed every night and never traded. Its own briefs said so ("the only ticker in the dataset"). Cause: `fetchCryptoMarketData` requested all 10 coins in one call with `limit=6`, but Alpaca's limit counts total data points across all symbols, not per symbol. With newest-first sorting, all six went to XRP. It now requests each coin separately, as the stock side already did. Verified against a fake API that reproduces Alpaca's documented behavior: the old code returns only XRP, the new code all 10. The on-demand crypto form, which requests one coin, was never affected. This restores the designed behavior rather than changing the strategy, but it means crypto paper trades will start happening, and all crypto results before October 1 reflect the bug.

## Bottom line

This is a working, automated, self-grading, self-reflecting research pipeline with a public dashboard on top of it. Price-checked, its directional calls are not yet distinguishable from a coin flip (52.7%), and it hasn't beaten simply holding SPY. The one result that has cleared the project's own statistical bar is that shorts underperform, even after removing the market's move. It is not yet net profitable (-0.41% blended across 97 trades), has not been tested in a real down market, and remains entirely simulated. The honest next milestone is the same as last time: more volume, plus now an actual decision on what to do about the short-side result now that it's real rather than suspected.

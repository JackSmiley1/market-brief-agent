# Market Brief Agent — Status Memo
**September 13, 2026**

## What this is

An automated pipeline that generates a nightly market brief using live market data (Alpaca) and news (Finnhub), fed to Claude for analysis. Each brief includes a small watchlist of tickers with a directional call, a self-rated confidence level, and an event-risk flag. Those calls are layered with simulated trades on Alpaca's paper trading API — zero real capital, no live orders, no real users. The system also grades its own prior calls each night against what actually happened, and a separate checkpoint process reviews the resulting trade data on a fixed schedule.

This is Phase 1 of a longer-term plan. There is no live trading, no investor capital, and no product built for other people to use. That is a deliberate boundary, not a temporary limitation — moving past it requires a legal/registration step that has not been started.

## Current results (as of today)

- 64 closed simulated trades over 22 trading days
- Average return per trade: **-0.36%**
- Total realized P&L: **-$198.14** on $64,000 notional deployed (-0.31% blended)
- Win/loss split: 34 wins / 30 losses (53% win rate)
- Directional accuracy (does the call's thesis play out, independent of position sizing/P&L): **66.3%** across 89 graded calls

That gap — a 66% directional hit rate against a negative average return — is itself the most useful data point so far. It means the analysis is often right about direction, but money-weighted outcomes are still negative, concentrated on the short side (-0.74% avg return, -$184.52 total across 29 short trades, vs. -0.04% avg on 35 long trades). That's a sizing and risk-management problem, not obviously a signal-quality problem, and it's actively being worked — not glossed over.

## Why these numbers are not yet conclusive

Every individual comparison that would justify a strategy change is below the sample size needed to trust it:

- Confidence-level breakdown (high/medium/low): largest bucket has n=22, others are n=12 and n=2
- Event-risk breakdown: **zero** closed trades yet — the field was only added a few weeks ago
- Per-ticker breakdown: no ticker has more than 7 closed trades

A fixed rule (n ≥ 20 per comparison) is enforced in the checkpoint tooling before any pattern is flagged as real. As of today, no comparison clears that bar. This is a "not enough data yet" problem, not a "the results are bad" problem — but it is also not a "the results are good" problem. It's genuinely unresolved.

## What changed recently, and what it hasn't proven yet

On September 10, position sizing was rewritten to cut size on low-confidence calls, event-risk situations, and short positions — based on real evidence from the prior 59 trades (low confidence underperforming, shorts losing money despite a normal win rate, and the worst single trade in the dataset being a low-confidence short into scheduled earnings). Zero trades have resolved under the new sizing rule yet. Its effect is completely unmeasured. That's the single biggest open question right now — not a new bug, just time.

## What hasn't happened at all

- No real market stress test: all data so far comes from a comparatively calm stretch. Performance under real volatility is unknown.
- No UI or product surface of any kind — this is a backend pipeline producing a markdown file and log data.
- No registration, compliance review, or attorney consultation regarding any future multi-user product. That conversation has not started.

## Bottom line

This is a working, automated, self-grading research pipeline with early signal that the directional analysis has some skill, and clear evidence that risk-sizing (especially on shorts) needs more tuning before results turn positive. It is not yet statistically conclusive in any dimension, has not been tested in a real down market, and remains entirely simulated. The honest next milestone is volume — several more weeks of closed trades — not a new feature.

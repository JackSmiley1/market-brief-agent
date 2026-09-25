# Market Brief Agent — Status Memo
**September 24, 2026**

## What this is

An automated pipeline that generates a nightly market brief using live market data (Alpaca) and news (Finnhub), fed to Claude for analysis. Each brief includes a small watchlist of tickers with a directional call, a self-rated confidence level, and an event-risk flag. Those calls are layered with simulated trades on Alpaca's paper trading API — zero real capital, no live orders, no real users. The system grades its own prior calls each night against what actually happened, a checkpoint process reviews the resulting trade data on a fixed schedule, and a separate reflection process periodically synthesizes natural-language lessons from batches of its own losing trades and feeds them back into future briefs as advisory context.

Since the last version of this memo (September 13), the project gained a public-facing layer: a live dashboard (GitHub Pages) showing real pipeline output, an on-demand mode that lets a user prompt the system to analyze and simulate-trade a specific ticker or index outside the fixed nightly watchlist, and a Reflexion-style self-reflection loop. All of that sits on top of the same paper-trading pipeline — none of it changes the core constraint below.

This is Phase 1 of a longer-term plan. There is no live trading, no investor capital, and no product built for other people to use. That is a deliberate boundary, not a temporary limitation — moving past it requires a legal/registration step that has not been started.

## Current results (as of today)

- 93 closed simulated trades
- Average return per trade: **-0.48%**
- Total realized P&L: **-$337.13** on $82,250 notional deployed (-0.41% blended)
- Win/loss split: 45 wins / 48 losses (48.4% win rate)
- Directional accuracy (does the call's thesis play out, independent of position sizing/P&L): **66.7%** across 129 graded calls
- Current streak: **8 losses in a row** — stated plainly rather than smoothed over. At a 48.4% overall win rate, a streak this long isn't statistically shocking, but it's real, it's recent, and it's the immediate backdrop the new reflection-loop lesson (below) was generated against.
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

## Bottom line

This is a working, automated, self-grading, self-reflecting research pipeline with a public dashboard on top of it. Directional analysis continues to show real skill (67% hit rate), and for the first time one of the project's own risk-management hypotheses — that shorts underperform — has cleared the statistical bar it set for itself rather than remaining a hunch. It is not yet net profitable, is on an 8-trade losing streak as of this writing, has not been tested in a real down market, and remains entirely simulated. The honest next milestone is the same as last time: more volume, plus now an actual decision on what to do about the short-side result now that it's real rather than suspected.

# Great Lakes Investments: Roadmap

*Rewritten Oct 21, 2026, after the project moved from paper trading to research. Earlier plans are summarized at the bottom.*

## Where it is now

A public AI research tool for US stocks, ETFs and major cryptocurrencies. It shows multi-horizon performance against the market and sector, risk statistics, and an AI breakdown of why something moved. The numbers are computed in code; Claude writes the explanation. The paper-trading experiment that came before it is finished and kept as the Track Record. The Long-Horizon experiment keeps running quarterly.

## Principles that don't change

- **Research, not advice.** No buy, sell or hold calls and no price targets. General analysis available to everyone, never tailored to a person's situation.
- **Numbers from data, words from the model.** Anything quantitative is computed in code and shown separately from the AI text.
- **Show failures.** Results stay public, including the ones that look bad.
- **No real money and no other people's money** without an explicit, logged decision and proper legal advice first.
- **Free tools first.** The only real cost is Claude calls, capped in the Worker.

## Next (before and around the Drover meeting)

1. Spot-check AI breakdowns against their own numbers and sources. Log any invented figure or misattributed cause.
2. Set a monthly spend limit in the Anthropic console as a hard backstop behind the Worker's caps.
3. Refresh the one-page brief for Dr. Drover around the research tool and the Track Record lesson.
4. Freeze code two days before the meeting.

## Possible next features (3–6 months, pick one or two)

- **Accuracy audit for the AI text:** automatically compare every number in a breakdown against the computed data and flag mismatches publicly. This extends the self-grading finding into a feature.
- **Compare view:** two or three tickers side by side over the same windows.
- **Earnings context:** the next earnings date and the last surprise, from a structured calendar rather than headlines.
- **Watchlist digest:** a short daily email for a handful of tickers, using cached reports. This would be the first real test of whether anyone wants it.
- **Stock-pitch mode:** a breakdown structured like an investment-banking or equity-research stock pitch (thesis, catalysts, risks, valuation context). This overlaps with PitchPrep, Jack's interview-prep project.

## Experiments still running

- **Long-Horizon** (since Oct 2, 2026): quarterly re-forecast each Feb, May, Aug and Nov 15, with a virtual top-five portfolio vs SPY. Judge it around Oct 2027, not before.
- **Fund holdings:** two small buy-and-hold paper positions (SPY, VXUS), valued every weekday.

## Earlier plans, superseded on Oct 20, 2026

The original plan ran from a nightly brief, to paper trading, to a $30 live test, to personal live trading, and possibly to managing outside money or a consumer brokerage app. The paper-trading phase didn't beat SPY (see status-memo.md, Oct 20), so the live-trading path was dropped for this strategy. The later-stage ideas (broker-as-a-service, a fund, international markets, sports betting) are no longer part of this project. Each would require licensing and legal structure that a research tool doesn't need. The full earlier version of this document is in the git history.

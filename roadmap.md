# Market Brief Agent — Long-Term Roadmap

**Written September 24, 2026, capturing a scope decision made explicitly by Jack in conversation that day.**

## Why this document exists

`status-memo.md` is the honest current-state writeup for Phase 1 (paper trading, research pipeline). The project's own working instructions state that Phase 1 and Phase 2 both stay real-capital-free unless an explicit decision changes that, logged in a doc. This is that log, and it also captures a much larger long-term product vision that came up alongside it: eventually trading live with personal capital, then potentially opening the platform to other users for stock/crypto/mutual fund investing, held accounts, sports betting funded from those accounts, and access to London and Asian markets.

This is a planning document, not a build spec. Nothing here is being built yet. It exists so the vision is written down accurately — including the parts that are genuinely hard, expensive, or possibly not combinable — rather than discovered piecemeal later.

## Phase 1 (current): paper-only research pipeline

No change. Zero real capital, zero real users, zero registration requirements. This is the portfolio deliverable for the near-term application deadline and stays exactly as-is.

## Phase 2: personal live trading

The smallest real step in this whole roadmap. Switching from Alpaca's paper API to Alpaca's live trading API for Jack's own account, with Jack's own money, accepting personal risk. No registration is required for someone trading their own capital through a standard brokerage account — this is just "become a regular investor using this system's analysis," not "become a financial institution." The honest prerequisite isn't legal, it's evidentiary: the statistical case in `status-memo.md` (directional calls at 52.7% price-checked, statistically a coin flip; net-negative blended P&L; not ahead of SPY; and a real, sample-size-legitimate finding that shorts underperform) is not yet a case for risking real money. This phase is realistic to reach, but only once the numbers actually justify it — that's a data question, not a compliance question.

### Phase 2 readiness checklist

Three separate kinds of readiness, kept deliberately separate so "the code is ready" never gets mistaken for "it's time":

**Data readiness — not there yet.** The honest, current numbers (see `status-memo.md`) are net-negative blended P&L, a real losing streak, and a real, statistically-legitimate finding that shorts are a net drag even after the existing sizing cut. Directional accuracy is not a green light either: price-checked, it's 52.7%, indistinguishable from a coin flip (Claude's own, more generous grade said 67%). What would actually change this: sustained positive blended P&L (not one good week erasing a bad stretch), the short-side finding either resolved (sized down further, or removed from the strategy) or re-tested and shown to have improved, and the new peer/sector-catalyst hypothesis given enough time to either clear its own n≥20 bar or get discarded. This isn't a number Claude should pick for you — it's worth deciding, in advance, exactly what "good enough" looks like before results start coming in, so the bar doesn't quietly move once real money is on the line.

**Mechanical readiness — small, but not zero.** When the data does justify it: (1) opening a live Alpaca account is a separate onboarding flow through Alpaca directly (identity verification, bank linking) — not something built here; (2) `ALPACA_TRADING_BASE` in `config.js` is deliberately hardcoded to `paper-api.alpaca.markets` as a safeguard, and flipping it to live is a real, explicit, one-line decision that should feel exactly as weighty as it is, not slipped in as a routine config change; (3) live API keys (starting `AK`, not `PK`) are a different secret than the paper ones and would need their own careful handling; (4) position sizing tuned against paper-account psychology and paper-account stakes ($1,000 base notional) is not automatically the right size for real money — that's a separate decision from whether the strategy works at all, and probably starts much smaller regardless of what the paper numbers say.

**Personal readiness — outside what code can tell you.** Real capital gains (especially from ~1-day holds) are taxable events in a way paper trades never were — worth a real conversation with a tax professional before flipping the switch, not something to work out after the fact. Same for genuinely sitting with the idea of an 8-trade losing streak happening with real money instead of paper P&L — the data pipeline can't tell you whether you're personally ready for that, only you can.

None of this changes today. This section exists so that when the data does look different, the decision is a checklist being worked through deliberately, not a switch flipped in the moment.


### DRAFT pass/fail bar (September 27): proposed to Dr. Drover for critique, not yet adopted

Written down before more results come in, so the bar can't quietly move later. Nothing here is decided until Jack edits it and logs it as a decision. Starting amount under discussion: **$30**.

**Where it stands (97 closed nightly trades, Aug 17 – Sep 23):** −0.49% average per trade (95% range −1.03% to +0.06%). Longs −0.08% on 46 trades; shorts −0.85% on 51, which is most of the loss. No evidence of an edge yet. The SPY comparison on the dashboard fills in after the first benchmark run.

**Gate A: a $30 live mechanics test (not a bet on the strategy).** $30 caps the loss at $30, so the question here is "is it safe to run," not "does it make money":
1. Scope: nightly picks only, **long-only** (shorting needs a $2,000 margin account), fractional shares, a handful of dollars per position. No dashboard buttons, no on-demand, no crypto, no fund allocation on the live account.
2. Separation: the live account runs from its own workflow with its own secrets. The public Worker/PIN path can never reach it. Live trades are recorded apart from paper evidence and never pooled with it.
3. A kill switch: one setting that stops all live orders, checked before every order.
   Stop rule: live trading pauses if the live account falls 20% from its high, pending review.
4. Reliability: 20 consecutive weekday nightly runs on paper with no failed step and no manual fix.
5. Account mechanics confirmed with Alpaca before the first order: how settlement works for a sub-$2,000 account with daily turnover, and fractional-share support for every watchlist ticker.
6. The switch itself (`ALPACA_TRADING_BASE` + live keys) is flipped by Jack deliberately, logged here as a decision, per this project's hard line. Not by an assistant, not as a routine change.

**Gate B: evidence to go beyond $30.** Measured on nightly **long** trades only, since live is long-only:
1. At least **150 closed nightly long trades** (46 today). Per-trade returns swing about ±2.7%, so roughly 140 trades are needed to detect a 0.45% per-trade edge at 95% confidence. At roughly 1.7 long trades a day, that's around the end of December 2026 at the earliest.
2. Average **market-adjusted** return per long trade (trade minus SPY over the same window) above zero, with the 95% range's lower end also above zero.
3. Long-side P&L still positive after assuming 0.1% round-trip slippage/costs per trade.
4. After at least 30 live trades, live results track paper within about 0.2% per trade (tests whether paper fills were realistic).
5. Step up gradually ($30 → $100 → $300), with the gate still holding at each step.

**What resets the count:** a material change to what the nightly agent picks (its prompt, watchlist, or sizing rules). Trades before and after such a change are different strategies and shouldn't be pooled into one sample.

## Phase 3: opening the platform to other users (accounts, stocks, crypto, mutual funds)

This is where the project stops being "an app you built" and starts being "a licensed financial institution," because holding other people's money and executing trades on their behalf is custody — one of the most heavily regulated activities in finance. Two realistic paths exist:

**Path A — become the broker-dealer.** Register directly with the SEC and FINRA. Real numbers from current research: FINRA new-member application fees alone run roughly $7,500–$55,000 depending on complexity, on top of a minimum net capital requirement of $50,000–$100,000 that must be maintained continuously, plus legal, compliance, and technology costs on top of that. The process is described industry-wide as slow and demanding — expect it to be measured in years, not months, and to require securities counsel throughout.

**Path B — broker-as-a-service.** Partner with an already-licensed broker-dealer that exposes their license through an API — Alpaca's own Broker API, DriveWealth, or Apex Fintech Solutions are the established players. They handle KYC/AML, custody, clearing, and the regulatory relationship; the product built on top is a client of theirs, not a registered broker itself. This is how most fintech investing apps actually launch — it doesn't remove the need for real compliance work (funding, disclosures, agreements with the provider), but it removes the multi-year registration process. This is the realistic path if Phase 3 is ever pursued.

**Crypto specifically** has an equivalent shortcut: providers like Zero Hash handle crypto trading, custody, and the associated money-transmitter licensing (Zero Hash reports holding 51 state money transmitter licenses plus FinCEN MSB registration and a NY BitLicense) and expose it as an API, so a partner product doesn't need its own money transmitter licenses in every state. Same pattern as broker-as-a-service: real regulatory weight, carried by a specialized partner instead of built from scratch.

**Mutual funds / index funds (S&P 500, Vanguard-style products)** fall under the same broker-dealer umbrella as regular stock trading — no separate licensing category, but fund-specific agreements (e.g., access to Vanguard's actual fund lineup) would need to go through whichever broker-as-a-service partner is chosen, or be approximated with ETFs (SPY, VOO) that are already tradable through standard brokerage rails, which is a meaningfully smaller lift than actual mutual fund share-class access.

## Phase 4: international markets (London, Asian exchanges)

Additive on top of Phase 3, not a separate track. Operating in the UK requires FCA authorization for any firm carrying out regulated investment activities there — described even in current guidance as a significant undertaking with its own application window and ongoing supervision requirements (operational resilience, financial crime controls, Consumer Duty). Asian markets (Japan, Hong Kong, Singapore, etc.) each have their own separate regulators with no single shortcut. In practice, this phase most realistically happens by choosing a broker-as-a-service partner that already has international reach, rather than pursuing FCA/Asian authorization independently — worth confirming which of the Phase 3 partners actually offer that before assuming it's included.

## Sports betting funded from account savings

This is the part of the vision that needs the most direct treatment, and Jack has asked for it to stay in the long-term plan as-is, so here's what that actually requires, stated plainly rather than softened.

Sports betting is regulated entirely separately from securities — different regulators, different laws, licensed state by state in the US (where it's legal at all), with real, large costs: New Jersey's initial sports pool license is $100,000; Connecticut's is $250,000 for online operators, $100,000/year after that; and that's before integration costs and proving operational funding reserves. There is no single national license and no path that bundles it with a brokerage registration.

More importantly, both industries independently require segregating customer funds. Securities law (SEC Rule 15c3-3) requires a broker to hold customer funds separately from the firm's own money. Gambling regulations impose the same requirement from the other side — sports-bettor funds generally have to sit in a segregated account, held in trust, with articles of incorporation that explicitly prohibit commingling. Two separate segregation requirements, from two separate regulatory regimes, both pointing the same direction: this cannot legally be "one pooled account that either invests or bets." The closest realistic version is two entirely separate licensed products — a brokerage and a sportsbook, each independently licensed, each holding its own segregated funds — with, at most, a transfer button that moves money from one to the other, the way some apps let you move funds between a checking and an investing product today. Even then, it's worth being clear-eyed that a sportsbook and a brokerage account living inside the same app, marketed to the same users, is the kind of pattern that draws fast regulatory attention specifically because it makes it easy to gamble away money someone meant to invest. That's a real product-design risk independent of the licensing question.

## Decision: Phase 3 direction is the fund, not the consumer app

September 25: between the two Phase 3 paths described above, this project's intended direction is **3b, the fund** (managing outside capital as an investment adviser or under a private-fund exemption), not 3a, the consumer app (individual user accounts, bank-linking, deposits/withdrawals). Reasoning: the fund path is structurally closer to what's already built — one system's output, one trading account, graded and refined — while the consumer app path requires becoming a custody-holding broker-dealer-adjacent product for many individual users, which is a materially larger and more expensive legal and operational undertaking (KYC/AML per user, holding individual balances, withdrawal flows) for a solo builder. This decision does not change anything about Phase 1 or Phase 2, and does not accelerate either — it exists so that if and when Phase 3 groundwork ever starts, design choices (data model, terminology, what "the system" is accountable to) default toward one path instead of staying generic across both. Nothing about international markets (Phase 4) or sports betting changes as a result; both remain sequenced after Phase 3 regardless of which fork.

## Sequencing, if this is ever pursued for real

1. Phase 2 (personal live trading) only once the paper-trading evidence actually supports it. As of September 27 it does not: see the draft pass/fail bar below, which puts the earliest point for anything beyond a $30 mechanics test around the end of December 2026, and only if the results turn positive.
2. If Phase 3 is pursued, broker-as-a-service (Path B) over direct SEC/FINRA registration (Path A) — same end capability, a small fraction of the cost and time.
3. Crypto via a crypto-as-a-service partner (Zero Hash or similar) rather than pursuing money transmitter licenses independently.
4. International access evaluated per Phase 3 partner's existing reach before assuming a separate FCA/Asian-market track is needed.
5. Sports betting, if pursued at all, built and licensed as a fully separate product from day one — never as a feature inside the investing account.

## What doesn't change today

Nothing. This document is a plan, not a trigger. Phase 1 stays paper-only, Phase 2 stays gated on real evidence the current data doesn't yet show, and nothing in Phase 3 or beyond gets built without a registered or partnered legal structure in place first. Anthropic's Claude — including in this project — won't execute real trades, hold real customer funds, or build real-money gambling functionality regardless of phase; any of that work, when the time comes, goes through the broker-as-a-service partner's own tooling and licensed counsel, not through code written here.

---

Sources consulted while drafting this:
- [Alpaca Broker API](https://alpaca.markets/broker) / [About Broker API](https://docs.alpaca.markets/us/docs/about-broker-api)
- [DriveWealth — Infrastructure for Modern Investing](https://www.drivewealth.com/)
- [Zero Hash — Crypto Trading Infrastructure](https://zerohash.com/products/crypto-trading-infrastructure)
- [How Much Does it Cost to Register as a Broker-Dealer?](https://lenderkit.com/blog/costs-to-register-a-broker-dealer/)
- [How to Start a Broker-Dealer: Costs, Requirements, Timelines](https://gtsecurities.net/blog/resources/starting-a-broker-dealer/)
- [Step-by-Step Guide to FCA Authorisation in 2026](https://www.innreg.com/blog/fca-authorisation-guide)
- [International firms looking to do business in the UK | FCA](https://www.fca.org.uk/firms/wholesale-markets-firm-applicants/international-firms)
- [Sports Betting License Guide 2026](https://prometteursolutions.com/blog/sports-betting-app-licensing-here-is-a-comprehensive-guide/)
- [11VAC5-80-100. Security of funds and data (fund segregation, sports betting)](https://law.lis.virginia.gov/admincode/title11/agency5/chapter80/section100/)

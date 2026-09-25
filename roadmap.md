# Market Brief Agent — Long-Term Roadmap

**Written September 24, 2026, capturing a scope decision made explicitly by Jack in conversation that day.**

## Why this document exists

`status-memo.md` is the honest current-state writeup for Phase 1 (paper trading, research pipeline). The project's own working instructions state that Phase 1 and Phase 2 both stay real-capital-free unless an explicit decision changes that, logged in a doc. This is that log, and it also captures a much larger long-term product vision that came up alongside it: eventually trading live with personal capital, then potentially opening the platform to other users for stock/crypto/mutual fund investing, held accounts, sports betting funded from those accounts, and access to London and Asian markets.

This is a planning document, not a build spec. Nothing here is being built yet. It exists so the vision is written down accurately — including the parts that are genuinely hard, expensive, or possibly not combinable — rather than discovered piecemeal later.

## Phase 1 (current): paper-only research pipeline

No change. Zero real capital, zero real users, zero registration requirements. This is the portfolio deliverable for the near-term application deadline and stays exactly as-is.

## Phase 2: personal live trading

The smallest real step in this whole roadmap. Switching from Alpaca's paper API to Alpaca's live trading API for Jack's own account, with Jack's own money, accepting personal risk. No registration is required for someone trading their own capital through a standard brokerage account — this is just "become a regular investor using this system's analysis," not "become a financial institution." The honest prerequisite isn't legal, it's evidentiary: the statistical case in `status-memo.md` (66.7% directional accuracy, but still net-negative blended P&L, and a real, sample-size-legitimate finding that shorts underperform) is not yet a case for risking real money. This phase is realistic to reach, but only once the numbers actually justify it — that's a data question, not a compliance question.

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

## Sequencing, if this is ever pursued for real

1. Phase 2 (personal live trading) only once the paper-trading evidence actually supports it — this is close, not distant.
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

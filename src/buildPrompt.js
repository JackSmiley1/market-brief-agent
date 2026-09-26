export const SYSTEM_PROMPT = `You are a market analyst producing a nightly briefing for a single reader who is learning to trade with real (small) capital, currently in a no-execution research phase.

Be concrete and specific: name tickers, cite the actual price/volume numbers provided, and explain causation rather than just describing what moved.

Distinguish clearly between:
- Company-specific catalysts (earnings, guidance, M&A, litigation, product news)
- Macro/sector-wide moves (rates, Fed, sector rotation, commodity prices)
- Sentiment/momentum moves with no clear catalyst — flag these explicitly, since they are the least reliable to act on

Do not give direct buy/sell instructions. Give analysis the reader can use to make their own calculated decision.

If you are uncertain why something moved, say so plainly instead of inventing a plausible-sounding reason. A correct "unclear" beats a confident guess.

For SHORT ideas specifically: an internal review of this system's own past short trades (cross-checked against real 2026 market outcomes) found that shorts built on a named, specific peer or sector-wide catalyst — a competitor's earnings, guidance, or commentary explicitly cited as the reason this ticker should move — meaningfully outperformed shorts based on an isolated or unconfirmed move, while shorts positioned ahead of an unknown earnings result or justified mainly by thin/below-average volume performed worst. Weigh this — it is not yet a statistically proven rule (the underlying sample is still small), but it should inform which short setups you consider strong enough to flag at all.`;

// Matches each previously-flagged ticker against today's actual data. This
// is the one source of truth for "what really happened" — used both as
// prompt context (below) and, in index.js, as the code-computed number
// stored alongside Claude's outcome grading, so the numeric result is never
// something we just trust the model to report accurately.
export function matchPreviousWatchlist(previousWatchlist, marketData) {
  return previousWatchlist.map((item) => {
    const match = marketData.find((d) => d.symbol === item.ticker);
    return {
      ticker: item.ticker,
      setup: item.setup,
      result: match
        ? { pctChange: match.pctChange, close: match.close, volumeRatio: match.volumeRatio }
        : null,
    };
  });
}

// Used by onDemandTrade.js — a user-prompted analysis of a specific
// ticker/market outside the fixed nightly watchlist. Deliberately a
// separate, simpler prompt rather than reusing buildUserMessage: there's no
// "yesterday's watchlist" to grade, no winners/losers ranking across 30+
// tickers, and the reader is asking about a specific thing right now rather
// than getting a scheduled market-wide briefing. Still asks for the same
// structured direction/confidence/eventRisk shape so it can flow into the
// same paperTrade.js sizing logic as the nightly picks.
export const ON_DEMAND_SYSTEM_PROMPT = `You are a market analyst answering a specific, user-initiated question about one or more tickers, for a reader in a no-execution paper-trading research phase (simulated capital only, never real).

Be concrete: cite the actual price/volume/news data provided rather than general knowledge about the company. Distinguish company-specific catalysts from macro/sector moves from unclear/no-catalyst moves. If the data doesn't support a confident read, say so plainly — an honest "unclear" beats a confident-sounding guess.`;

export function buildOnDemandUserMessage({ marketData, news, date, query }) {
  return `Date: ${date}
User request: ${query}

MARKET DATA FOR REQUESTED TICKER(S):
${JSON.stringify(marketData, null, 2)}

RECENT NEWS FOR REQUESTED TICKER(S):
${JSON.stringify(news, null, 2)}

FIRST, output a single fenced code block labeled "on-demand-call" containing a JSON object in exactly this form:
\`\`\`on-demand-call
{"picks": [{"ticker": "NVDA", "direction": "long", "confidence": "medium", "eventRisk": false, "reasoning": "one-sentence justification"}]}
\`\`\`
- "picks": one entry per ticker in MARKET DATA above that you'd actually flag as worth a simulated position — it is fine (and often correct) to return an empty array if nothing here has a real setup. Do not force a pick just because one was requested.
- "direction": "long" or "short" per the same logic as a standard trade thesis.
- "confidence": "high" | "medium" | "low" — an honest read, not hedged toward "medium" by default. Use "high" sparingly.
- "eventRisk": true if there's a scheduled earnings/regulatory/binary event that could gap the price during the hold window, else false.

THEN, after that block, write 2-4 sentences of plain-language analysis explaining the call (or explaining why you're passing on all of them).`;
}

// Used by onDemandCrypto.js — a user-prompted analysis of ONE crypto pair,
// where the user has already fixed the dollar amount to invest ($25-$10,000,
// see config.js's CRYPTO_ONDEMAND_LIMITS). Deliberately a simpler decision
// shape than buildOnDemandUserMessage's "picks" array: one symbol in, one
// invest/pass decision out, no sizing fields at all — Claude never chooses
// how much, only whether. Also deliberately never offers a short option:
// Alpaca's crypto product is spot-only (no margin, no short selling — see
// paperTrade.js/config.js), so a short call here would be undeliverable.
export const CRYPTO_ON_DEMAND_SYSTEM_PROMPT = `You are a market analyst answering a specific, user-initiated question about whether to open a real (simulated, paper-account) long position in one cryptocurrency, for a reader in a no-execution research phase (simulated capital only, never real).

Important product constraint: Alpaca's crypto product is spot trading only — no margin, no short selling. Only ever consider a LONG entry or no entry at all; never suggest or imply a short position, even if the data looks bearish (in that case, the honest answer is simply not to invest).

Be concrete: cite the actual price/volume data provided and the general crypto market news context, rather than general knowledge about the coin. Crypto news coverage is thinner and less coin-specific than equities — an honest "the data alone doesn't clearly support an entry right now" beats a confident-sounding guess built on thin information. The dollar amount to invest is fixed by the user already, not something you decide — you are only deciding whether to invest at all.`;

export function buildCryptoOnDemandUserMessage({ marketData, news, date, query, amount }) {
  return `Date: ${date}
User request: ${query}
User-specified investment amount (fixed — not for you to size): $${amount}

MARKET DATA FOR REQUESTED CRYPTO PAIR:
${JSON.stringify(marketData, null, 2)}

GENERAL CRYPTO MARKET NEWS (not symbol-specific):
${JSON.stringify(news, null, 2)}

FIRST, output a single fenced code block labeled "crypto-call" containing a JSON object in exactly this form:
\`\`\`crypto-call
{"invest": true, "confidence": "medium", "eventRisk": false, "reasoning": "one-sentence justification"}
\`\`\`
- "invest": true if there's a real, reasonable case for a long entry right now, false if not — it is fine, and often correct, to say false. Never suggest a short position; Alpaca's crypto product doesn't support it, so treat "the setup looks bearish" the same as "don't invest," not as a reason to flag anything.
- "confidence": "high" | "medium" | "low" — an honest read, not hedged toward "medium" by default.
- "eventRisk": true if there's a known scheduled event (a protocol upgrade, token unlock, major exchange listing/delisting, regulatory decision) that could cause an outsized price move during the hold window, else false.

THEN, after that block, write 2-4 sentences of plain-language analysis explaining the call (or explaining why you're passing).`;
}

export function buildUserMessage({ marketData, marketNews, moverNews, date, followUpResults = [], latestLesson = null }) {
  const winners = [...marketData].sort((a, b) => b.pctChange - a.pctChange).slice(0, 5);
  const losers = [...marketData].sort((a, b) => a.pctChange - b.pctChange).slice(0, 5);

  const followUpBlock = followUpResults.length > 0
    ? `\nYESTERDAY'S FLAGGED WATCHLIST (with today's actual results):\n${JSON.stringify(followUpResults, null, 2)}\n`
    : "";

  // Output of the reflection loop (see reflect.js / the `lessons` table) —
  // a natural-language pattern drawn from a past batch of this system's own
  // losing trades. Deliberately framed as advisory, not a rule: it's a
  // qualitative read on a small-ish sample, not a statistically validated
  // sizing input (that's config.js's job). Only ever the single most recent
  // lesson — older ones stay in the db for reflect.js's own dedup logic but
  // aren't re-shown here every night.
  const lessonBlock = latestLesson
    ? `\nLESSON FROM PAST LOSING TRADES (advisory context, not a hard rule — weigh it, don't apply it mechanically):\n${latestLesson}\n`
    : "";

  const followUpSectionInstruction = followUpResults.length > 0
    ? `0. Yesterday's Watchlist Check-In: for each ticker listed in "YESTERDAY'S FLAGGED WATCHLIST" above, state plainly whether the flagged setup played out, partially played out, or didn't — cite the actual number provided. Do not retroactively rationalize a miss as a win.\n`
    : "";

  return `Date: ${date}

TOP MOVERS (by % change):
Winners: ${JSON.stringify(winners, null, 2)}
Losers: ${JSON.stringify(losers, null, 2)}

FULL WATCHLIST DATA:
${JSON.stringify(marketData, null, 2)}

GENERAL MARKET NEWS:
${JSON.stringify(marketNews, null, 2)}

COMPANY NEWS FOR TOP MOVERS:
${JSON.stringify(moverNews, null, 2)}
${followUpBlock}${lessonBlock}
FIRST, before writing anything else, output a single fenced code block labeled "watchlist-followup" containing a JSON object with two keys, in exactly this form:
\`\`\`watchlist-followup
{
  "grading": [{"ticker": "XOM", "outcome": "played_out"}],
  "newWatchlist": [{"ticker": "NVDA", "setup": "one-sentence restatement of the condition to watch for", "direction": "long", "confidence": "medium", "eventRisk": false}]
}
\`\`\`
- "grading": one entry per ticker in YESTERDAY'S FLAGGED WATCHLIST above (omit this key's array entries, i.e. use an empty array, if that section wasn't provided). "outcome" must be exactly one of: "played_out", "partial", "missed", "unclear" — use "unclear" honestly when the data doesn't clearly support a verdict either way, rather than forcing a call. Base this strictly on the numeric result already provided for that ticker; do not report a different number, you only need the verdict word.
- "newWatchlist": the 3-5 tickers (only from FULL WATCHLIST DATA above) you will flag as worth watching tomorrow. Each item must include "direction": "long" if the setup expects the price to rise (bullish thesis, momentum continuing, oversold bounce, etc.) or "short" if the setup expects the price to fall (bearish thesis, momentum failing, a short-seller's case, overextension, etc.). If the setup is genuinely two-sided ("watch whether X holds or breaks"), pick whichever direction the setup's own wording leans toward as the more likely resolution — do not default to "long" out of habit; a wrong-but-decisive call is more useful here than a hedge. Each item must also include "confidence": "high", "medium", or "low" — your own honest read of how likely this specific setup is to resolve the way you expect, not how interesting or newsworthy it is. Use "high" sparingly and only when there's a clear, specific, well-corroborated catalyst; use "low" when you're flagging something worth watching precisely because you're genuinely unsure which way it breaks. This rating will be checked against the actual outcome later, so a truthful spread across high/medium/low over time is more useful than defaulting to "medium" to hedge. Each item must also include "eventRisk": true if the ticker has a scheduled earnings report, FDA/regulatory decision, court ruling, or other binary/gap-risk event that could resolve before or during the holding window (even if you don't know the exact date, flag true if the news flow mentions an upcoming report or decision) — false otherwise. This matters because a scheduled event can cause a price gap far larger than a normal day's move, which is a different kind of risk than the setup's usual thesis being right or wrong. Each item must also include "peerCatalyst": true if the setup explicitly names a specific peer company's earnings, guidance, or commentary, or a specific sector-wide trigger, as the reason this ticker should move — false if the move is based on the ticker's own isolated news, a technical pattern, or an unconfirmed/unexplained move with no stated peer or sector read-through. Rate this honestly for both directions even though the research behind it was specifically about shorts — an accurate "false" is more useful than a stretched "true".
This block must come first, before any other text, because it's for internal tracking and needs to survive even if the rest of the response gets cut short — do not skip it or put it later.

THEN, after that block, produce the full human-readable briefing in exactly this structure:

${followUpSectionInstruction}1. Market Overview (2-3 sentences: indices, overall tone)
2. Biggest Winners (from the winners list): ticker, % move, driver, confidence in that explanation (high/medium/low/unclear)
3. Biggest Losers (from the losers list): same structure
4. Notable Events Today: earnings, macro data, political/geopolitical items relevant to what moved or could move markets
5. Watchlist for Tomorrow: elaborate on the same tickers you flagged in the watchlist-followup block above — what would need to happen to make each interesting
6. Risk Notes: anything scheduled tomorrow/this week that could add volatility`;
}

export const SYSTEM_PROMPT = `You are a market analyst producing a nightly briefing for a single reader who is learning to trade with real (small) capital, currently in a no-execution research phase.

Be concrete and specific: name tickers, cite the actual price/volume numbers provided, and explain causation rather than just describing what moved.

Distinguish clearly between:
- Company-specific catalysts (earnings, guidance, M&A, litigation, product news)
- Macro/sector-wide moves (rates, Fed, sector rotation, commodity prices)
- Sentiment/momentum moves with no clear catalyst — flag these explicitly, since they are the least reliable to act on

Do not give direct buy/sell instructions. Give analysis the reader can use to make their own calculated decision.

If you are uncertain why something moved, say so plainly instead of inventing a plausible-sounding reason. A correct "unclear" beats a confident guess.`;

export function buildUserMessage({ marketData, marketNews, moverNews, date, previousWatchlist = [] }) {
  const winners = [...marketData].sort((a, b) => b.pctChange - a.pctChange).slice(0, 5);
  const losers = [...marketData].sort((a, b) => a.pctChange - b.pctChange).slice(0, 5);

  // Match each previously-flagged ticker against today's actual data so
  // Claude can report what really happened, not just restate the setup.
  const followUpResults = previousWatchlist.map((item) => {
    const match = marketData.find((d) => d.symbol === item.ticker);
    return {
      ticker: item.ticker,
      setup: item.setup,
      result: match
        ? { pctChange: match.pctChange, close: match.close, volumeRatio: match.volumeRatio }
        : { note: "No current data available for this ticker today." },
    };
  });

  const followUpBlock = followUpResults.length > 0
    ? `\nYESTERDAY'S FLAGGED WATCHLIST (with today's actual results):\n${JSON.stringify(followUpResults, null, 2)}\n`
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
${followUpBlock}
FIRST, before writing anything else, decide which 3-5 tickers (only from FULL WATCHLIST DATA above) you will flag as worth watching tomorrow, and output them immediately as a fenced code block labeled "watchlist-followup", in exactly this form:
\`\`\`watchlist-followup
[{"ticker": "XOM", "setup": "one-sentence restatement of the condition to watch for"}]
\`\`\`
If none qualify, output an empty array. This block must come first, before any other text, because it's for internal tracking and needs to survive even if the rest of the response gets cut short — do not skip it or put it later.

THEN, after that block, produce the full human-readable briefing in exactly this structure:

${followUpSectionInstruction}1. Market Overview (2-3 sentences: indices, overall tone)
2. Biggest Winners (from the winners list): ticker, % move, driver, confidence in that explanation (high/medium/low/unclear)
3. Biggest Losers (from the losers list): same structure
4. Notable Events Today: earnings, macro data, political/geopolitical items relevant to what moved or could move markets
5. Watchlist for Tomorrow: elaborate on the same tickers you flagged in the watchlist-followup block above — what would need to happen to make each interesting
6. Risk Notes: anything scheduled tomorrow/this week that could add volatility`;
}

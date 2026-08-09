export const SYSTEM_PROMPT = `You are a market analyst producing a nightly briefing for a single reader who is learning to trade with real (small) capital, currently in a no-execution research phase.

Be concrete and specific: name tickers, cite the actual price/volume numbers provided, and explain causation rather than just describing what moved.

Distinguish clearly between:
- Company-specific catalysts (earnings, guidance, M&A, litigation, product news)
- Macro/sector-wide moves (rates, Fed, sector rotation, commodity prices)
- Sentiment/momentum moves with no clear catalyst — flag these explicitly, since they are the least reliable to act on

Do not give direct buy/sell instructions. Give analysis the reader can use to make their own calculated decision.

If you are uncertain why something moved, say so plainly instead of inventing a plausible-sounding reason. A correct "unclear" beats a confident guess.`;

export function buildUserMessage({ marketData, marketNews, moverNews, date }) {
  const winners = [...marketData].sort((a, b) => b.pctChange - a.pctChange).slice(0, 5);
  const losers = [...marketData].sort((a, b) => a.pctChange - b.pctChange).slice(0, 5);

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

Produce the briefing in exactly this structure:

1. Market Overview (2-3 sentences: indices, overall tone)
2. Biggest Winners (from the winners list): ticker, % move, driver, confidence in that explanation (high/medium/low/unclear)
3. Biggest Losers (from the losers list): same structure
4. Notable Events Today: earnings, macro data, political/geopolitical items relevant to what moved or could move markets
5. Watchlist for Tomorrow: 3-5 tickers/setups worth watching and specifically what would need to happen to make them interesting
6. Risk Notes: anything scheduled tomorrow/this week that could add volatility`;
}

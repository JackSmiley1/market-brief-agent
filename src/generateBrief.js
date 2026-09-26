import Anthropic from "@anthropic-ai/sdk";
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  ON_DEMAND_SYSTEM_PROMPT,
  buildOnDemandUserMessage,
  CRYPTO_ON_DEMAND_SYSTEM_PROMPT,
  buildCryptoOnDemandUserMessage,
} from "./buildPrompt.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateBrief({ marketData, marketNews, moverNews, date, followUpResults, latestLesson }) {
  const userMessage = buildUserMessage({ marketData, marketNews, moverNews, date, followUpResults, latestLesson });

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  if (response.stop_reason === "max_tokens") {
    console.warn(
      "generateBrief: response was truncated (hit max_tokens at 8192). The saved brief is incomplete — consider raising the limit further."
    );
  }

  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  // The structured block is requested FIRST in the prompt specifically so it
  // survives truncation — extract it from wherever it appears (should be
  // near the start) rather than assuming a fixed position, and remove it
  // from the saved human-readable text.
  const followUpMatch = rawText.match(/```watchlist-followup\s*([\s\S]*?)```/);
  let followUpItems = [];
  let gradingItems = [];
  let briefText = rawText;

  const validOutcomes = new Set(["played_out", "partial", "missed", "unclear"]);

  if (followUpMatch) {
    briefText = (
      rawText.slice(0, followUpMatch.index) +
      rawText.slice(followUpMatch.index + followUpMatch[0].length)
    ).trim();
    try {
      const parsed = JSON.parse(followUpMatch[1].trim());
      if (Array.isArray(parsed.newWatchlist)) followUpItems = parsed.newWatchlist;
      if (Array.isArray(parsed.grading)) {
        gradingItems = parsed.grading.filter((g) => {
          const ok = validOutcomes.has(g.outcome);
          if (!ok) console.warn(`generateBrief: dropping grading entry with invalid outcome "${g.outcome}" for ${g.ticker}`);
          return ok;
        });
      }
    } catch (err) {
      console.warn("generateBrief: failed to parse watchlist-followup block, skipping:", err.message);
    }
  } else {
    console.warn("generateBrief: no watchlist-followup block found in response.");
  }

  return { briefText, followUpItems, gradingItems };
}

// Same client, same "structured block first" pattern as generateBrief, but
// for a one-off user-prompted ticker/market question (see
// buildOnDemandUserMessage) rather than the scheduled nightly briefing.
export async function generateOnDemandCall({ marketData, news, date, query }) {
  const userMessage = buildOnDemandUserMessage({ marketData, news, date, query });

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    system: ON_DEMAND_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const match = rawText.match(/```on-demand-call\s*([\s\S]*?)```/);
  let picks = [];
  let analysisText = rawText;

  if (match) {
    analysisText = (rawText.slice(0, match.index) + rawText.slice(match.index + match[0].length)).trim();
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed.picks)) picks = parsed.picks;
    } catch (err) {
      console.warn("generateOnDemandCall: failed to parse on-demand-call block, skipping:", err.message);
    }
  } else {
    console.warn("generateOnDemandCall: no on-demand-call block found in response.");
  }

  return { analysisText, picks };
}

// Same client, same "structured block first" pattern again, but for
// onDemandCrypto.js's simpler one-symbol invest/pass decision (see
// buildCryptoOnDemandUserMessage) rather than a list of ticker picks.
export async function generateCryptoOnDemandCall({ marketData, news, date, query, amount }) {
  const userMessage = buildCryptoOnDemandUserMessage({ marketData, news, date, query, amount });

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    system: CRYPTO_ON_DEMAND_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const match = rawText.match(/```crypto-call\s*([\s\S]*?)```/);
  let decision = null;
  let analysisText = rawText;

  if (match) {
    analysisText = (rawText.slice(0, match.index) + rawText.slice(match.index + match[0].length)).trim();
    try {
      decision = JSON.parse(match[1].trim());
    } catch (err) {
      console.warn("generateCryptoOnDemandCall: failed to parse crypto-call block, skipping:", err.message);
    }
  } else {
    console.warn("generateCryptoOnDemandCall: no crypto-call block found in response.");
  }

  return { analysisText, decision };
}

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildUserMessage } from "./buildPrompt.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateBrief({ marketData, marketNews, moverNews, date, previousWatchlist }) {
  const userMessage = buildUserMessage({ marketData, marketNews, moverNews, date, previousWatchlist });

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
  let briefText = rawText;

  if (followUpMatch) {
    briefText = (
      rawText.slice(0, followUpMatch.index) +
      rawText.slice(followUpMatch.index + followUpMatch[0].length)
    ).trim();
    try {
      const parsed = JSON.parse(followUpMatch[1].trim());
      if (Array.isArray(parsed)) followUpItems = parsed;
    } catch (err) {
      console.warn("generateBrief: failed to parse watchlist-followup block, skipping:", err.message);
    }
  } else {
    console.warn("generateBrief: no watchlist-followup block found in response.");
  }

  return { briefText, followUpItems };
}

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildUserMessage } from "./buildPrompt.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateBrief({ marketData, marketNews, moverNews, date }) {
  const userMessage = buildUserMessage({ marketData, marketNews, moverNews, date });

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  if (response.stop_reason === "max_tokens") {
    console.warn(
      "generateBrief: response was truncated (hit max_tokens at 4096). The saved brief is incomplete — consider raising the limit further."
    );
  }

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db.js";

// Reflexion-style learning loop — see the comment on the `lessons` table in
// db.js for why this exists alongside (not instead of) the numeric sizing
// rules in config.js. Sizing answers "how much capital to risk"; this
// answers "what pattern should future picks watch out for," synthesized in
// natural language from the system's own recent losing trades — the
// original setup reasoning plus what actually happened, not just a
// win/loss tally. This is the same technique used by CryptoTrade and other
// LLM trading agents to improve without retraining: convert outcomes into
// linguistic feedback, carry it forward as context.
//
// Deliberately NOT run on every loss — that would mean drawing conclusions
// from single anecdotes, exactly the overfitting-on-noise failure mode
// checkpoint.js's n>=20 gate exists to prevent for numeric sizing. This
// script has its own, smaller gate (MIN_NEW_LOSSES) appropriate to
// qualitative pattern review rather than statistical significance — still
// a real bar, just a different kind of one.
const MIN_NEW_LOSSES = 10;
const MAX_PRIOR_LESSONS_SHOWN = 3;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function keyOf(row) {
  return `${row.date}|${row.ticker}`;
}

async function run() {
  const losses = db
    .prepare(
      `SELECT p.date, p.ticker, p.direction, p.realized_pnl_pct,
              w.setup, w.confidence, w.event_risk
       FROM paper_trades p
       LEFT JOIN watchlist_followups w ON p.date = w.date AND p.ticker = w.ticker
       WHERE p.status = 'closed' AND p.source = 'nightly' AND p.realized_pnl < 0
       ORDER BY p.date`
    )
    .all();

  const priorLessons = db.prepare(`SELECT based_on_ids FROM lessons`).all();
  const alreadyReflected = new Set();
  for (const row of priorLessons) {
    for (const id of row.based_on_ids.split(",")) alreadyReflected.add(id);
  }

  const newLosses = losses.filter((r) => !alreadyReflected.has(keyOf(r)));

  console.log(`reflect: ${losses.length} total closed losing trades, ${newLosses.length} not yet reflected on.`);

  if (newLosses.length < MIN_NEW_LOSSES) {
    console.log(`reflect: below the gate (need ${MIN_NEW_LOSSES}) — skipping, nothing to do yet.`);
    return;
  }

  const recentLessons = db
    .prepare(`SELECT lesson_text FROM lessons ORDER BY id DESC LIMIT ?`)
    .all(MAX_PRIOR_LESSONS_SHOWN)
    .map((r) => r.lesson_text);

  const lossesBlock = newLosses
    .map(
      (r) =>
        `- ${r.date} ${r.ticker} (${r.direction}, confidence=${r.confidence ?? "unrated"}, eventRisk=${r.event_risk === 1}): ` +
        `original thesis: "${r.setup ?? "no setup text recorded"}" — actual result: ${r.realized_pnl_pct.toFixed(2)}%`
    )
    .join("\n");

  const priorLessonsBlock = recentLessons.length
    ? `\nPRIOR LESSONS ALREADY IDENTIFIED (don't just repeat these — note only if still relevant, or find something new):\n${recentLessons.map((l) => `- ${l}`).join("\n")}\n`
    : "";

  const prompt = `You are reviewing a batch of ${newLosses.length} losing simulated paper trades from your own past picks, to extract honest, falsifiable lessons for future picks. This is qualitative pattern review, not statistics — be conservative, and if there isn't a real recurring pattern across multiple trades here, say so plainly rather than inventing one from a small batch.

LOSING TRADES (original thesis vs. what actually happened):
${lossesBlock}
${priorLessonsBlock}
Write 2-4 short, concrete, falsifiable observations about patterns across MULTIPLE trades in this batch (not single anecdotes) that future picks should weigh — things like a recurring setup type, a confidence/direction combination, or a category of catalyst that keeps failing. Phrase each as something to watch for and weigh against, not a hard rule. If there is no real recurring pattern in this batch, say exactly that instead of forcing one. Keep the whole response under 150 words, plain text, no headers or bullet formatting.`;

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const lessonText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const basedOnIds = newLosses.map(keyOf).join(",");
  db.prepare(
    `INSERT INTO lessons (created_at, based_on_trade_count, based_on_ids, lesson_text) VALUES (?, ?, ?, ?)`
  ).run(new Date().toISOString(), newLosses.length, basedOnIds, lessonText);

  console.log(`reflect: recorded new lesson from ${newLosses.length} losses:\n\n${lessonText}`);
}

run().catch((err) => {
  console.error("reflect failed:", err);
  process.exit(1);
});

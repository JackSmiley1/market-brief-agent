// Tests for src/config.js's computeNotional — the position-sizing formula
// that turns Claude's self-rated confidence/event-risk/direction into an
// actual dollar amount. This is the one place in the codebase where the
// evidence-based sizing story (see status-memo.md and the comments next to
// SIZING_ADJUSTMENTS) becomes real numbers, so it's the highest-value
// function in the repo to have covered — a silent regression here means
// every trade that night is sized wrong, not just one bad brief.
//
// Honest scope note: most of src/ is script-style (top-level side effects
// against the live db.js SQLite connection on import), which makes it hard
// to unit test without either refactoring those files or hitting a real
// database. This file deliberately covers computeNotional only, the one
// function already written as pure and already exported for exactly this
// reason. Extending coverage further means extracting more pure functions
// first (checkpoint.js and exportSite.js each have their own near-duplicate
// `summarize` helper that would be a reasonable next extraction), not
// bolting tests onto code that reaches out to a database as a side effect
// of being imported.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNotional, PAPER_TRADE_BASE_NOTIONAL, SIZING_ADJUSTMENTS } from "../src/config.js";

test("full size: medium/high confidence, no event risk, long", () => {
  const notional = computeNotional({ confidence: "medium", eventRisk: false, direction: "long" });
  assert.equal(notional, PAPER_TRADE_BASE_NOTIONAL);
});

test("high confidence gets no cut (only 'low' triggers the confidence adjustment)", () => {
  const notional = computeNotional({ confidence: "high", eventRisk: false, direction: "long" });
  assert.equal(notional, PAPER_TRADE_BASE_NOTIONAL);
});

test("low confidence alone applies the lowConfidence multiplier", () => {
  const notional = computeNotional({ confidence: "low", eventRisk: false, direction: "long" });
  assert.equal(notional, Math.round(PAPER_TRADE_BASE_NOTIONAL * SIZING_ADJUSTMENTS.lowConfidence));
});

test("event risk alone applies the eventRisk multiplier", () => {
  const notional = computeNotional({ confidence: "medium", eventRisk: true, direction: "long" });
  assert.equal(notional, Math.round(PAPER_TRADE_BASE_NOTIONAL * SIZING_ADJUSTMENTS.eventRisk));
});

test("short direction alone applies the shortDirection multiplier", () => {
  const notional = computeNotional({ confidence: "medium", eventRisk: false, direction: "short" });
  assert.equal(notional, Math.round(PAPER_TRADE_BASE_NOTIONAL * SIZING_ADJUSTMENTS.shortDirection));
});

test("cuts stack multiplicatively: low confidence + event risk + short", () => {
  const notional = computeNotional({ confidence: "low", eventRisk: true, direction: "short" });
  const expected = Math.round(
    PAPER_TRADE_BASE_NOTIONAL *
      SIZING_ADJUSTMENTS.lowConfidence *
      SIZING_ADJUSTMENTS.eventRisk *
      SIZING_ADJUSTMENTS.shortDirection
  );
  assert.equal(notional, expected);
  // Pinned against the exact worked example in config.js's own comment
  // (1000 * 0.5 * 0.5 * 0.5 = 125) so a change to any multiplier's default
  // is caught here as loudly as it would change that comment.
  assert.equal(notional, 125);
});

test("result is always a whole dollar amount (rounded, not fractional cents)", () => {
  const notional = computeNotional({ confidence: "low", eventRisk: true, direction: "short" });
  assert.equal(notional, Math.round(notional));
});

test("unrecognized/undefined inputs default to full size (fail open to the base rate, not zero)", () => {
  const notional = computeNotional({ confidence: undefined, eventRisk: undefined, direction: undefined });
  assert.equal(notional, PAPER_TRADE_BASE_NOTIONAL);
});

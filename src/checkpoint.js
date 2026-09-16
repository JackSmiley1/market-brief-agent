import "dotenv/config";
import fs from "fs";
import path from "path";
import { db } from "./db.js";
import { PAPER_TRADE_BASE_NOTIONAL, SIZING_ADJUSTMENTS } from "./config.js";

// ---- What this is ----
//
// computeAccuracy.js / computePnL.js / computeConfidence.js each answer one
// question in isolation and require a human to run all three, hold the
// numbers in their head, and decide whether config.js's SIZING_ADJUSTMENTS
// still match reality (that's what happened manually for the Sept 8-10
// checkpoint referenced in config.js's comments). This script is that same
// review, automated and run in one pass — across every sizing dimension at
// once, against a fixed, pre-declared sample-size floor, so "does the data
// support a change" stops being a judgment call made fresh each time.
//
// What this deliberately does NOT do: write to config.js. Every dimension
// below is a real behavioral lever (shorts get sized down, low confidence
// gets sized down, event risk gets sized down) and flipping one on a small,
// possibly-noisy sample is exactly how a self-tuning system convinces
// itself of a pattern that isn't real. This script's job is to make the
// evidence legible on a fixed schedule; a human still decides whether to
// act on it. MIN_N is the gate that keeps those from blurring together.
const MIN_N = 20;

function fmtPct(n, digits = 2) {
  return n === null || n === undefined || Number.isNaN(n) ? "n/a" : `${n.toFixed(digits)}%`;
}

function summarize(rows) {
  if (rows.length === 0) return null;
  const totalPnl = rows.reduce((s, r) => s + r.realized_pnl, 0);
  const totalNotional = rows.reduce((s, r) => s + r.notional, 0);
  const avgPnlPct = rows.reduce((s, r) => s + r.realized_pnl_pct, 0) / rows.length;
  const wins = rows.filter((r) => r.realized_pnl > 0).length;
  return { n: rows.length, totalPnl, totalNotional, avgPnlPct, wins, winRate: (wins / rows.length) * 100 };
}

function line(label, summary) {
  if (!summary) return `  ${label}: no closed trades yet`;
  const flag = summary.n < MIN_N ? "  [below MIN_N=" + MIN_N + " — directional only]" : "";
  return `  ${label}: n=${summary.n}, avg return ${fmtPct(summary.avgPnlPct)}, win rate ${fmtPct(summary.winRate, 0)}, $${summary.totalPnl.toFixed(2)} total P&L${flag}`;
}

// ---- Pull everything closed, joined against its self-rated confidence/event-risk ----

const closed = db
  .prepare(
    `SELECT p.date, p.ticker, p.direction, p.notional, p.realized_pnl, p.realized_pnl_pct,
            w.confidence, w.event_risk
     FROM paper_trades p
     LEFT JOIN watchlist_followups w ON p.date = w.date AND p.ticker = w.ticker
     WHERE p.status = 'closed'
     ORDER BY p.date`
  )
  .all();

const out = [];
const today = new Date().toISOString().slice(0, 10);
out.push(`# Checkpoint report — ${today}`);
out.push("");
out.push(`Closed paper trades analyzed: ${closed.length}`);
out.push("");

if (closed.length === 0) {
  out.push("No closed trades yet — nothing to check.");
} else {
  out.push("## Overall");
  out.push(line("all closed trades", summarize(closed)));
  out.push("");

  out.push("## By direction (current cut: shortDirection = " + SIZING_ADJUSTMENTS.shortDirection + ")");
  for (const dir of ["long", "short"]) {
    out.push(line(dir, summarize(closed.filter((r) => (r.direction ?? "long") === dir))));
  }
  out.push("");

  out.push("## By confidence (current cut: lowConfidence = " + SIZING_ADJUSTMENTS.lowConfidence + ")");
  for (const level of ["high", "medium", "low"]) {
    const subset = closed.filter((r) => r.confidence === level);
    if (subset.length === 0) continue;
    out.push(line(level, summarize(subset)));
  }
  const unrated = closed.filter((r) => !r.confidence).length;
  if (unrated > 0) out.push(`  (${unrated} closed trade(s) have no confidence rating — pre-dates that field, excluded above)`);
  out.push("");

  out.push("## By event risk (current cut: eventRisk = " + SIZING_ADJUSTMENTS.eventRisk + ")");
  out.push(line("event risk = true", summarize(closed.filter((r) => r.event_risk === 1))));
  out.push(line("event risk = false", summarize(closed.filter((r) => r.event_risk === 0))));
  const unflagged = closed.filter((r) => r.event_risk === null || r.event_risk === undefined).length;
  if (unflagged > 0) out.push(`  (${unflagged} closed trade(s) have no event-risk flag — pre-dates that field, excluded above)`);
  out.push("");

  out.push("## By ticker (n >= 3 only — anything below that is one or two trades, not a pattern)");
  const byTicker = {};
  for (const r of closed) (byTicker[r.ticker] ??= []).push(r);
  const tickerRows = Object.entries(byTicker)
    .map(([ticker, rows]) => ({ ticker, ...summarize(rows) }))
    .filter((t) => t.n >= 3)
    .sort((a, b) => a.avgPnlPct - b.avgPnlPct);
  if (tickerRows.length === 0) {
    out.push("  no ticker has 3+ closed trades yet");
  } else {
    for (const t of tickerRows) out.push(line(t.ticker, t));
  }
  out.push("");

  out.push("## Flags (only where both sides of a comparison clear n >= " + MIN_N + ")");
  const flags = [];
  const byConf = (level) => summarize(closed.filter((r) => r.confidence === level));
  const low = byConf("low"), med = byConf("medium"), high = byConf("high");
  if (low && med && low.n >= MIN_N && med.n >= MIN_N) {
    if (low.avgPnlPct >= med.avgPnlPct) {
      flags.push(
        `Low confidence (${fmtPct(low.avgPnlPct)}, n=${low.n}) is no longer underperforming medium (${fmtPct(med.avgPnlPct)}, n=${med.n}) — the lowConfidence=${SIZING_ADJUSTMENTS.lowConfidence} cut was justified by the Sept checkpoint's data; this is new evidence worth a human look, not an auto-change.`
      );
    }
  }
  const longS = summarize(closed.filter((r) => (r.direction ?? "long") === "long"));
  const shortS = summarize(closed.filter((r) => (r.direction ?? "long") === "short"));
  if (longS && shortS && longS.n >= MIN_N && shortS.n >= MIN_N) {
    if (shortS.avgPnlPct >= longS.avgPnlPct) {
      flags.push(
        `Shorts (${fmtPct(shortS.avgPnlPct)}, n=${shortS.n}) are no longer a net drag relative to longs (${fmtPct(longS.avgPnlPct)}, n=${longS.n}) — worth revisiting the shortDirection=${SIZING_ADJUSTMENTS.shortDirection} cut.`
      );
    }
  }
  const evT = summarize(closed.filter((r) => r.event_risk === 1));
  const evF = summarize(closed.filter((r) => r.event_risk === 0));
  if (evT && evF && evT.n >= MIN_N && evF.n >= MIN_N) {
    if (evT.avgPnlPct >= evF.avgPnlPct) {
      flags.push(
        `Event-risk trades (${fmtPct(evT.avgPnlPct)}, n=${evT.n}) are no longer worse than non-event trades (${fmtPct(evF.avgPnlPct)}, n=${evF.n}) — worth revisiting the eventRisk=${SIZING_ADJUSTMENTS.eventRisk} cut.`
      );
    }
  }
  if (flags.length === 0) {
    const gatedCount = [
      low && med ? [low.n, med.n] : null,
      longS && shortS ? [longS.n, shortS.n] : null,
      evT && evF ? [evT.n, evF.n] : null,
    ].filter(Boolean).filter(([a, b]) => a < MIN_N || b < MIN_N).length;
    out.push(`  none — ${gatedCount > 0 ? "most comparisons are still below the n>=" + MIN_N + " floor, so " : ""}nothing here clears the bar for a recommended config change yet.`);
  } else {
    for (const f of flags) out.push(`  - ${f}`);
  }
  out.push("");
  out.push(`(Base notional: $${PAPER_TRADE_BASE_NOTIONAL}. This report only flags candidates for review — it never edits config.js.)`);
}

const report = out.join("\n");
console.log(report);

const dir = path.resolve("logs/checkpoints");
fs.mkdirSync(dir, { recursive: true });
const outPath = path.join(dir, `${today}.md`);
fs.writeFileSync(outPath, report, "utf-8");
console.log(`\nSaved: logs/checkpoints/${today}.md`);

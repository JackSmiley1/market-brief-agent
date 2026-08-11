import "dotenv/config";
import { db } from "./db.js";

const rows = db
  .prepare(`SELECT date, ticker, outcome, result_pct_change FROM watchlist_followups WHERE outcome IS NOT NULL ORDER BY date`)
  .all();

const counts = { played_out: 0, partial: 0, missed: 0, unclear: 0 };
for (const row of rows) counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;

const resolved = counts.played_out + counts.partial + counts.missed; // excludes "unclear" — not a real verdict either way
const hitRate = resolved > 0 ? (counts.played_out / resolved) * 100 : null;

console.log(`Graded picks so far: ${rows.length} (from ${new Set(rows.map((r) => r.date)).size} distinct day(s))`);
console.log(`  played_out: ${counts.played_out}`);
console.log(`  partial:    ${counts.partial}`);
console.log(`  missed:     ${counts.missed}`);
console.log(`  unclear:    ${counts.unclear} (excluded from hit rate below — not a real verdict either way)`);

if (resolved === 0) {
  console.log("\nHit rate: not enough resolved data yet — too early to be meaningful.");
} else {
  console.log(`\nHit rate (played_out / resolved): ${hitRate.toFixed(1)}% (n=${resolved})`);
  if (resolved < 20) {
    console.log("Sample size is still small — treat this number as directional, not conclusive.");
  }
}

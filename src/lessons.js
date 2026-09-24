import "dotenv/config";
import { db } from "./db.js";

// Small management CLI for the `lessons` table (see reflect.js / db.js).
// reflect.js only ever INSERTs — nothing before this script could remove or
// inspect a lesson without opening the sqlite file directly. This closes
// that gap: list what's there, and delete a specific one by id if it turns
// out to be a bad or unfounded pattern.
//
// Usage:
//   node src/lessons.js list
//   node src/lessons.js delete <id>
//
// Deleting a lesson does NOT "un-reflect" the trades it was based on — its
// based_on_ids stay recorded on the deleted row's history only in the sense
// that they're gone once the row is gone. That means a future reflect.js
// run could, in principle, draw on those same losing trades again (they're
// no longer in any lesson's based_on_ids, so alreadyReflected won't exclude
// them). That's the right behavior here: if a lesson was wrong, the honest
// fix is to let it be reconsidered, not to permanently blacklist those
// trades from ever being reflected on again.

function list() {
  const rows = db
    .prepare(`SELECT id, created_at, based_on_trade_count, lesson_text FROM lessons ORDER BY id DESC`)
    .all();

  if (rows.length === 0) {
    console.log("No lessons recorded yet.");
    return;
  }

  for (const r of rows) {
    console.log(`\n[${r.id}] ${r.created_at} — based on ${r.based_on_trade_count} losing trade(s)`);
    console.log(r.lesson_text);
  }
  console.log(`\n${rows.length} lesson(s) total. Delete one with: node src/lessons.js delete <id>`);
}

function del(idArg) {
  const id = Number(idArg);
  if (!Number.isInteger(id)) {
    console.error(`Invalid id: "${idArg}" — run "node src/lessons.js list" to see valid ids.`);
    process.exit(1);
  }

  const existing = db.prepare(`SELECT id, lesson_text FROM lessons WHERE id = ?`).get(id);
  if (!existing) {
    console.error(`No lesson with id ${id} — run "node src/lessons.js list" to see valid ids.`);
    process.exit(1);
  }

  db.prepare(`DELETE FROM lessons WHERE id = ?`).run(id);
  console.log(`Deleted lesson [${id}]:\n${existing.lesson_text}`);
  console.log(`\nThe nightly brief will no longer see this lesson. Its underlying losing trades are eligible to be reflected on again in a future run.`);
}

const [, , command, arg] = process.argv;

if (command === "list") {
  list();
} else if (command === "delete") {
  del(arg);
} else {
  console.error('Usage:\n  node src/lessons.js list\n  node src/lessons.js delete <id>');
  process.exit(1);
}

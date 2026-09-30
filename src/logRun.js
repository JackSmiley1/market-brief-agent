import { db } from "./db.js";

// Records this workflow run's step outcomes (see db.js's pipeline_runs).
// Reads GitHub's own `toJSON(steps)` from the STEPS_JSON env var, so a
// step that failed but was allowed to continue (continue-on-error) still
// counts as not clean: we read each step's `outcome`, not `conclusion`.
// Never fails the workflow: a logging problem must not block the export.
//
// Usage (in a workflow step with `if: always()`):
//   env: { STEPS_JSON: ${{ toJSON(steps) }}, RUN_ID: ${{ github.run_id }}, RUN_EVENT: ${{ github.event_name }} }
//   run: node src/logRun.js nightly

try {
  const workflow = process.argv[2] || "unknown";
  const steps = JSON.parse(process.env.STEPS_JSON || "{}");
  const outcomes = Object.fromEntries(Object.entries(steps).map(([id, s]) => [id, s?.outcome ?? "unknown"]));
  const clean = Object.keys(outcomes).length > 0 && Object.values(outcomes).every((o) => o === "success");
  db.prepare(`INSERT INTO pipeline_runs (run_at, workflow, run_id, event, clean, steps_json) VALUES (?, ?, ?, ?, ?, ?)`).run(
    new Date().toISOString(), workflow, process.env.RUN_ID ?? null, process.env.RUN_EVENT ?? null, clean ? 1 : 0, JSON.stringify(outcomes)
  );
  console.log(`logRun: ${workflow} run recorded as ${clean ? "CLEAN" : "NOT clean"} ${JSON.stringify(outcomes)}`);
} catch (err) {
  console.error("logRun failed (non-fatal):", err.message);
}

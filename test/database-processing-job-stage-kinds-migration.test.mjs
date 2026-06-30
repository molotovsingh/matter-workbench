import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/025_processing_job_stage_kinds.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

test("twenty-fifth database migration admits backend preparation stage jobs", () => {
  const sql = readMigration();

  assert.match(sql, /drop constraint if exists processing_jobs_kind_check/i);
  assert.match(sql, /add constraint processing_jobs_kind_check/i);
  for (const kind of [
    "matter_init",
    "source_labels",
    "case_timeline",
    "matter_story",
    "posture_diagnosis",
    "preparation_run",
    "skill_sample_output",
  ]) {
    assert.match(sql, new RegExp(`'${kind}'`, "i"), `migration must allow ${kind} jobs`);
  }
});

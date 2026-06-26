import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../db/migrations/022_matter_artifact_currentness.sql", import.meta.url);

test("artifact currentness migration adds source-backed projection without deletion behavior", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /create table if not exists matter_artifact_currentness/i);
  assert.match(sql, /artifact_family text not null check/i);
  assert.match(sql, /source_index/);
  assert.match(sql, /list_of_dates/);
  assert.match(sql, /matter_story/);
  assert.match(sql, /custom_skill_output/);
  assert.match(sql, /chronology_regeneration_needed/);
  assert.match(sql, /source_set_review_needed/);
  assert.match(sql, /affected_file_ids_json jsonb not null default '\[\]'::jsonb/i);
  assert.match(sql, /unique \(tenant_id, matter_id, artifact_family, artifact_path\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /matter_artifact_currentness_tenant_isolation/i);
  assert.match(sql, /matter_artifact_currentness_source_event_tenant_fk/i);
  assert.doesNotMatch(sql, /delete\s+from\s+documents/i);
  assert.doesNotMatch(sql, /delete\s+from\s+storage_objects/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
});

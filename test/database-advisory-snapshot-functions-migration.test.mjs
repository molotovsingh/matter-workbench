import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/010_advisory_snapshot_functions.sql", import.meta.url);

function readMigration() {
  assert.ok(existsSync(migrationPath), "missing 010 advisory snapshot functions migration");
  return readFileSync(migrationPath, "utf8");
}

test("tenth database migration adds an append-only advisory snapshot helper", () => {
  const sql = readMigration();

  assert.match(sql, /create index if not exists preparation_advisory_snapshots_matter_created_idx/i);
  assert.match(sql, /on preparation_advisory_snapshots\s*\(tenant_id, matter_id, created_at desc\)/i);
  assert.match(sql, /create or replace function create_preparation_advisory_snapshot\(/i);
  assert.match(sql, /p_matter_id uuid/i);
  assert.match(sql, /p_preparation_run_id uuid default null/i);
  assert.match(sql, /p_generated_by_job_id uuid default null/i);
  assert.match(sql, /p_rendered_summary_json jsonb default '\{\}'::jsonb/i);
  assert.match(sql, /returns uuid/i);
});

test("advisory snapshot helper derives counts and ids from canonical evidence", () => {
  const sql = readMigration();

  assert.match(sql, /from incidents i[\s\S]*where i\.tenant_id = current_app_tenant_id\(\)[\s\S]*i\.matter_id = p_matter_id[\s\S]*i\.status = 'open'/i);
  assert.match(sql, /filter \(where severity = 'blocker'\)/i);
  assert.match(sql, /filter \(where severity = 'warning'\)/i);
  assert.match(sql, /filter \(where severity = 'info'\)/i);
  assert.match(sql, /array_agg\(id order by case severity[\s\S]*created_at desc\)/i);
  assert.match(sql, /from artifact_validation_results avr[\s\S]*where avr\.tenant_id = current_app_tenant_id\(\)[\s\S]*avr\.matter_id = p_matter_id[\s\S]*avr\.status in \('warning', 'failed'\)/i);
  assert.match(sql, /insert into preparation_advisory_snapshots/i);
  assert.match(sql, /tenant_id,\s*matter_id,\s*preparation_run_id,\s*generated_by_job_id,\s*blocker_count,\s*warning_count,\s*info_count,\s*incident_ids,\s*artifact_validation_result_ids,\s*rendered_summary_json,\s*app_version,\s*policy_versions_json/i);
  assert.match(sql, /current_app_tenant_id\(\)/i);
});

test("advisory snapshot helper fails closed for cross-tenant or missing matter", () => {
  const sql = readMigration();

  assert.match(sql, /if not exists \([\s\S]*from matters m[\s\S]*m\.id = p_matter_id[\s\S]*m\.tenant_id = current_app_tenant_id\(\)[\s\S]*\) then/i);
  assert.match(sql, /raise exception 'matter not found for current tenant'/i);
});

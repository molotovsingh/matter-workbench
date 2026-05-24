import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/009_incident_helper_functions.sql", import.meta.url);

function readMigration() {
  assert.ok(existsSync(migrationPath), "missing 009 incident helper functions migration");
  return readFileSync(migrationPath, "utf8");
}

test("ninth database migration adds canonical incident helper functions", () => {
  const sql = readMigration();

  assert.match(sql, /create unique index if not exists incidents_open_source_code_unique/i);
  assert.match(sql, /on incidents\s*\(tenant_id, source_type, source_id, code\)[\s\S]*where status = 'open'/i);
  assert.match(sql, /create or replace function upsert_incident\(/i);
  assert.match(sql, /p_source_type text/i);
  assert.match(sql, /p_category text/i);
  assert.match(sql, /p_severity text default 'warning'/i);
  assert.match(sql, /tenant_id,\s*matter_id,\s*source_type,\s*source_id,\s*category,\s*severity,\s*status,\s*code,\s*title,\s*detail,\s*evidence_ref/i);
  assert.match(sql, /current_app_tenant_id\(\)/i);
  assert.match(sql, /on conflict \(tenant_id, source_type, source_id, code\)\s+where status = 'open'/i);
  assert.match(sql, /do update set[\s\S]*severity = excluded\.severity[\s\S]*detail = excluded\.detail[\s\S]*evidence_ref = excluded\.evidence_ref/i);
});

test("ninth database migration records job, provider-run, and artifact-validation incidents tenant-locally", () => {
  const sql = readMigration();

  assert.match(sql, /create or replace function record_job_failure_incident\(/i);
  assert.match(sql, /from processing_jobs j[\s\S]*where j\.id = p_job_id[\s\S]*j\.tenant_id = current_app_tenant_id\(\)/i);
  assert.match(sql, /return upsert_incident\([\s\S]*p_source_type => 'job'[\s\S]*p_category => coalesce\(p_category, case job_row\.kind/i);
  assert.match(sql, /when 'extract' then 'extraction'[\s\S]*when 'list_of_dates' then 'chronology'[\s\S]*else 'system'/i);

  assert.match(sql, /create or replace function record_provider_run_failure_incident\(/i);
  assert.match(sql, /from provider_runs pr[\s\S]*where pr\.id = p_provider_run_id[\s\S]*pr\.tenant_id = current_app_tenant_id\(\)/i);
  assert.match(sql, /return upsert_incident\([\s\S]*p_source_type => 'provider_run'[\s\S]*p_category => coalesce\(p_category, 'provider'\)/i);

  assert.match(sql, /create or replace function record_artifact_validation_incident\(/i);
  assert.match(sql, /from artifact_validation_results avr[\s\S]*where avr\.id = p_validation_result_id[\s\S]*avr\.tenant_id = current_app_tenant_id\(\)/i);
  assert.match(sql, /return upsert_incident\([\s\S]*p_source_type => 'artifact_validation'[\s\S]*p_category => coalesce\(p_category, 'artifact'\)/i);
});

test("ninth database migration resolves incidents without crossing tenants", () => {
  const sql = readMigration();

  assert.match(sql, /create or replace function resolve_incident\(/i);
  assert.match(sql, /set status = 'resolved'[\s\S]*resolved_at = now\(\)/i);
  assert.match(sql, /where id = p_incident_id[\s\S]*tenant_id = current_app_tenant_id\(\)[\s\S]*status = 'open'/i);
  assert.match(sql, /get diagnostics updated_count = row_count/i);
});

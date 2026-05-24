import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/008_job_worker_functions.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

test("eighth database migration adds atomic processing job claim and heartbeat functions", () => {
  const sql = readMigration();

  assert.match(sql, /create or replace function claim_next_processing_job\(/i);
  assert.match(sql, /returns table[\s\S]*job_id uuid[\s\S]*job_kind text[\s\S]*attempt_count integer/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /where j\.tenant_id = current_app_tenant_id\(\)/i);
  assert.match(sql, /j\.status in \('queued', 'retrying'\)/i);
  assert.match(sql, /j\.attempt_count < j\.max_attempts/i);
  assert.match(sql, /set[\s\S]*status = 'running'[\s\S]*locked_by = p_worker_id[\s\S]*attempt_count = j\.attempt_count \+ 1/i);
  assert.match(sql, /create or replace function heartbeat_processing_job\(/i);
  assert.match(sql, /where id = p_job_id[\s\S]*tenant_id = current_app_tenant_id\(\)[\s\S]*status = 'running'[\s\S]*locked_by = p_worker_id/i);
  assert.match(sql, /last_heartbeat_at = now\(\)/i);
  assert.match(sql, /lock_expires_at = now\(\) \+ make_interval\(secs => greatest\(p_lease_seconds, 30\)\)/i);
});

test("eighth database migration adds processing job completion with retry semantics", () => {
  const sql = readMigration();

  assert.match(sql, /create or replace function complete_processing_job\(/i);
  assert.match(sql, /returns boolean/i);
  assert.match(sql, /case[\s\S]*when p_succeeded then 'succeeded'[\s\S]*when attempt_count < max_attempts then 'retrying'[\s\S]*else 'failed'/i);
  assert.match(sql, /run_after = case[\s\S]*when p_succeeded then run_after[\s\S]*when attempt_count < max_attempts then now\(\) \+ make_interval\(secs => greatest\(coalesce\(p_retry_after_seconds, 60\), 1\)\)/i);
  assert.match(sql, /finished_at = case[\s\S]*when p_succeeded then now\(\)[\s\S]*when attempt_count >= max_attempts then now\(\)[\s\S]*else null/i);
  assert.match(sql, /locked_by = null[\s\S]*locked_at = null[\s\S]*lock_expires_at = null/i);
});

test("eighth database migration adds atomic outbox claim and completion functions", () => {
  const sql = readMigration();

  assert.match(sql, /create or replace function claim_next_job_outbox_event\(/i);
  assert.match(sql, /returns table[\s\S]*outbox_id uuid[\s\S]*job_id uuid[\s\S]*event_type text[\s\S]*event_key text/i);
  assert.match(sql, /where o\.tenant_id = current_app_tenant_id\(\)/i);
  assert.match(sql, /o\.status = 'pending'/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /set[\s\S]*status = 'claimed'[\s\S]*claimed_by = p_worker_id[\s\S]*attempt_count = o\.attempt_count \+ 1/i);
  assert.match(sql, /create or replace function complete_job_outbox_event\(/i);
  assert.match(sql, /case[\s\S]*when p_published then 'published'[\s\S]*when attempt_count < max_attempts then 'pending'[\s\S]*else 'failed'/i);
  assert.match(sql, /where id = p_outbox_id[\s\S]*tenant_id = current_app_tenant_id\(\)[\s\S]*status = 'claimed'[\s\S]*claimed_by = p_worker_id/i);
});

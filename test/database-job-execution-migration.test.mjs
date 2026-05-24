import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/006_job_execution_leases.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

test("sixth database migration adds worker lease and retry fields to processing jobs", () => {
  const sql = readMigration();

  for (const column of [
    "priority integer not null default 0",
    "attempt_count integer not null default 0",
    "max_attempts integer not null default 3",
    "run_after timestamptz not null default now()",
    "locked_by text",
    "locked_at timestamptz",
    "lock_expires_at timestamptz",
    "last_heartbeat_at timestamptz",
    "progress_json jsonb not null default '{}'::jsonb",
    "updated_at timestamptz not null default now()",
  ]) {
    assert.match(
      sql,
      new RegExp(`alter table processing_jobs[\\s\\S]*add column if not exists ${column.replace(/[(){}]/g, "\\$&")}`, "i"),
      `processing_jobs must add ${column}`,
    );
  }

  assert.match(sql, /alter table processing_jobs[\s\S]*add constraint processing_jobs_attempt_count_nonnegative[\s\S]*check \(attempt_count >= 0\)/i);
  assert.match(sql, /alter table processing_jobs[\s\S]*add constraint processing_jobs_max_attempts_positive[\s\S]*check \(max_attempts > 0\)/i);
  assert.match(sql, /create index if not exists processing_jobs_claimable_idx[\s\S]*on processing_jobs \(tenant_id, status, run_after, priority desc, created_at\)[\s\S]*where status in \('queued', 'retrying'\)/i);
  assert.match(sql, /create index if not exists processing_jobs_expired_lock_idx[\s\S]*on processing_jobs \(tenant_id, lock_expires_at\)[\s\S]*where status = 'running' and lock_expires_at is not null/i);
  assert.match(sql, /create trigger processing_jobs_set_updated_at[\s\S]*before update on processing_jobs[\s\S]*execute function set_updated_at\(\)/i);
});

test("sixth database migration adds outbox event keys and claim metadata", () => {
  const sql = readMigration();

  for (const column of [
    "event_key text not null default 'default'",
    "attempt_count integer not null default 0",
    "max_attempts integer not null default 3",
    "claimed_by text",
    "claimed_at timestamptz",
    "claim_expires_at timestamptz",
    "last_error_code text",
    "last_error_message text",
    "updated_at timestamptz not null default now()",
  ]) {
    assert.match(
      sql,
      new RegExp(`alter table job_outbox[\\s\\S]*add column if not exists ${column.replace(/[(){}]/g, "\\$&")}`, "i"),
      `job_outbox must add ${column}`,
    );
  }

  assert.match(sql, /drop constraint if exists job_outbox_tenant_id_job_id_event_type_key/i);
  assert.match(sql, /add constraint job_outbox_tenant_job_event_key_unique[\s\S]*unique \(tenant_id, job_id, event_type, event_key\)/i);
  assert.match(sql, /alter table job_outbox[\s\S]*add constraint job_outbox_attempt_count_nonnegative[\s\S]*check \(attempt_count >= 0\)/i);
  assert.match(sql, /alter table job_outbox[\s\S]*add constraint job_outbox_max_attempts_positive[\s\S]*check \(max_attempts > 0\)/i);
  assert.match(sql, /create index if not exists job_outbox_claimable_idx[\s\S]*on job_outbox \(tenant_id, status, created_at\)[\s\S]*where status = 'pending'/i);
  assert.match(sql, /create index if not exists job_outbox_expired_claim_idx[\s\S]*on job_outbox \(tenant_id, claim_expires_at\)[\s\S]*where status = 'claimed' and claim_expires_at is not null/i);
  assert.match(sql, /create trigger job_outbox_set_updated_at[\s\S]*before update on job_outbox[\s\S]*execute function set_updated_at\(\)/i);
});

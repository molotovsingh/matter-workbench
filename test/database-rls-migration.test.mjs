import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/002_tenant_rls.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

test("second database migration creates tenant context helpers", () => {
  const sql = readMigration();

  assert.match(sql, /create or replace function current_app_tenant_id\(\)/i);
  assert.match(sql, /current_setting\('app\.tenant_id', true\)/i);
  assert.match(sql, /nullif\(.*''\)::uuid/is);
});

test("tenant-scoped tables enable row-level security and tenant isolation policies", () => {
  const sql = readMigration();
  const tenantScopedTables = [
    "tenants",
    "tenant_memberships",
    "matters",
    "matter_memberships",
    "matter_intakes",
    "upload_sessions",
    "documents",
    "document_blobs",
    "extraction_records",
    "document_text_blocks",
    "source_descriptors",
    "processing_jobs",
    "job_outbox",
    "provider_runs",
    "matter_artifacts",
    "artifact_validation_results",
    "incidents",
    "attention_acknowledgements",
    "preparation_advisory_snapshots",
    "cost_events",
    "audit_events",
    "skill_ideas",
    "skill_samples",
    "configurable_skills",
    "configurable_skill_versions",
    "configurable_skill_runs",
  ];

  for (const tableName of tenantScopedTables) {
    assert.match(sql, new RegExp(`alter table ${tableName}\\s+enable row level security`, "i"), tableName);
    assert.match(sql, new RegExp(`alter table ${tableName}\\s+force row level security`, "i"), tableName);
    assert.match(sql, new RegExp(`drop policy if exists ${tableName}_tenant_isolation on ${tableName}`, "i"), tableName);
    assert.match(sql, new RegExp(`create policy ${tableName}_tenant_isolation[\\s\\S]*on ${tableName}`, "i"), tableName);
  }

  assert.match(sql, /on tenants[\s\S]*using \(id = current_app_tenant_id\(\)\)/i);
  assert.match(sql, /with check \(id = current_app_tenant_id\(\)\)/i);
  assert.match(sql, /using \(tenant_id = current_app_tenant_id\(\)\)/i);
  assert.match(sql, /with check \(tenant_id = current_app_tenant_id\(\)\)/i);
});

test("global users table is not accidentally exposed through tenant RLS assumptions", () => {
  const sql = readMigration();

  assert.doesNotMatch(sql, /alter table users\s+enable row level security/i);
});

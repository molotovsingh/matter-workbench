import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/001_control_plane.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

function tableBlock(sql, tableName) {
  const match = sql.match(new RegExp(`create table if not exists ${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"));
  assert.ok(match, `missing table ${tableName}`);
  return match[1];
}

test("first database migration defines the hosted control-plane tables", () => {
  const sql = readMigration();
  const expectedTables = [
    "tenants",
    "users",
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

  for (const tableName of expectedTables) {
    assert.match(sql, new RegExp(`create table if not exists ${tableName}\\b`, "i"), tableName);
  }
});

test("tenant-scoped legal data tables carry tenant_id directly", () => {
  const sql = readMigration();
  const tenantScopedTables = [
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
    assert.match(tableBlock(sql, tableName), /\btenant_id uuid\b/i, `${tableName} must carry tenant_id`);
  }
});

test("migration keeps files and legal artifacts out of inline database blobs", () => {
  const sql = readMigration();

  assert.doesNotMatch(sql, /\bbytea\b/i);
  assert.match(tableBlock(sql, "document_blobs"), /\bobject_key text not null\b/i);
  assert.match(tableBlock(sql, "matter_artifacts"), /\bobject_key text\b/i);
  assert.match(tableBlock(sql, "extraction_records"), /\bpayload_object_key text\b/i);
  assert.match(tableBlock(sql, "document_text_blocks"), /\btext_object_key text\b/i);
});

test("document identity and upload lifecycle are concurrency-safe", () => {
  const sql = readMigration();

  assert.match(sql, /unique\s*\(\s*matter_id\s*,\s*file_number\s*\)/i);
  assert.match(sql, /unique\s*\(\s*matter_id\s*,\s*file_id\s*\)/i);
  assert.match(sql, /unique\s*\(\s*tenant_id\s*,\s*idempotency_key\s*\)/i);
  assert.match(sql, /create or replace function allocate_matter_file_number/i);
  assert.match(sql, /for update/i);
});

test("jobs, provider runs, costs, incidents, and advisory history are explicit ledgers", () => {
  const sql = readMigration();

  assert.match(tableBlock(sql, "processing_jobs"), /\bstatus text not null\b/i);
  assert.match(sql, /unique\s*\(\s*tenant_id\s*,\s*idempotency_key\s*\)/i);
  assert.match(tableBlock(sql, "job_outbox"), /\bpayload_json jsonb not null\b/i);
  assert.match(sql, /unique\s*\(\s*tenant_id\s*,\s*job_id\s*,\s*event_type\s*\)/i);
  assert.match(tableBlock(sql, "provider_runs"), /\btask_class text not null\b/i);
  assert.match(tableBlock(sql, "provider_runs"), /\binput_tokens integer\b/i);
  assert.match(tableBlock(sql, "provider_runs"), /\boutput_tokens integer\b/i);
  assert.match(tableBlock(sql, "provider_runs"), /\bcost_amount numeric\b/i);
  assert.match(tableBlock(sql, "cost_events"), /\bapproval_event_id uuid\b/i);
  assert.match(tableBlock(sql, "incidents"), /\bsource_type text not null\b/i);
  assert.match(tableBlock(sql, "preparation_advisory_snapshots"), /\brendered_summary_json jsonb not null\b/i);
});

test("current artifacts are scoped by family, mode, profile, and format", () => {
  const sql = readMigration();

  assert.match(tableBlock(sql, "matter_artifacts"), /\bprofile_key text not null default 'default'/i);
  assert.match(sql, /create unique index if not exists matter_artifacts_one_current_per_scope/i);
  assert.match(sql, /\(matter_id,\s*artifact_family,\s*mode,\s*profile_key,\s*format\)\s*where is_current = true/i);
});

test("skill factory ideas and samples are durable without inline work-product bodies", () => {
  const sql = readMigration();

  assert.match(tableBlock(sql, "skill_ideas"), /\bdesign_brief_json jsonb not null\b/i);
  assert.match(tableBlock(sql, "skill_ideas"), /\breadiness_json jsonb not null\b/i);
  assert.match(tableBlock(sql, "skill_ideas"), /\bstatus text not null\b/i);
  assert.match(tableBlock(sql, "skill_samples"), /\bidea_id text not null references skill_ideas\(id\)/i);
  assert.match(tableBlock(sql, "skill_samples"), /\bsample_markdown_object_key text\b/i);
  assert.match(tableBlock(sql, "skill_samples"), /\bdesign_brief_hash text not null\b/i);
  assert.match(tableBlock(sql, "skill_samples"), /\bai_run_id uuid references provider_runs\(id\)/i);
  assert.doesNotMatch(tableBlock(sql, "skill_samples"), /\bsample_markdown text\b/i);
  assert.match(sql, /unique\s*\(\s*idea_id\s*,\s*version\s*\)/i);
  assert.match(sql, /create unique index if not exists skill_samples_one_approved_per_idea/i);
});

test("mutable control-plane tables refresh updated_at through one trigger helper", () => {
  const sql = readMigration();
  const mutableTables = [
    "tenants",
    "users",
    "tenant_memberships",
    "matters",
    "matter_memberships",
    "documents",
    "source_descriptors",
    "skill_ideas",
    "skill_samples",
    "configurable_skills",
  ];

  assert.match(sql, /create or replace function set_updated_at\(\)/i);
  assert.match(sql, /new\.updated_at = now\(\);/i);

  for (const tableName of mutableTables) {
    assert.match(
      sql,
      new RegExp(`create trigger ${tableName}_set_updated_at[\\s\\S]*before update on ${tableName}[\\s\\S]*execute function set_updated_at\\(\\);`, "i"),
      tableName,
    );
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/005_storage_object_lifecycle.sql", import.meta.url);
const sourceDescriptorStorageMigrationPath = new URL("../db/migrations/016_source_descriptors_storage_object_link.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

function tableBlock(sql, tableName) {
  const match = sql.match(new RegExp(`create table if not exists ${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"));
  assert.ok(match, `missing table ${tableName}`);
  return match[1];
}

test("fifth database migration adds a tenant-scoped storage object lifecycle ledger", () => {
  const sql = readMigration();
  const block = tableBlock(sql, "storage_objects");

  assert.match(block, /\btenant_id uuid not null references tenants\(id\)/i);
  assert.match(block, /\bmatter_id uuid references matters\(id\)/i);
  assert.match(block, /\bobject_key text not null\b/i);
  assert.match(block, /\bstorage_provider text not null default 'unconfigured'/i);
  assert.match(block, /\bobject_role text not null\b/i);
  assert.match(block, /check \(object_role in \('source_original', 'source_working_copy', 'extraction_payload', 'text_block_payload', 'matter_artifact', 'skill_sample', 'export', 'temporary', 'other'\)\)/i);
  assert.match(block, /\bstate text not null default 'pending'/i);
  assert.match(block, /check \(state in \('pending', 'uploading', 'uploaded', 'verified', 'failed', 'orphaned', 'deleted_pending', 'deleted'\)\)/i);
  assert.match(block, /\bsha256 text\b/i);
  assert.match(block, /\bsize_bytes bigint\b/i);
  assert.match(block, /\bidempotency_key text\b/i);
  assert.match(block, /\bcreated_by_job_id uuid references processing_jobs\(id\)/i);
  assert.match(sql, /unique \(tenant_id, object_key\)/i);
});

test("fifth database migration makes storage objects RLS-protected and tenant-linked", () => {
  const sql = readMigration();

  assert.match(sql, /alter table storage_objects\s+enable row level security/i);
  assert.match(sql, /alter table storage_objects\s+force row level security/i);
  assert.match(sql, /create policy storage_objects_tenant_isolation[\s\S]*using \(tenant_id = current_app_tenant_id\(\)\)/i);
  assert.match(sql, /create unique index if not exists storage_objects_id_tenant_id_unique\s+on storage_objects\s*\(id, tenant_id\)/i);
  assert.match(sql, /constraint storage_objects_matter_tenant_fk[\s\S]*foreign key \(matter_id, tenant_id\)[\s\S]*references matters \(id, tenant_id\)/i);
  assert.match(sql, /constraint storage_objects_job_tenant_fk[\s\S]*foreign key \(created_by_job_id, tenant_id\)[\s\S]*references processing_jobs \(id, tenant_id\)/i);
});

test("fifth database migration links existing object-key owners to the storage ledger", () => {
  const sql = readMigration();
  const linkedTables = [
    ["document_blobs", "document_blobs_storage_object_tenant_fk"],
    ["extraction_records", "extraction_records_storage_object_tenant_fk"],
    ["document_text_blocks", "document_text_blocks_storage_object_tenant_fk"],
    ["matter_artifacts", "matter_artifacts_storage_object_tenant_fk"],
    ["skill_samples", "skill_samples_storage_object_tenant_fk"],
  ];

  for (const [tableName, constraintName] of linkedTables) {
    assert.match(
      sql,
      new RegExp(`alter table ${tableName}\\s+add column if not exists storage_object_id uuid`, "i"),
      `${tableName} must gain storage_object_id`,
    );
    assert.match(
      sql,
      new RegExp(`constraint ${constraintName}[\\s\\S]*foreign key \\(storage_object_id, tenant_id\\)[\\s\\S]*references storage_objects \\(id, tenant_id\\)`, "i"),
      `${tableName} storage_object_id must stay tenant-local`,
    );
  }
});

test("sixteenth database migration links source descriptors to storage custody", () => {
  const sql = readFileSync(sourceDescriptorStorageMigrationPath, "utf8");

  assert.match(sql, /alter table source_descriptors\s+add column if not exists storage_object_id uuid/i);
  assert.match(
    sql,
    /constraint source_descriptors_storage_object_tenant_fk[\s\S]*foreign key \(storage_object_id, tenant_id\)[\s\S]*references storage_objects \(id, tenant_id\)/i,
  );
});

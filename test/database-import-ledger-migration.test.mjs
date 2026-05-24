import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/007_local_matter_import_ledger.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

function tableBlock(sql, tableName) {
  const match = sql.match(new RegExp(`create table if not exists ${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"));
  assert.ok(match, `missing table ${tableName}`);
  return match[1];
}

test("seventh database migration adds a tenant-scoped local matter import batch ledger", () => {
  const sql = readMigration();
  const block = tableBlock(sql, "matter_import_batches");

  assert.match(block, /\btenant_id uuid not null references tenants\(id\)/i);
  assert.match(block, /\bmatter_id uuid not null references matters\(id\)/i);
  assert.match(block, /\bcreated_by_user_id uuid references users\(id\)/i);
  assert.match(block, /\bsource_kind text not null default 'local_folder'/i);
  assert.match(block, /check \(source_kind in \('local_folder', 'zip_upload', 'object_storage', 'other'\)\)/i);
  assert.match(block, /\bsource_label text not null\b/i);
  assert.match(block, /\bsource_root_hint text\b/i);
  assert.match(block, /\bmanifest_storage_object_id uuid\b/i);
  assert.match(block, /\bcollision_policy text not null default 'fail_closed'/i);
  assert.match(block, /check \(collision_policy in \('fail_closed', 'skip_duplicates', 'review_required'\)\)/i);
  assert.match(block, /\bstatus text not null default 'planned'/i);
  assert.match(block, /check \(status in \('planned', 'running', 'succeeded', 'partial_failed', 'failed', 'cancelled'\)\)/i);
  assert.match(block, /\bidempotency_key text not null\b/i);
  assert.match(block, /\bfiles_expected integer not null default 0\b/i);
  assert.match(block, /\bfiles_imported integer not null default 0\b/i);
  assert.match(block, /unique \(tenant_id, idempotency_key\)/i);
});

test("seventh database migration adds per-file import items without renumbering source identity", () => {
  const sql = readMigration();
  const block = tableBlock(sql, "matter_import_items");

  assert.match(block, /\btenant_id uuid not null references tenants\(id\)/i);
  assert.match(block, /\bimport_batch_id uuid not null references matter_import_batches\(id\)/i);
  assert.match(block, /\bmatter_id uuid not null references matters\(id\)/i);
  assert.match(block, /\bdocument_id uuid references documents\(id\)/i);
  assert.match(block, /\bstorage_object_id uuid references storage_objects\(id\)/i);
  assert.match(block, /\boriginal_file_id text\b/i);
  assert.match(block, /\boriginal_relative_path text not null\b/i);
  assert.match(block, /\bsource_sha256 text\b/i);
  assert.match(block, /\btarget_file_number integer\b/i);
  assert.match(block, /\btarget_file_id text\b/i);
  assert.match(block, /\bstatus text not null default 'planned'/i);
  assert.match(block, /check \(status in \('planned', 'imported', 'skipped_duplicate', 'skipped_unsupported', 'failed', 'requires_review'\)\)/i);
  assert.match(block, /unique \(tenant_id, import_batch_id, original_relative_path\)/i);
});

test("seventh database migration protects import ledgers with RLS and tenant-local references", () => {
  const sql = readMigration();

  for (const tableName of ["matter_import_batches", "matter_import_items"]) {
    assert.match(sql, new RegExp(`alter table ${tableName}\\s+enable row level security`, "i"));
    assert.match(sql, new RegExp(`alter table ${tableName}\\s+force row level security`, "i"));
    assert.match(sql, new RegExp(`create policy ${tableName}_tenant_isolation[\\s\\S]*using \\(tenant_id = current_app_tenant_id\\(\\)\\)`, "i"));
    assert.match(sql, new RegExp(`create trigger ${tableName}_set_updated_at[\\s\\S]*before update on ${tableName}[\\s\\S]*execute function set_updated_at\\(\\)`, "i"));
  }

  assert.match(sql, /create unique index if not exists matter_import_batches_id_tenant_id_unique\s+on matter_import_batches\s*\(id, tenant_id\)/i);
  assert.match(sql, /constraint matter_import_batches_matter_tenant_fk[\s\S]*foreign key \(matter_id, tenant_id\)[\s\S]*references matters \(id, tenant_id\)/i);
  assert.match(sql, /constraint matter_import_batches_created_by_tenant_member_fk[\s\S]*foreign key \(tenant_id, created_by_user_id\)[\s\S]*references tenant_memberships \(tenant_id, user_id\)/i);
  assert.match(sql, /constraint matter_import_batches_manifest_storage_object_tenant_fk[\s\S]*foreign key \(manifest_storage_object_id, tenant_id\)[\s\S]*references storage_objects \(id, tenant_id\)/i);
  assert.match(sql, /constraint matter_import_items_batch_tenant_fk[\s\S]*foreign key \(import_batch_id, tenant_id\)[\s\S]*references matter_import_batches \(id, tenant_id\)/i);
  assert.match(sql, /constraint matter_import_items_document_tenant_fk[\s\S]*foreign key \(document_id, tenant_id\)[\s\S]*references documents \(id, tenant_id\)/i);
  assert.match(sql, /constraint matter_import_items_storage_object_tenant_fk[\s\S]*foreign key \(storage_object_id, tenant_id\)[\s\S]*references storage_objects \(id, tenant_id\)/i);
});

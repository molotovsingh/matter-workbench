import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/015_storage_object_payloads.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

function tableBlock(sql, tableName) {
  const match = sql.match(new RegExp(`create table if not exists ${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"));
  assert.ok(match, `missing table ${tableName}`);
  return match[1];
}

test("fifteenth migration adds tenant-scoped storage payload custody", () => {
  const sql = readMigration();
  const block = tableBlock(sql, "storage_object_payloads");

  assert.match(block, /\btenant_id uuid not null references tenants\(id\)/i);
  assert.match(block, /\bstorage_object_id uuid not null\b/i);
  assert.match(block, /\bmatter_id uuid references matters\(id\)/i);
  assert.match(block, /\bpayload bytea not null\b/i);
  assert.match(block, /\bsha256 text not null\b/i);
  assert.match(block, /\bsize_bytes bigint not null\b/i);
  assert.match(block, /check \(size_bytes >= 0\)/i);
  assert.match(block, /check \(octet_length\(payload\) = size_bytes\)/i);
  assert.match(sql, /unique \(tenant_id, storage_object_id\)/i);
});

test("fifteenth migration keeps payload rows tenant-linked and RLS protected", () => {
  const sql = readMigration();

  assert.match(sql, /create unique index if not exists storage_object_payloads_id_tenant_id_unique\s+on storage_object_payloads\s*\(id, tenant_id\)/i);
  assert.match(sql, /constraint storage_object_payloads_storage_object_tenant_fk[\s\S]*foreign key \(storage_object_id, tenant_id\)[\s\S]*references storage_objects \(id, tenant_id\)/i);
  assert.match(sql, /constraint storage_object_payloads_matter_tenant_fk[\s\S]*foreign key \(matter_id, tenant_id\)[\s\S]*references matters \(id, tenant_id\)/i);
  assert.match(sql, /alter table storage_object_payloads\s+enable row level security/i);
  assert.match(sql, /alter table storage_object_payloads\s+force row level security/i);
  assert.match(sql, /create policy storage_object_payloads_tenant_isolation[\s\S]*using \(tenant_id = current_app_tenant_id\(\)\)/i);
  assert.match(sql, /with check \(tenant_id = current_app_tenant_id\(\)\)/i);
});

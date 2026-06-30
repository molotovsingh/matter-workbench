import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/024_first_class_upload_sessions.sql", import.meta.url);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

test("first-class upload session migration creates durable file items with tenant isolation", () => {
  const sql = readMigration();

  assert.match(sql, /alter table upload_sessions[\s\S]*alter column matter_id drop not null/i);
  assert.match(sql, /status in \('pending', 'uploading', 'uploaded', 'verified', 'committed', 'partial_failed', 'failed', 'cancelled'\)/i);
  assert.match(sql, /create table if not exists upload_session_items/i);
  assert.match(sql, /payload bytea/i);
  assert.match(sql, /unique \(tenant_id, upload_session_id, file_index\)/i);
  assert.match(sql, /foreign key \(upload_session_id, tenant_id\)[\s\S]*references upload_sessions \(id, tenant_id\)/i);
  assert.match(sql, /alter table upload_session_items enable row level security/i);
  assert.match(sql, /create policy upload_session_items_tenant_isolation/i);
});

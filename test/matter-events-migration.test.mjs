import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../db/migrations/020_matter_events.sql", import.meta.url);


test("matter_events migration creates tenant-scoped idempotent append ledger", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS matter_events/i);
  assert.match(sql, /tenant_id uuid NOT NULL REFERENCES tenants\(id\)/i);
  assert.match(sql, /matter_id uuid REFERENCES matters\(id\)/i);
  assert.match(sql, /matter_name text NOT NULL DEFAULT ''/i);
  assert.match(sql, /event_type text NOT NULL CHECK/i);
  assert.match(sql, /actor_json jsonb NOT NULL DEFAULT '\{\}'::jsonb/i);
  assert.match(sql, /source_json jsonb NOT NULL DEFAULT '\{\}'::jsonb/i);
  assert.match(sql, /payload_json jsonb NOT NULL DEFAULT '\{\}'::jsonb/i);
  assert.match(sql, /idempotency_key text NOT NULL/i);
  assert.match(sql, /UNIQUE \(tenant_id, idempotency_key\)/i);
  assert.match(sql, /ALTER TABLE matter_events ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE matter_events FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /matter_events_tenant_isolation/i);
  assert.match(sql, /FOREIGN KEY \(matter_id, tenant_id\) REFERENCES matters \(id, tenant_id\)/i);
});

test("matter_events migration avoids source-file delete vocabulary", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.doesNotMatch(sql, /source_file\.deleted/);
  assert.doesNotMatch(sql, /delete file/i);
});

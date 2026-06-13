import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../db/migrations/017_custody_supersession.sql", import.meta.url);

test("custody supersession migration marks evidence rows instead of deleting them", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /alter table extraction_records\s+add column if not exists superseded_at timestamptz/i);
  assert.match(sql, /alter table source_descriptors\s+add column if not exists superseded_at timestamptz/i);
  assert.match(sql, /create index if not exists extraction_records_live_storage_object_idx/i);
  assert.match(sql, /create index if not exists source_descriptors_live_storage_object_idx/i);
  assert.equal((sql.match(/where superseded_at is null/gi) || []).length, 2);
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete from\b/i);
});

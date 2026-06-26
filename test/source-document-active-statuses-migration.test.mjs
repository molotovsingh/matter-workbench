import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../db/migrations/021_source_document_active_statuses.sql", import.meta.url);

test("source document active-status migration adds inactive custody states without physical purge", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /drop constraint if exists documents_status_check/i);
  assert.match(sql, /add constraint documents_status_check/i);
  assert.match(sql, /removed_from_active_record/);
  assert.match(sql, /quarantined/);
  assert.match(sql, /deleted_pending/);
  assert.match(sql, /deleted/);
  assert.match(sql, /documents_active_source_status_idx/i);
  assert.doesNotMatch(sql, /delete\s+from\s+documents/i);
  assert.doesNotMatch(sql, /delete\s+from\s+storage_objects/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
});

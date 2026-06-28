import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../db/migrations/023_matter_archive_metadata.sql", import.meta.url);

test("matter archive metadata migration records lifecycle context without deletion", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /alter table matters/i);
  assert.match(sql, /archive_reason text/i);
  assert.match(sql, /archived_by_username text/i);
  assert.match(sql, /archived_by_display_name text/i);
  assert.match(sql, /reopened_at timestamptz/i);
  assert.match(sql, /reopened_by_username text/i);
  assert.match(sql, /matters_archive_reason_length/i);
  assert.match(sql, /char_length\(archive_reason\) <= 500/i);
  assert.match(sql, /matters_archived_lifecycle_idx/i);
  assert.match(sql, /where status = 'archived'/i);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
});

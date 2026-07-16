import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../db/migrations/026_active_matter_name_uniqueness.sql", import.meta.url);

test("active matter-name uniqueness migration fails closed before adding the partial index", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /select tenant_id, lower\(name\)[\s\S]*where status = 'active'[\s\S]*group by tenant_id, lower\(name\)[\s\S]*having count\(\*\) > 1/i);
  assert.match(sql, /duplicate_group_count > 0[\s\S]*ERRCODE = '23505'/i);
  assert.match(sql, /resolve duplicates before retrying migration 026/i);
  assert.match(sql, /create unique index if not exists matters_active_tenant_lower_name_unique/i);
  assert.match(sql, /on matters \(tenant_id, lower\(name\)\)[\s\S]*where status = 'active'/i);
  assert.doesNotMatch(sql, /delete\s+from matters|update\s+matters/i);
});

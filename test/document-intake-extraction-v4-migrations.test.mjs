import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildDocumentIntakeExtractionRuntimeRoleSql } from "../services/document-intake-extraction/postgres/runtime-role-sql.mjs";

const migrationUrl = new URL("../services/document-intake-extraction/postgres/migrations/011_recovery_canary.sql", import.meta.url);

test("011 recovery canary is fixed, non-sensitive and operator-only", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table document_intake_extraction\.recovery_canary/i);
  assert.match(sql, /insert into document_intake_extraction\.recovery_canary/i);
  assert.match(sql, /v4-recovery-canary\/v1/i);
  assert.doesNotMatch(sql, /password|token|secret|connection string/i);
  assert.match(sql, /revoke all on document_intake_extraction\.recovery_canary from public/i);

  const runtimeGrants = buildDocumentIntakeExtractionRuntimeRoleSql({ roleName: "mwb_v4_runtime" });
  assert.doesNotMatch(runtimeGrants, /recovery_canary/i, "runtime identity must receive no canary grant");
});

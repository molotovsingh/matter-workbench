import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDocumentIntakeExtractionMigrations } from "../services/document-intake-extraction/postgres/migrate.mjs";
import {
  buildDocumentIntakeExtractionReadRoleSql,
  buildDocumentIntakeExtractionRuntimeRoleSql,
} from "../services/document-intake-extraction/postgres/runtime-role-sql.mjs";

const MIGRATION = new URL("../services/document-intake-extraction/postgres/migrations/001_control_plane.sql", import.meta.url);
const DOCUMENT_LOCAL_MIGRATION = new URL("../services/document-intake-extraction/postgres/migrations/002_document_local_claims.sql", import.meta.url);
const SELECTIVE_REPAIR_MIGRATION = new URL("../services/document-intake-extraction/postgres/migrations/003_selective_repair_lineage.sql", import.meta.url);
const CAPACITY_OUTCOME_MIGRATION = new URL("../services/document-intake-extraction/postgres/migrations/004_capacity_outcomes.sql", import.meta.url);

// V4-DB-001
test("V4-DB-001 defines an owned PostgreSQL control plane with forced tenant RLS, fenced work, cost evidence, and an outbox", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const requiredTables = [
    "source_blobs", "intakes", "intake_files", "blob_tenant_references", "documents",
    "page_computations", "document_pages", "computation_demands", "provider_attempts",
    "cost_events", "extraction_results", "outbox_events", "capacity_observations",
  ];
  for (const table of requiredTables) {
    assert.match(sql, new RegExp(`create table document_intake_extraction\\.${table}\\b`), `missing ${table}`);
  }
  const tenantTables = requiredTables.filter((table) => table !== "source_blobs");
  for (const table of tenantTables) {
    assert.match(sql, new RegExp(`alter table document_intake_extraction\\.${table} force row level security`, "i"), `${table} must force RLS`);
    assert.match(sql, new RegExp(`create policy tenant_isolation on document_intake_extraction\\.${table}`, "i"), `${table} needs tenant policy`);
  }
  assert.match(sql, /for update of pc skip locked/i);
  assert.match(sql, /and lease_token = target_lease_token/i);
  assert.match(sql, /unique \(tenant_id, fingerprint\)/i);
  assert.match(sql, /unknown_requires_reconciliation/i);
  assert.match(sql, /unique \(tenant_id, event_type, intake_id, result_id\)/i);
  assert.doesNotMatch(sql, /\b(?:public\.)?(?:matters|processing_jobs|upload_sessions)\b/i, "V4 migration must not mutate legacy tables");

  const documentLocalSql = await readFile(DOCUMENT_LOCAL_MIGRATION, "utf8");
  assert.match(documentLocalSql, /claim_document_local_page_work/i);
  assert.match(documentLocalSql, /for update of pc skip locked/i);
  assert.match(documentLocalSql, /page_number = seed\.page_number \+ numbered\.contiguous_ordinal - 1/i);
  assert.doesNotMatch(documentLocalSql, /\b(?:public\.)?(?:matters|processing_jobs|upload_sessions)\b/i);
  const selectiveRepairSql = await readFile(SELECTIVE_REPAIR_MIGRATION, "utf8");
  assert.match(selectiveRepairSql, /create table document_intake_extraction\.computation_supersessions/i);
  assert.match(selectiveRepairSql, /force row level security/i);
  assert.match(selectiveRepairSql, /prior_computation_id <> replacement_computation_id/i);
  assert.doesNotMatch(selectiveRepairSql, /\b(?:public\.)?(?:matters|processing_jobs|upload_sessions)\b/i);
  const capacityOutcomeSql = await readFile(CAPACITY_OUTCOME_MIGRATION, "utf8");
  assert.match(capacityOutcomeSql, /outcome in \('success', 'failed', 'throttled'\)/i);
  assert.doesNotMatch(capacityOutcomeSql, /\b(?:public\.)?(?:matters|processing_jobs|upload_sessions)\b/i);

  const runtimeGrants = buildDocumentIntakeExtractionRuntimeRoleSql({ roleName: "v4_runtime" });
  assert.match(runtimeGrants, /claim_page_work\(text, integer\)/);
  assert.match(runtimeGrants, /claim_document_local_page_work\(text, integer, integer\)/);
  assert.match(runtimeGrants, /computation_supersessions/);
  const readGrants = buildDocumentIntakeExtractionReadRoleSql({ roleName: "v4_reader" });
  assert.doesNotMatch(readGrants, /source_blobs|provider_attempts|cost_events/);
  assert.throws(() => buildDocumentIntakeExtractionRuntimeRoleSql({ roleName: "v4_runtime; drop schema public" }), {
    code: "v4_postgres.role_invalid",
  });
});

test("V4 PostgreSQL migration runner is transactional, idempotent, and fails on changed applied SQL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-migrations-"));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "001_test.sql"), "create table example(id integer);\n");
    const firstClient = fakeMigrationClient([]);
    const applied = await runDocumentIntakeExtractionMigrations({ pool: fakePool(firstClient), migrationsDirectory: root });
    assert.deepEqual(applied.migrations.map((entry) => entry.status), ["applied"]);
    assert.equal(firstClient.queries[0].text, "begin");
    assert.equal(firstClient.queries.at(-1).text, "commit");
    assert.ok(firstClient.queries.some((query) => /pg_advisory_xact_lock/.test(query.text)));
    const insert = firstClient.queries.find((query) => /insert into document_intake_extraction\.schema_migrations/.test(query.text));
    assert.match(insert.values[1], /^[a-f0-9]{64}$/);

    const replayClient = fakeMigrationClient([{ migration_name: "001_test.sql", sha256: insert.values[1] }]);
    const replay = await runDocumentIntakeExtractionMigrations({ pool: fakePool(replayClient), migrationsDirectory: root });
    assert.deepEqual(replay.migrations.map((entry) => entry.status), ["already_applied"]);

    await writeFile(path.join(root, "001_test.sql"), "create table changed(id integer);\n");
    const changedClient = fakeMigrationClient([{ migration_name: "001_test.sql", sha256: insert.values[1] }]);
    await assert.rejects(
      () => runDocumentIntakeExtractionMigrations({ pool: fakePool(changedClient), migrationsDirectory: root }),
      { code: "v4_migration.checksum_mismatch" },
    );
    assert.equal(changedClient.queries.at(-1).text, "rollback");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function fakePool(client) {
  return { connect: async () => client };
}

function fakeMigrationClient(appliedRows) {
  return {
    queries: [],
    async query(text, values = []) {
      this.queries.push({ text, values });
      if (/select migration_name, sha256/.test(text)) return { rows: appliedRows };
      return { rows: [] };
    },
    release() {},
  };
}

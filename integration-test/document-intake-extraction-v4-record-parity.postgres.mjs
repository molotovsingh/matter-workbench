import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import test from "node:test";
import pg from "pg";

import { buildRuntimeRoleSetupSql } from "../scripts/db-runtime-role-setup.mjs";
import { PostgresIntakeRepository } from "../services/document-intake-extraction/postgres/postgres-intake-repository.mjs";
import { runDocumentIntakeExtractionMigrations } from "../services/document-intake-extraction/postgres/migrate.mjs";
import { canUseCachedExtraction } from "../extract-engine.mjs";
import { createRuntimeDbMatterRecordStore } from "../services/matter-record-store/runtime-db-matter-record-store.mjs";
import { createRuntimeDbStorageService } from "../services/runtime-db-storage-service.mjs";
import { createV4ExtractionImportService } from "../services/v4-extraction-import-service.mjs";
import { toCsv } from "../shared/csv.mjs";
import { EXTRACTION_LOG_HEADERS, FILE_REGISTER_HEADERS } from "../shared/matter-contract.mjs";

const adminUrl = String(process.env.MWB_POSTGRES_TEST_ADMIN_URL || "").trim();
const migrationsDir = new URL("../db/migrations/", import.meta.url);

const MATTER_NAME = "Iyer v State";
const INTAKE_DIR = "00_Inbox/Intake 01";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

// Real-database evidence for 001-v4-record-parity.
//
// test/v4-record-parity.test.mjs proves the two arrangements agree, but it fakes
// the SQL layer. This proves the database arrangement actually persists — real
// payload rows, real tenant scoping, real round trip — and that what it persists
// is a record the extract engine will reuse.
test("V4 filing reaches the matter record through real PostgreSQL storage", {
  timeout: 120_000,
}, async () => {
  assert.ok(adminUrl, "Set MWB_POSTGRES_TEST_ADMIN_URL to a disposable PostgreSQL admin database.");
  const suffix = randomBytes(6).toString("hex");
  const databaseName = `mwb_parity_it_${suffix}`;
  const roleName = `mwb_parity_runtime_${suffix}`;
  const rolePassword = randomBytes(18).toString("base64url");
  const maintenance = new pg.Client({ connectionString: adminUrl });
  let databaseCreated = false;
  let roleCreated = false;

  await maintenance.connect();
  try {
    await maintenance.query(`create role ${quoteIdentifier(roleName)} login password ${quoteLiteral(rolePassword)} nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    roleCreated = true;
    await maintenance.query(`create database ${quoteIdentifier(databaseName)}`);
    databaseCreated = true;

    const databaseAdminUrl = databaseUrlFor(adminUrl, databaseName);
    const admin = new pg.Client({ connectionString: databaseAdminUrl });
    await admin.connect();
    try {
      await applyMigrations(admin);
      await admin.query(buildRuntimeRoleSetupSql({ roleName, password: rolePassword }));
      const runtimeUrl = runtimeDatabaseUrlFor(databaseAdminUrl, roleName, rolePassword);

      const tenantId = randomUUID();
      const matterId = randomUUID();
      await admin.query("insert into tenants (id, name, type) values ($1, 'Parity tenant', 'internal_test')", [tenantId]);
      await admin.query("insert into matters (id, tenant_id, name) values ($1, $2, $3)", [matterId, tenantId, MATTER_NAME]);

      const storage = createRuntimeDbStorageService({ databaseUrl: runtimeUrl, tenantId });
      // Shaped exactly like runtime-db-matter-index findMatterFolder: name in,
      // normalized row with an id out.
      const matterIndex = {
        async findMatterFolder(name) {
          const found = await admin.query("select id, name from matters where tenant_id = $1 and name = $2", [tenantId, String(name)]);
          return found.rows[0] ? { id: found.rows[0].id, name: found.rows[0].name, matterName: found.rows[0].name } : null;
        },
      };
      const store = createRuntimeDbMatterRecordStore({ storage, matterIndex });
      const matter = { id: matterId, name: MATTER_NAME, folderName: MATTER_NAME, matterName: MATTER_NAME };

      // Seed the matter exactly as the ordinary registration step would.
      const registerRows = [
        { file_id: "FILE-0001", intake_id: "INTAKE-01", source_path: "in/order.pdf", working_copy_path: `${INTAKE_DIR}/FILE-0001 order.pdf`, sha256: SHA_A, status: "copied" },
        { file_id: "FILE-0003", intake_id: "INTAKE-01", source_path: "in/notice.pdf", working_copy_path: `${INTAKE_DIR}/FILE-0003 notice.pdf`, sha256: SHA_B, status: "copied" },
      ];
      await storage.persistTextArtifacts(matter, [{
        relativePath: "matter.json",
        text: JSON.stringify({ matter_name: MATTER_NAME, intakes: [{ intake_id: "INTAKE-01", intake_dir: INTAKE_DIR }] }, null, 2),
        objectRole: "matter_artifact",
        mimeType: "application/json",
      }]);
      await storage.persistTextArtifacts(matter, [{
        relativePath: `${INTAKE_DIR}/File Register.csv`,
        text: toCsv(registerRows, FILE_REGISTER_HEADERS),
        objectRole: "matter_artifact",
        mimeType: "text/csv",
      }]);
      await storage.persistTextArtifacts(matter, [{
        relativePath: `${INTAKE_DIR}/Extraction Log.csv`,
        text: toCsv([{ file_id: "FILE-0009", intake_id: "INTAKE-01", status: "extracted", engine: "docx-mammoth", extracted_at: "2026-08-01T00:00:00.000Z" }], EXTRACTION_LOG_HEADERS),
        objectRole: "matter_artifact",
        mimeType: "text/csv",
      }]);

      const resolved = await store.resolveMatter({ folderName: MATTER_NAME });
      assert.ok(resolved, "the seeded matter must resolve through the database store");

      const service = createV4ExtractionImportService({ store, clock: () => new Date("2026-08-29T00:00:00.000Z") });
      const summary = await service.importExtractionResult({
        matterFolderName: MATTER_NAME,
        intakeId: "INTAKE-V4",
        resultId: "RESULT-1",
        documents: [
          {
            sha256: SHA_A,
            originalName: "order.pdf",
            pages: [
              { pageNumber: 1, outcome: "accepted", text: "IN THE COURT\n\nORDER: the application is allowed.", provenance: { provider: "gemini", model: "gemini-3.7-flash" } },
              { pageNumber: 2, outcome: "accepted", text: "Heard both parties.", provenance: { provider: "gemini", model: "gemini-3.7-flash" } },
            ],
          },
          // One unreadable page: the whole document stays on the legacy path.
          {
            sha256: SHA_B,
            originalName: "notice.pdf",
            pages: [
              { pageNumber: 1, outcome: "accepted", text: "Readable page.", provenance: { provider: "gemini", model: "gemini-3.7-flash" } },
              { pageNumber: 2, outcome: "review_required", text: "", provenance: { provider: "gemini", model: "gemini-3.7-flash" } },
            ],
          },
          { sha256: "c".repeat(64), originalName: "stray.pdf", pages: [{ pageNumber: 1, outcome: "accepted", text: "Not registered." }] },
        ],
      });

      assert.deepEqual(summary.imported, ["FILE-0001"]);
      assert.deepEqual(summary.leftForLegacyExtraction, ["FILE-0003"], "an unreadable page keeps the document on the legacy path");
      assert.deepEqual(summary.skippedNoRegisterMatch, ["stray.pdf"], "unregistered content is never invented into the record");

      // Read back through the service, proving the bytes actually persisted.
      const recordText = await storage.readMatterText(matter, `${INTAKE_DIR}/_extracted/FILE-0001.json`);
      assert.ok(recordText, "the record must be readable back out of the database");
      const record = JSON.parse(recordText);
      assert.equal(record.schema_version, "extraction-record/v1");
      assert.equal(record.file_id, "FILE-0001");
      assert.equal(record.sha256, SHA_A);
      assert.equal(record.page_count, 2);

      const flat = await storage.readMatterText(matter, `${INTAKE_DIR}/_extracted/FILE-0001.txt`);
      assert.match(flat, /ORDER: the application is allowed\./);

      const log = await storage.readMatterText(matter, `${INTAKE_DIR}/Extraction Log.csv`);
      assert.match(log, /FILE-0009/, "the unrelated legacy log row survives the merge");
      assert.match(log, /FILE-0001/, "the new row is present");

      assert.equal(
        await storage.readMatterText(matter, `${INTAKE_DIR}/_extracted/FILE-0003.json`),
        null,
        "the document left for legacy extraction must have written nothing",
      );

      // The property parity comparison cannot prove: preparation will reuse it.
      assert.equal(
        canUseCachedExtraction(record, registerRows[0], { fingerprint: "pdf-ocr-v1" }, { ocrProvider: () => {}, forceRefresh: false }),
        true,
        "a record persisted through real PostgreSQL must still satisfy the extract engine's reuse gate",
      );

      // Replay is idempotent: the existing record wins.
      const replay = await service.importExtractionResult({
        matterFolderName: MATTER_NAME,
        intakeId: "INTAKE-V4",
        resultId: "RESULT-2",
        documents: [{ sha256: SHA_A, originalName: "order.pdf", pages: [{ pageNumber: 1, outcome: "accepted", text: "Different text entirely." }] }],
      });
      assert.deepEqual(replay.imported, []);
      assert.deepEqual(replay.skippedExistingRecord, ["FILE-0001"]);
      assert.equal(
        await storage.readMatterText(matter, `${INTAKE_DIR}/_extracted/FILE-0001.json`),
        recordText,
        "the original record must survive a replay byte for byte",
      );

      // FR-013: the report survives the lawyer leaving the page. Stored against
      // the run, so it is discarded with the run and outlives nothing.
      const v4Pool = new pg.Pool({ connectionString: databaseAdminUrl });
      try {
        await runDocumentIntakeExtractionMigrations({ pool: v4Pool });
        const intakeRepository = new PostgresIntakeRepository({ pool: v4Pool });
        const v4TenantId = `tenant-${suffix}`;
        const created = await intakeRepository.createIntake({
          schemaVersion: "document-intake-extraction.create-intake-command/v1",
          tenantId: v4TenantId,
          matterId: "matter-slug",
          idempotencyKey: `key-${suffix}`,
          clientRequestId: MATTER_NAME,
          files: [{ originalName: "order.pdf", relativePath: "order.pdf", expectedBytes: 1024 }],
        });

        const before = await intakeRepository.readIntake({ tenantId: v4TenantId, intakeId: created.intakeId });
        assert.equal(before.filingReport, null, "a run carries no report until one is recorded");

        const report = {
          filed: ["FILE-0001"],
          leftForNormalExtraction: ["FILE-0003"],
          skippedUnregistered: ["stray.pdf"],
          skippedExistingRecord: [],
        };
        await intakeRepository.recordFilingReport({ tenantId: v4TenantId, intakeId: created.intakeId, report });

        const after = await intakeRepository.readIntake({ tenantId: v4TenantId, intakeId: created.intakeId });
        assert.deepEqual(after.filingReport, report, "the report must survive a fresh read of the run");
      } finally {
        await v4Pool.end();
      }

      // FR-014. Filing must not reach across tenants. Asserted here rather than
      // in a unit test because a fake cannot demonstrate row-level scoping —
      // the guarantee lives in the database, so only the database can show it.
      const otherTenantId = randomUUID();
      const otherMatterId = randomUUID();
      await admin.query("insert into tenants (id, name, type) values ($1, 'Other tenant', 'internal_test')", [otherTenantId]);
      await admin.query("insert into matters (id, tenant_id, name) values ($1, $2, $3)", [otherMatterId, otherTenantId, "Other Tenant Matter"]);

      const foreignIndex = {
        async findMatterFolder(name) {
          const found = await admin.query("select id, name from matters where name = $1", [String(name)]);
          return found.rows[0] ? { id: found.rows[0].id, name: found.rows[0].name, matterName: found.rows[0].name } : null;
        },
      };
      // Same storage service, still scoped to the original tenant, but pointed at
      // another tenant's matter: the index finds it, the storage layer must not.
      const crossTenantStore = createRuntimeDbMatterRecordStore({ storage, matterIndex: foreignIndex });
      const foreign = await crossTenantStore.resolveMatter({ folderName: "Other Tenant Matter" });
      assert.equal(foreign, null, "a matter belonging to another tenant must not resolve");

      const crossTenantService = createV4ExtractionImportService({ store: crossTenantStore });
      await assert.rejects(
        () => crossTenantService.importExtractionResult({
          matterFolderName: "Other Tenant Matter",
          documents: [{ sha256: SHA_A, originalName: "order.pdf", pages: [{ pageNumber: 1, outcome: "accepted", text: "leak" }] }],
        }),
        (error) => error?.code === "v4_import.matter_not_found",
        "filing into another tenant's matter must fail closed, not write",
      );
    } finally {
      await admin.end();
    }
  } finally {
    if (databaseCreated) await maintenance.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`);
    if (roleCreated) await maintenance.query(`drop role if exists ${quoteIdentifier(roleName)}`);
    await maintenance.end();
  }
});

async function applyMigrations(client) {
  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort();
  for (const file of files) {
    await client.query(await readFile(new URL(file, migrationsDir), "utf8"));
  }
}

function databaseUrlFor(value, databaseName) {
  const url = new URL(value);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function runtimeDatabaseUrlFor(value, roleName, password) {
  const url = new URL(value);
  if (!url.hostname || url.searchParams.has("host")) {
    url.hostname = "127.0.0.1";
    url.port = url.port || "5432";
    url.searchParams.delete("host");
  }
  url.username = roleName;
  url.password = password;
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

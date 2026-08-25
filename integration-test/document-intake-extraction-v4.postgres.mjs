import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import pg from "pg";

import { runDocumentIntakeExtractionMigrations } from "../services/document-intake-extraction/postgres/migrate.mjs";
import { PostgresUploadAuthorizationStore } from "../services/document-intake-extraction/postgres/postgres-upload-authorization-store.mjs";
import { buildDocumentIntakeExtractionRuntimeRoleSql } from "../services/document-intake-extraction/postgres/runtime-role-sql.mjs";

const adminUrl = String(process.env.MWB_POSTGRES_TEST_ADMIN_URL || "").trim();

// V4-DB-001 real-database evidence
test("V4 PostgreSQL control plane enforces migration immutability, tenant isolation, and concurrent fenced claims", {
  timeout: 120_000,
}, async () => {
  assert.ok(adminUrl, "Set MWB_POSTGRES_TEST_ADMIN_URL to a disposable PostgreSQL admin database.");
  const suffix = randomBytes(6).toString("hex");
  const databaseName = `mwb_v4_it_${suffix}`;
  const roleName = `mwb_v4_runtime_${suffix}`;
  const rolePassword = randomBytes(24).toString("base64url");
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
    const adminPool = new pg.Pool({ connectionString: databaseAdminUrl, max: 2 });
    try {
      const first = await runDocumentIntakeExtractionMigrations({ pool: adminPool });
      assert.deepEqual(first.migrations.map((migration) => migration.status), ["applied"]);
      const replay = await runDocumentIntakeExtractionMigrations({ pool: adminPool });
      assert.deepEqual(replay.migrations.map((migration) => migration.status), ["already_applied"]);
      await adminPool.query(buildDocumentIntakeExtractionRuntimeRoleSql({ roleName }));

      const runtimeUrl = runtimeDatabaseUrlFor(databaseAdminUrl, roleName, rolePassword);
      await verifyTenantIsolation(runtimeUrl);
      await verifyConcurrentClaims(runtimeUrl);
      await verifyDurableUploadAuthorization(runtimeUrl);
    } finally {
      await adminPool.end();
    }
  } finally {
    if (databaseCreated) await maintenance.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`);
    if (roleCreated) await maintenance.query(`drop role if exists ${quoteIdentifier(roleName)}`);
    await maintenance.end();
  }
});

async function verifyTenantIsolation(runtimeUrl) {
  const tenantA = `tenant-${randomUUID()}`;
  const tenantB = `tenant-${randomUUID()}`;
  const sourceSha = "a".repeat(64);
  const client = new pg.Client({ connectionString: runtimeUrl });
  await client.connect();
  try {
    await client.query([
      "insert into document_intake_extraction.source_blobs (sha256, object_key, bytes, page_count, inspector_version, verified_at)",
      "values ($1, $2, 100, 1, 'integration-inspector/v1', now())",
    ].join("\n"), [sourceSha, `blobs/sha256/aa/${sourceSha}`]);
    const intakeA = randomUUID();
    const intakeB = randomUUID();
    await withTenant(client, tenantA, async () => {
      await insertIntake(client, { tenantId: tenantA, intakeId: intakeA, idempotencyKey: "tenant-a" });
    });
    await withTenant(client, tenantB, async () => {
      await insertIntake(client, { tenantId: tenantB, intakeId: intakeB, idempotencyKey: "tenant-b" });
    });
    const unset = await client.query("select count(*)::int as count from document_intake_extraction.intakes");
    assert.equal(unset.rows[0].count, 0, "unset tenant context must fail closed");
    await withTenant(client, tenantA, async () => {
      const visible = await client.query("select tenant_id, intake_id::text from document_intake_extraction.intakes");
      assert.deepEqual(visible.rows, [{ tenant_id: tenantA, intake_id: intakeA }]);
      await assert.rejects(() => insertIntake(client, {
        tenantId: tenantB,
        intakeId: randomUUID(),
        idempotencyKey: "cross-tenant",
      }), /row-level security policy/i);
    });
  } finally {
    await client.end();
  }
}

async function verifyDurableUploadAuthorization(runtimeUrl) {
  const tenantId = `tenant-${randomUUID()}`;
  const intakeId = randomUUID();
  const fileId = randomUUID();
  const documentId = randomUUID();
  const tokenDigest = "e".repeat(64);
  const sourceSha = "f".repeat(64);
  const pool = new pg.Pool({ connectionString: runtimeUrl, max: 2 });
  const seed = await pool.connect();
  try {
    await seed.query("begin");
    await seed.query("select set_config('document_intake_extraction.tenant_id', $1, true)", [tenantId]);
    await insertIntake(seed, { tenantId, intakeId, idempotencyKey: "authorization" });
    await seed.query([
      "insert into document_intake_extraction.intake_files",
      "  (file_id, tenant_id, intake_id, document_id, ordinal, original_name, relative_path, mime_type, expected_bytes, status)",
      "values ($1, $2, $3, $4, 0, 'agreement.pdf', 'agreement.pdf', 'application/pdf', 100, 'awaiting_upload')",
    ].join("\n"), [fileId, tenantId, intakeId, documentId]);
    await seed.query("commit");
  } finally {
    seed.release();
  }
  try {
    const store = new PostgresUploadAuthorizationStore({ pool });
    const created = await store.create({
      schemaVersion: "document-intake-extraction.s3-upload-authorization-record/v1",
      tokenDigest,
      tenantId,
      intakeId,
      fileId,
      expectedBytes: 100,
      stagedObjectKey: `staging/${intakeId}/${fileId}`,
      status: "authorized",
      dataRegion: "ap-southeast-2",
      expiresAt: "2026-08-24T12:15:00.000Z",
      createdAt: "2026-08-24T12:00:00.000Z",
      updatedAt: "2026-08-24T12:00:00.000Z",
    });
    assert.equal(created.status, "authorized");
    assert.equal(await store.readByTokenDigest(tokenDigest, { tenantId: `other-${tenantId}` }), null);
    const committed = await store.updateByTokenDigest(tokenDigest, {
      tenantId,
      expectedStatuses: ["authorized", "uploaded"],
      patch: {
        status: "committed",
        sha256: sourceSha,
        bytes: 100,
        blobObjectKey: `blobs/sha256/ff/${sourceSha}`,
        objectReused: false,
        committedAt: "2026-08-24T12:05:00.000Z",
      },
    });
    assert.equal(committed.status, "committed");
    assert.equal(committed.dataRegion, "ap-southeast-2");
    assert.equal(await store.updateByTokenDigest(tokenDigest, {
      tenantId,
      expectedStatuses: ["authorized"],
      patch: { status: "committed", sha256: sourceSha, bytes: 100, blobObjectKey: `blobs/sha256/ff/${sourceSha}`, committedAt: "2026-08-24T12:05:00.000Z" },
    }), null);
    const check = await pool.connect();
    try {
      await check.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [tenantId]);
      const state = await check.query([
        "select i.committed_file_count, i.committed_bytes::text, f.status, b.logical_reference_count",
        "from document_intake_extraction.intakes i",
        "join document_intake_extraction.intake_files f on f.tenant_id = i.tenant_id and f.intake_id = i.intake_id",
        "join document_intake_extraction.blob_tenant_references b on b.tenant_id = i.tenant_id and b.source_sha256 = f.source_sha256",
        "where i.tenant_id = $1 and i.intake_id = $2",
      ].join("\n"), [tenantId, intakeId]);
      assert.deepEqual(state.rows[0], { committed_file_count: 1, committed_bytes: "100", status: "committed", logical_reference_count: 1 });
    } finally {
      check.release();
    }
  } finally {
    await pool.end();
  }
}

async function verifyConcurrentClaims(runtimeUrl) {
  const tenantId = `tenant-${randomUUID()}`;
  const sourceSha = "b".repeat(64);
  const seed = new pg.Client({ connectionString: runtimeUrl });
  await seed.connect();
  try {
    await seed.query([
      "insert into document_intake_extraction.source_blobs (sha256, object_key, bytes, page_count, inspector_version, verified_at)",
      "values ($1, $2, 100, 2, 'integration-inspector/v1', now())",
    ].join("\n"), [sourceSha, `blobs/sha256/bb/${sourceSha}`]);
    await withTenant(seed, tenantId, async () => {
      for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
        await seed.query([
          "insert into document_intake_extraction.page_computations",
          "  (computation_id, tenant_id, fingerprint, source_sha256, page_number, provider, model, adapter_version, routing_policy, validator_version, status)",
          "values ($1, $2, $3, $4, $5, 'mistral', 'mistral-ocr-4-1', 'adapter/v1', 'route/v1', 'validator/v1', 'queued')",
        ].join("\n"), [randomUUID(), tenantId, pageNumber === 1 ? "c".repeat(64) : "d".repeat(64), sourceSha, pageNumber]);
      }
    });
  } finally {
    await seed.end();
  }

  const workerA = new pg.Client({ connectionString: runtimeUrl });
  const workerB = new pg.Client({ connectionString: runtimeUrl });
  await Promise.all([workerA.connect(), workerB.connect()]);
  try {
    await Promise.all([
      workerA.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [tenantId]),
      workerB.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [tenantId]),
    ]);
    const [first, second] = await Promise.all([
      workerA.query("select computation_id::text, page_number, lease_token::text from document_intake_extraction.claim_page_work('worker-a', 60000)"),
      workerB.query("select computation_id::text, page_number, lease_token::text from document_intake_extraction.claim_page_work('worker-b', 60000)"),
    ]);
    assert.equal(first.rows.length, 1);
    assert.equal(second.rows.length, 1);
    assert.notEqual(first.rows[0].computation_id, second.rows[0].computation_id);
    const wrongLease = await workerA.query(
      "select document_intake_extraction.renew_page_lease($1::uuid, $2::uuid, 60000) as renewed",
      [first.rows[0].computation_id, randomUUID()],
    );
    assert.equal(wrongLease.rows[0].renewed, false);
    const correctLease = await workerA.query(
      "select document_intake_extraction.renew_page_lease($1::uuid, $2::uuid, 60000) as renewed",
      [first.rows[0].computation_id, first.rows[0].lease_token],
    );
    assert.equal(correctLease.rows[0].renewed, true);
  } finally {
    await Promise.all([workerA.end(), workerB.end()]);
  }
}

async function withTenant(client, tenantId, operation) {
  await client.query("begin");
  try {
    await client.query("select set_config('document_intake_extraction.tenant_id', $1, true)", [tenantId]);
    const result = await operation();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function insertIntake(client, { tenantId, intakeId, idempotencyKey }) {
  await client.query([
    "insert into document_intake_extraction.intakes",
    "  (intake_id, tenant_id, matter_id, idempotency_key, status, expected_file_count, expected_bytes)",
    "values ($1, $2, 'matter-1', $3, 'awaiting_upload', 1, 100)",
  ].join("\n"), [intakeId, tenantId, idempotencyKey]);
}

function databaseUrlFor(connectionString, databaseName) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function runtimeDatabaseUrlFor(adminConnectionString, roleName, rolePassword) {
  const url = new URL(adminConnectionString);
  url.username = roleName;
  url.password = rolePassword;
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

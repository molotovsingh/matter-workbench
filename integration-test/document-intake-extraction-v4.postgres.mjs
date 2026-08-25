import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import pg from "pg";

import { runDocumentIntakeExtractionMigrations } from "../services/document-intake-extraction/postgres/migrate.mjs";
import { PostgresIntakeRepository } from "../services/document-intake-extraction/postgres/postgres-intake-repository.mjs";
import { PostgresOutboxStore } from "../services/document-intake-extraction/postgres/postgres-outbox-store.mjs";
import { PostgresResultRepository } from "../services/document-intake-extraction/postgres/postgres-result-repository.mjs";
import { PostgresUploadAuthorizationStore } from "../services/document-intake-extraction/postgres/postgres-upload-authorization-store.mjs";
import { PostgresWorkRepository } from "../services/document-intake-extraction/postgres/postgres-work-repository.mjs";
import { buildDocumentIntakeExtractionRuntimeRoleSql } from "../services/document-intake-extraction/postgres/runtime-role-sql.mjs";

const adminUrl = String(process.env.MWB_POSTGRES_TEST_ADMIN_URL || "").trim();

// V4-DB-001, V4-WORK-001, V4-ASSEMBLY-001, V4-EVIDENCE-001, V4-EVENT-001, and V4-OUTBOX-001 real-database evidence
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
      assert.ok(first.migrations.length >= 2);
      assert.ok(first.migrations.every((migration) => migration.status === "applied"));
      const replay = await runDocumentIntakeExtractionMigrations({ pool: adminPool });
      assert.equal(replay.migrations.length, first.migrations.length);
      assert.ok(replay.migrations.every((migration) => migration.status === "already_applied"));
      await adminPool.query(buildDocumentIntakeExtractionRuntimeRoleSql({ roleName }));

      const runtimeUrl = runtimeDatabaseUrlFor(databaseAdminUrl, roleName, rolePassword);
      await verifyTenantIsolation(runtimeUrl);
      await verifyConcurrentClaims(runtimeUrl);
      await verifyDocumentLocalClaims(runtimeUrl);
      await verifyLeaseExpirationEvidence(runtimeUrl);
      await verifyDurableUploadAuthorization(runtimeUrl);
      await verifyIntakeRepository(runtimeUrl);
      await verifyOutboxDelivery(runtimeUrl);
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

async function verifyIntakeRepository(runtimeUrl) {
  const tenantId = `tenant-${randomUUID()}`;
  const pool = new pg.Pool({ connectionString: runtimeUrl, max: 4 });
  const repository = new PostgresIntakeRepository({ pool });
  const authorizationStore = new PostgresUploadAuthorizationStore({ pool });
  const command = {
    schemaVersion: "document-intake-extraction.create-intake-command/v1",
    tenantId,
    matterId: "matter-repository",
    idempotencyKey: "repository-intake-1",
    files: [
      { originalName: "agreement.pdf", relativePath: "agreement.pdf", expectedBytes: 100 },
      { originalName: "agreement-copy.pdf", relativePath: "copy/agreement.pdf", expectedBytes: 100 },
    ],
  };
  try {
    const created = await repository.createIntake(command);
    assert.equal(created.idempotent, false);
    assert.equal(created.files.length, 2);
    const replay = await repository.createIntake(command);
    assert.equal(replay.intakeId, created.intakeId);
    assert.equal(replay.idempotent, true);
    await assert.rejects(() => repository.createIntake({
      ...command,
      files: [{ originalName: "changed.pdf", expectedBytes: 100 }],
    }), { code: "v4_postgres.idempotency_conflict" });

    const sourceSha = "9".repeat(64);
    for (let index = 0; index < created.files.length; index += 1) {
      const file = created.files[index];
      const tokenDigest = index === 0 ? "7".repeat(64) : "8".repeat(64);
      await authorizationStore.create({
        schemaVersion: "document-intake-extraction.s3-upload-authorization-record/v1",
        tokenDigest,
        tenantId,
        intakeId: created.intakeId,
        fileId: file.fileId,
        expectedBytes: 100,
        stagedObjectKey: `staging/${created.intakeId}/${file.fileId}`,
        status: "authorized",
        dataRegion: "ap-southeast-2",
        expiresAt: "2026-08-24T12:15:00.000Z",
        createdAt: "2026-08-24T12:00:00.000Z",
        updatedAt: "2026-08-24T12:00:00.000Z",
      });
      await authorizationStore.updateByTokenDigest(tokenDigest, {
        tenantId,
        expectedStatuses: ["authorized"],
        patch: {
          status: "committed",
          sha256: sourceSha,
          bytes: 100,
          blobObjectKey: `blobs/sha256/99/${sourceSha}`,
          objectReused: index > 0,
          committedAt: "2026-08-24T12:05:00.000Z",
        },
      });
    }
    const routedPages = [1, 2].map((pageNumber) => ({
      pageNumber,
      fingerprint: (pageNumber === 1 ? "1" : "2").repeat(64),
      capability: { provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "adapter/v1" },
      routingPolicy: "route/v1",
      validatorVersion: "validator/v1",
      priority: 0,
      weight: 1,
      virtualFinish: pageNumber,
    }));
    const firstDocument = await repository.recordInspectedDocument({
      tenantId,
      intakeId: created.intakeId,
      fileId: created.files[0].fileId,
      sourceSha256: sourceSha,
      pageCount: 2,
      inspectorVersion: "inspector/v1",
      pages: routedPages,
    });
    const duplicateDocument = await repository.recordInspectedDocument({
      tenantId,
      intakeId: created.intakeId,
      fileId: created.files[1].fileId,
      sourceSha256: sourceSha,
      pageCount: 2,
      inspectorVersion: "inspector/v1",
      pages: routedPages,
    });
    assert.equal(duplicateDocument.duplicateOfDocumentId, firstDocument.documentId);
    assert.deepEqual(duplicateDocument.pages.map((page) => page.computationId), firstDocument.pages.map((page) => page.computationId));
    const committed = await repository.commitBatchCustody({ tenantId, intakeId: created.intakeId });
    assert.equal(committed.status, "processing");
    assert.equal(committed.committedFileCount, 2);
    assert.equal(committed.observedPageCount, 4);

    const check = await pool.connect();
    try {
      await check.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [tenantId]);
      const counts = await check.query([
        "select",
        "  (select count(*)::int from document_intake_extraction.documents where tenant_id = $1) as documents,",
        "  (select count(*)::int from document_intake_extraction.page_computations where tenant_id = $1) as computations,",
        "  (select count(*)::int from document_intake_extraction.computation_demands where tenant_id = $1) as demands",
      ].join("\n"), [tenantId]);
      assert.deepEqual(counts.rows[0], { documents: 2, computations: 2, demands: 2 });
    } finally {
      check.release();
    }

    const workRepository = new PostgresWorkRepository({ pool });
    const firstClaim = await workRepository.claim({ tenantId, workerId: "repository-worker-a", leaseMs: 60_000 });
    await assert.rejects(() => workRepository.renew({
      tenantId, workUnitId: firstClaim.workUnitId, leaseToken: randomUUID(), leaseMs: 60_000,
    }), { code: "worker.lease_lost" });
    assert.equal((await workRepository.renew({
      tenantId, workUnitId: firstClaim.workUnitId, leaseToken: firstClaim.leaseToken, leaseMs: 60_000,
    })).renewed, true);
    const accepted = await workRepository.finishSuccess({
      tenantId,
      claim: firstClaim,
      providerResult: {
        text: "Accepted legal page.", finishReason: "complete", requestId: "provider-1",
        usage: { inputUnits: 1, outputUnits: 2 }, billedCostUsd: 0.004,
      },
      validation: { outcome: "accepted", reasons: [], validatorVersion: "validator/v1" },
    });
    assert.equal(accepted.status, "accepted");
    const secondClaim = await workRepository.claim({ tenantId, workerId: "repository-worker-b", leaseMs: 60_000 });
    const review = await workRepository.finishFailure({
      tenantId,
      claim: secondClaim,
      error: Object.assign(new Error("provider schema invalid"), {
        code: "provider.invalid_response", retryable: false, billingKnown: true, billedCostUsd: 0.002,
        usage: { inputUnits: 1, outputUnits: 0 },
      }),
    });
    assert.equal(review.status, "review_required");
    assert.equal(await workRepository.claim({ tenantId, workerId: "repository-worker-c" }), null);
    const resultRepository = new PostgresResultRepository({ pool });
    const publication = await resultRepository.publishReadyIntake({ tenantId, intakeId: created.intakeId });
    assert.equal(publication.published, true);
    assert.equal(publication.result.status, "ready_with_review");
    assert.equal(publication.result.documentCount, 2);
    assert.equal(publication.result.pageCount, 4);
    assert.equal(publication.result.reviewPageCount, 2, "one shared review page must remain explicit in both logical documents");
    assert.deepEqual(publication.result.documents.map((document) => document.pages.length), [2, 2]);
    assert.equal(publication.event.type, "extraction.result.ready");
    const replayPublication = await resultRepository.publishReadyIntake({ tenantId, intakeId: created.intakeId });
    assert.equal(replayPublication.published, false);
    assert.equal(replayPublication.result.resultId, publication.result.resultId);
    assert.equal((await resultRepository.readResult({ tenantId, resultId: publication.result.resultId })).resultId, publication.result.resultId);
    const evidence = await pool.connect();
    try {
      await evidence.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [tenantId]);
      const counts = await evidence.query([
        "select",
        "  (select count(*)::int from document_intake_extraction.provider_attempts where tenant_id = $1) as attempts,",
        "  (select count(*)::int from document_intake_extraction.cost_events where tenant_id = $1) as costs,",
        "  (select count(*)::int from document_intake_extraction.computation_demands where tenant_id = $1 and fulfilled_at is not null) as fulfilled",
      ].join("\n"), [tenantId]);
      assert.deepEqual(counts.rows[0], { attempts: 2, costs: 2, fulfilled: 2 });
    } finally {
      evidence.release();
    }
  } finally {
    await pool.end();
  }
}

async function verifyOutboxDelivery(runtimeUrl) {
  const tenantId = `tenant-${randomUUID()}`;
  const intakeId = randomUUID();
  const resultId = randomUUID();
  const eventId = randomUUID();
  const pool = new pg.Pool({ connectionString: runtimeUrl, max: 3 });
  const seed = await pool.connect();
  try {
    await seed.query("begin");
    await seed.query("select set_config('document_intake_extraction.tenant_id', $1, true)", [tenantId]);
    await insertIntake(seed, { tenantId, intakeId, idempotencyKey: "outbox" });
    await seed.query([
      "insert into document_intake_extraction.extraction_results",
      "  (result_id, tenant_id, matter_id, intake_id, version, status, assembler_version, document_count, page_count, review_page_count, payload_json)",
      "values ($1, $2, 'matter-1', $3, 1, 'ready', 'assembler/v1', 1, 1, 0, $4::jsonb)",
    ].join("\n"), [resultId, tenantId, intakeId, JSON.stringify({ resultId, intakeId })]);
    await seed.query("update document_intake_extraction.intakes set result_id = $3, status = 'ready' where tenant_id = $1 and intake_id = $2", [tenantId, intakeId, resultId]);
    await seed.query([
      "insert into document_intake_extraction.outbox_events",
      "  (event_id, tenant_id, matter_id, intake_id, result_id, event_type, schema_version, payload_json)",
      "values ($1, $2, 'matter-1', $3, $4, 'extraction.result.ready', 'document-intake-extraction.event/v1', $5::jsonb)",
    ].join("\n"), [eventId, tenantId, intakeId, resultId, JSON.stringify({ eventId, intakeId, resultId })]);
    await seed.query("commit");
  } finally {
    seed.release();
  }
  try {
    const store = new PostgresOutboxStore({ pool, idFactory: () => randomUUID() });
    assert.deepEqual(await store.claim({ tenantId: `other-${tenantId}`, workerId: "other" }), []);
    const first = await store.claim({ tenantId, workerId: "dispatcher-a", maximumEvents: 10, leaseMs: 60_000 });
    assert.equal(first.length, 1);
    assert.equal(first[0].eventId, eventId);
    await assert.rejects(() => store.markDelivered({ tenantId, eventId, leaseToken: randomUUID() }), { code: "outbox.lease_lost" });
    const failed = await store.markFailed({
      tenantId,
      eventId,
      leaseToken: first[0].leaseToken,
      errorCode: "outbox.http_503",
      errorMessage: "receiver unavailable",
      retryAfterMs: 1_000,
    });
    assert.equal(failed.status, "failed");
    const reset = await pool.connect();
    try {
      await reset.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [tenantId]);
      await reset.query("update document_intake_extraction.outbox_events set next_attempt_at = now() where tenant_id = $1 and event_id = $2", [tenantId, eventId]);
    } finally {
      reset.release();
    }
    const second = await store.claim({ tenantId, workerId: "dispatcher-b" });
    assert.equal(second[0].attemptCount, 2);
    assert.equal((await store.markDelivered({ tenantId, eventId, leaseToken: second[0].leaseToken })).status, "delivered");
    assert.deepEqual(await store.claim({ tenantId, workerId: "dispatcher-c" }), []);
  } finally {
    await pool.end();
  }
}

async function verifyLeaseExpirationEvidence(runtimeUrl) {
  const tenantId = `tenant-${randomUUID()}`;
  const sourceSha = "6".repeat(64);
  const pool = new pg.Pool({ connectionString: runtimeUrl, max: 2 });
  const seed = await pool.connect();
  try {
    await seed.query([
      "insert into document_intake_extraction.source_blobs (sha256, object_key, bytes, page_count, inspector_version, verified_at)",
      "values ($1, $2, 100, 1, 'integration-inspector/v1', now())",
    ].join("\n"), [sourceSha, `blobs/sha256/66/${sourceSha}`]);
    await seed.query("begin");
    await seed.query("select set_config('document_intake_extraction.tenant_id', $1, true)", [tenantId]);
    await seed.query([
      "insert into document_intake_extraction.page_computations",
      "  (computation_id, tenant_id, fingerprint, source_sha256, page_number, provider, model, adapter_version, routing_policy, validator_version, status, maximum_attempts)",
      "values ($1, $2, $3, $4, 1, 'mistral', 'mistral-ocr-4-1', 'adapter/v1', 'route/v1', 'validator/v1', 'queued', 1)",
    ].join("\n"), [randomUUID(), tenantId, "5".repeat(64), sourceSha]);
    await seed.query("commit");
  } finally {
    seed.release();
  }
  try {
    const repository = new PostgresWorkRepository({ pool });
    const claim = await repository.claim({ tenantId, workerId: "crashing-worker", leaseMs: 60_000 });
    const expire = await pool.connect();
    try {
      await expire.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [tenantId]);
      await expire.query([
        "update document_intake_extraction.page_computations",
        "set lease_expires_at = now() - interval '1 second'",
        "where tenant_id = $1 and computation_id = $2",
      ].join("\n"), [tenantId, claim.workUnitId]);
    } finally {
      expire.release();
    }
    assert.equal(await repository.claim({ tenantId, workerId: "recovery-worker" }), null);
    const evidence = await pool.connect();
    try {
      await evidence.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [tenantId]);
      const state = await evidence.query([
        "select pc.status, pa.status as attempt_status, pa.cost_measurement_status, ce.measurement_status",
        "from document_intake_extraction.page_computations pc",
        "join document_intake_extraction.provider_attempts pa on pa.tenant_id = pc.tenant_id and pa.computation_id = pc.computation_id",
        "join document_intake_extraction.cost_events ce on ce.tenant_id = pa.tenant_id and ce.attempt_id = pa.attempt_id",
        "where pc.tenant_id = $1",
      ].join("\n"), [tenantId]);
      assert.deepEqual(state.rows[0], {
        status: "review_required",
        attempt_status: "lease_expired",
        cost_measurement_status: "unknown_requires_reconciliation",
        measurement_status: "unknown_requires_reconciliation",
      });
    } finally {
      evidence.release();
    }
  } finally {
    await pool.end();
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

async function verifyDocumentLocalClaims(runtimeUrl) {
  const tenantId = `tenant-${randomUUID()}`;
  const sourceSha = "e".repeat(64);
  const seed = new pg.Client({ connectionString: runtimeUrl });
  await seed.connect();
  try {
    await seed.query([
      "insert into document_intake_extraction.source_blobs (sha256, object_key, bytes, page_count, inspector_version, verified_at)",
      "values ($1, $2, 100, 5, 'integration-inspector/v1', now())",
    ].join("\n"), [sourceSha, `blobs/sha256/ee/${sourceSha}`]);
    await withTenant(seed, tenantId, async () => {
      for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
        await seed.query([
          "insert into document_intake_extraction.page_computations",
          "  (computation_id, tenant_id, fingerprint, source_sha256, page_number, provider, model, adapter_version, routing_policy, validator_version, status)",
          "values ($1, $2, $3, $4, $5, 'mistral', 'mistral-ocr-4-1', 'range-adapter/v1', 'route/v1', 'validator/v1', 'queued')",
        ].join("\n"), [randomUUID(), tenantId, pageNumber.toString(16).repeat(64), sourceSha, pageNumber]);
      }
    });
  } finally {
    await seed.end();
  }
  const pool = new pg.Pool({ connectionString: runtimeUrl, max: 2 });
  try {
    const repository = new PostgresWorkRepository({ pool });
    const first = await repository.claimDocumentLocalBatch({ tenantId, workerId: "range-a", maximumPages: 3 });
    assert.deepEqual(first.map((claim) => claim.pageNumber), [1, 2, 3]);
    assert.equal(new Set(first.map((claim) => claim.leaseToken)).size, 3);
    assert.ok(first.every((claim) => claim.attemptId));
    const second = await repository.claimDocumentLocalBatch({ tenantId, workerId: "range-b", maximumPages: 3 });
    assert.deepEqual(second.map((claim) => claim.pageNumber), [4, 5]);
    assert.deepEqual(await repository.claimDocumentLocalBatch({ tenantId, workerId: "range-c", maximumPages: 3 }), []);
  } finally {
    await pool.end();
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
    "  (intake_id, tenant_id, matter_id, idempotency_key, request_fingerprint, status, expected_file_count, expected_bytes)",
    "values ($1, $2, 'matter-1', $3, repeat('a', 64), 'awaiting_upload', 1, 100)",
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

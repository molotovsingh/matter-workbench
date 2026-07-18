import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import pg from "pg";

import { buildRuntimeRoleSetupSql } from "../scripts/db-runtime-role-setup.mjs";
import { createRuntimeDbStorageService } from "../services/runtime-db-storage-service.mjs";
import { buildRuntimeDbSourceRemovalMutationSql } from "../services/source-removal-mutation-service.mjs";

const adminUrl = String(process.env.MWB_POSTGRES_TEST_ADMIN_URL || "").trim();
const migrationsDir = new URL("../db/migrations/", import.meta.url);

test("real PostgreSQL preserves replay, upload terminal state, and active matter-name uniqueness", {
  timeout: 120_000,
}, async () => {
  assert.ok(adminUrl, "Set MWB_POSTGRES_TEST_ADMIN_URL to a disposable PostgreSQL admin database.");
  const suffix = randomBytes(6).toString("hex");
  const databaseName = `mwb_it_${suffix}`;
  const roleName = `mwb_it_runtime_${suffix}`;
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
      await verifySourceRemovalReplay({ admin, runtimeUrl });
      await verifyUploadCommitCancelRace({ admin, runtimeUrl });
      await verifyMatterJsonStoryMerge({ admin, runtimeUrl });
      await verifyTerminalExtractionReenqueue({ admin, runtimeUrl });
      await verifyConcurrentMatterNameUniqueness({ admin, runtimeUrl });
    } finally {
      await admin.end();
    }
  } finally {
    if (databaseCreated) await maintenance.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`);
    if (roleCreated) await maintenance.query(`drop role if exists ${quoteIdentifier(roleName)}`);
    await maintenance.end();
  }
});

async function verifySourceRemovalReplay({ admin, runtimeUrl }) {
  const tenantId = randomUUID();
  const matterId = randomUUID();
  const documentId = randomUUID();
  const firstEventId = randomUUID();
  const protectedEventId = randomUUID();
  const occurredAt = "2026-07-11T12:00:00.000Z";
  const idempotencyKey = `integration-source-removal-${randomUUID()}`;

  await admin.query("insert into tenants (id, name, type) values ($1, 'Integration tenant', 'internal_test')", [tenantId]);
  await admin.query("insert into matters (id, tenant_id, name) values ($1, $2, 'Replay Matter')", [matterId, tenantId]);
  await admin.query([
    "insert into documents (id, tenant_id, matter_id, file_number, file_id, original_name, status)",
    "values ($1, $2, $3, 1, 'FILE-0001', 'source.txt', 'verified')",
  ].join("\n"), [documentId, tenantId, matterId]);
  await admin.query([
    "insert into storage_objects (tenant_id, matter_id, object_key, object_role, state)",
    "values ($1, $2, 'Replay Matter/10_Library/Source Index.json', 'matter_artifact', 'verified')",
  ].join("\n"), [tenantId, matterId]);

  const runtime = new pg.Client({ connectionString: runtimeUrl });
  await runtime.connect();
  try {
    await runtime.query(buildRuntimeDbSourceRemovalMutationSql({
      tenantId,
      matterId,
      fileId: "FILE-0001",
      reason: "Integration replay check",
      idempotencyKey,
      eventId: firstEventId,
      occurredAt,
    }));

    const firstCounts = await admin.query([
      "select",
      "  (select count(*)::int from matter_events where tenant_id = $1 and idempotency_key = $2) as event_count,",
      "  (select count(*)::int from matter_artifact_currentness where tenant_id = $1 and matter_id = $3) as currentness_count",
    ].join("\n"), [tenantId, idempotencyKey, matterId]);
    assert.deepEqual(firstCounts.rows[0], { event_count: 1, currentness_count: 1 });

    await admin.query([
      "insert into matter_events (id, tenant_id, matter_id, matter_name, event_type, summary_key, actor_json, source_json, payload_json, idempotency_key, occurred_at, created_at)",
      "values ($1, $2, $3, 'Replay Matter', 'integration.currentness_protected', 'protected', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $4, now(), now())",
    ].join("\n"), [protectedEventId, tenantId, matterId, `integration-protected-${randomUUID()}`]);
    await admin.query([
      "update matter_artifact_currentness",
      "set state = 'current', dependency_state = '', reason_code = 'integration.protected', source_event_id = $1, updated_at = now()",
      "where tenant_id = $2 and matter_id = $3",
    ].join("\n"), [protectedEventId, tenantId, matterId]);

    await runtime.query(buildRuntimeDbSourceRemovalMutationSql({
      tenantId,
      matterId,
      fileId: "FILE-0001",
      reason: "Integration replay check",
      idempotencyKey,
      eventId: randomUUID(),
      occurredAt: "2026-07-11T12:05:00.000Z",
    }));
  } finally {
    await runtime.end();
  }

  const replayState = await admin.query([
    "select",
    "  (select count(*)::int from matter_events where tenant_id = $1 and idempotency_key = $2) as event_count,",
    "  (select status from documents where tenant_id = $1 and id = $3) as document_status,",
    "  (select state from matter_artifact_currentness where tenant_id = $1 and matter_id = $4) as currentness_state,",
    "  (select reason_code from matter_artifact_currentness where tenant_id = $1 and matter_id = $4) as reason_code,",
    "  (select source_event_id::text from matter_artifact_currentness where tenant_id = $1 and matter_id = $4) as source_event_id",
  ].join("\n"), [tenantId, idempotencyKey, documentId, matterId]);
  assert.deepEqual(replayState.rows[0], {
    event_count: 1,
    document_status: "removed_from_active_record",
    currentness_state: "current",
    reason_code: "integration.protected",
    source_event_id: protectedEventId,
  });
}

async function verifyUploadCommitCancelRace({ admin, runtimeUrl }) {
  const tenantId = randomUUID();
  const matterId = randomUUID();
  await admin.query("insert into tenants (id, name, type) values ($1, 'Upload race tenant', 'internal_test')", [tenantId]);
  await admin.query("insert into matters (id, tenant_id, name) values ($1, $2, 'Upload Race Matter')", [matterId, tenantId]);

  const serviceA = createRuntimeDbStorageService({ databaseUrl: runtimeUrl, tenantId });
  const serviceB = createRuntimeDbStorageService({ databaseUrl: runtimeUrl, tenantId });
  const created = await serviceA.createUploadSession({
    action: "add_files",
    matter: { id: matterId, name: "Upload Race Matter" },
    expectedFileCount: 1,
    expectedBytes: 12,
    label: "Race intake",
  });
  await serviceA.appendUploadSessionFiles({
    sessionId: created.id,
    files: [{ filename: "race.txt", bytes: Buffer.from("race payload") }],
    relativePaths: ["race.txt"],
    fileIndexes: [0],
  });

  const outcomes = await Promise.allSettled([
    serviceA.commitUploadSession(created.id),
    serviceB.cancelUploadSession(created.id),
  ]);
  assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled"));

  const state = await admin.query([
    "select us.status,",
    "  (select count(*)::int from documents d where d.tenant_id = us.tenant_id and d.upload_session_id = us.id) as document_count,",
    "  (select count(*)::int from processing_jobs pj where pj.tenant_id = us.tenant_id and pj.idempotency_key = 'upload-session:' || us.id::text || ':extract') as job_count,",
    "  (select count(*)::int from upload_session_items ui where ui.tenant_id = us.tenant_id and ui.upload_session_id = us.id and ui.payload is not null) as retained_payload_count",
    "from upload_sessions us",
    "where us.tenant_id = $1 and us.id = $2",
  ].join("\n"), [tenantId, created.id]);
  const row = state.rows[0];
  assert.ok(["committed", "cancelled"].includes(row.status));
  if (row.status === "committed") {
    assert.equal(row.document_count, 1);
    assert.equal(row.job_count, 1);
  } else {
    assert.equal(row.document_count, 0);
    assert.equal(row.job_count, 0);
  }
  assert.equal(row.retained_payload_count, 0);
}

async function verifyMatterJsonStoryMerge({ admin, runtimeUrl }) {
  const tenantId = randomUUID();
  const matterId = randomUUID();
  const matter = { id: matterId, name: "Story Merge Matter" };
  await admin.query("insert into tenants (id, name, type) values ($1, 'Story merge tenant', 'internal_test')", [tenantId]);
  await admin.query("insert into matters (id, tenant_id, name) values ($1, $2, $3)", [matterId, tenantId, matter.name]);

  const service = createRuntimeDbStorageService({ databaseUrl: runtimeUrl, tenantId });
  await service.persistMatterJson(matter, {
    matter_name: matter.name,
    intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
  });
  await service.persistMatterJson(matter, {
    matter_name: matter.name,
    intakes: [],
    brief_description: "Story generated from an earlier matter snapshot.",
  });

  const persisted = await service.readMatterJson(matter);
  assert.equal(persisted.brief_description, "Story generated from an earlier matter snapshot.");
  assert.deepEqual(persisted.intakes, [{
    intake_id: "INTAKE-01",
    intake_dir: "00_Inbox/Intake 01 - Initial",
  }]);
}

async function verifyTerminalExtractionReenqueue({ admin, runtimeUrl }) {
  const tenantId = randomUUID();
  const matterId = randomUUID();
  await admin.query("insert into tenants (id, name, type) values ($1, 'Terminal retry tenant', 'internal_test')", [tenantId]);
  await admin.query("insert into matters (id, tenant_id, name) values ($1, $2, 'Terminal Retry Matter')", [matterId, tenantId]);

  const service = createRuntimeDbStorageService({ databaseUrl: runtimeUrl, tenantId });
  const session = await service.createUploadSession({
    action: "add_files",
    matter: { id: matterId, name: "Terminal Retry Matter" },
    expectedFileCount: 1,
    expectedBytes: 13,
    label: "Retry intake",
  });
  await service.appendUploadSessionFiles({
    sessionId: session.id,
    files: [{ filename: "retry.txt", bytes: Buffer.from("retry payload") }],
    relativePaths: ["retry.txt"],
    fileIndexes: [0],
  });
  const committed = await service.commitUploadSession(session.id);
  assert.equal(committed.session.status, "committed");

  const idempotencyKey = `upload-session:${session.id}:extract`;
  await admin.query([
    "update processing_jobs",
    "set status = 'failed', attempt_count = max_attempts, started_at = now() - interval '1 minute', finished_at = now(),",
    "    error_code = 'provider.invalid_json', error_message = 'terminal integration failure',",
    "    progress_json = progress_json || '{\"failedStage\":\"extract\"}'::jsonb",
    "where tenant_id = $1 and idempotency_key = $2",
  ].join("\n"), [tenantId, idempotencyKey]);

  const replay = await service.commitUploadSession(session.id);
  assert.equal(replay.alreadyCommitted, true);

  const state = await admin.query([
    "select status, attempt_count, finished_at, error_code, error_message, (progress_json ? 'failedStage') as retained_failure",
    "from processing_jobs",
    "where tenant_id = $1 and idempotency_key = $2",
  ].join("\n"), [tenantId, idempotencyKey]);
  assert.deepEqual(state.rows[0], {
    status: "queued",
    attempt_count: 0,
    finished_at: null,
    error_code: null,
    error_message: null,
    retained_failure: false,
  });
}

async function verifyConcurrentMatterNameUniqueness({ admin, runtimeUrl }) {
  const tenantId = randomUUID();
  await admin.query("insert into tenants (id, name, type) values ($1, 'Matter-name race tenant', 'internal_test')", [tenantId]);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mwb-matter-name-race-"));
  const firstPath = path.join(tempRoot, "first.txt");
  const secondPath = path.join(tempRoot, "second.txt");
  await writeFile(firstPath, "first concurrent upload");
  await writeFile(secondPath, "second concurrent upload");
  const serviceOptions = {
    databaseUrl: runtimeUrl,
    tenantId,
    runtimeUploadParameterizedThresholdBytes: 1,
  };
  const firstService = createRuntimeDbStorageService(serviceOptions);
  const secondService = createRuntimeDbStorageService(serviceOptions);

  const outcomes = await Promise.allSettled([
    firstService.createMatterFromUploadedFiles({
      name: "Concurrent Matter",
      files: [{ index: 0, tempPath: firstPath, filename: "first.txt", bytes: 23 }],
      relativePaths: ["first.txt"],
    }),
    secondService.createMatterFromUploadedFiles({
      name: "concurrent matter",
      files: [{ index: 0, tempPath: secondPath, filename: "second.txt", bytes: 24 }],
      relativePaths: ["second.txt"],
    }),
  ]);

  assertMatterCreateRaceOutcome(outcomes);

  const exactNameOutcomes = await Promise.allSettled([
    firstService.createMatterFromUploadedFiles({
      name: "Exact Concurrent Matter",
      files: [{ index: 0, tempPath: firstPath, filename: "first.txt", bytes: 23 }],
      relativePaths: ["first.txt"],
    }),
    secondService.createMatterFromUploadedFiles({
      name: "Exact Concurrent Matter",
      files: [{ index: 0, tempPath: secondPath, filename: "second.txt", bytes: 24 }],
      relativePaths: ["second.txt"],
    }),
  ]);
  assertMatterCreateRaceOutcome(exactNameOutcomes);

  const state = await admin.query([
    "select",
    "  (select count(*)::int from matters where tenant_id = $1 and status = 'active' and lower(name) = lower('Concurrent Matter')) as case_insensitive_matter_count,",
    "  (select count(*)::int from matters where tenant_id = $1 and status = 'active' and name = 'Exact Concurrent Matter') as exact_matter_count,",
    "  (select count(*)::int from documents where tenant_id = $1) as document_count",
  ].join("\n"), [tenantId]);
  assert.deepEqual(state.rows[0], {
    case_insensitive_matter_count: 1,
    exact_matter_count: 1,
    document_count: 2,
  });
}

function assertMatterCreateRaceOutcome(outcomes) {
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.equal(rejected?.reason?.statusCode, 409, JSON.stringify({
    code: rejected?.reason?.code,
    constraint: rejected?.reason?.constraint,
    message: rejected?.reason?.message,
  }));
  assert.equal(rejected?.reason?.code, "runtime_db.upload.matter_exists");
}

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

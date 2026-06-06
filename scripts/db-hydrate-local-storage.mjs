#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  collectLocalMatterHydrationPlan,
  defaultMattersHome,
} from "./db-hydrate-local-matters.mjs";
import { collectLocalSkillHydrationPlan } from "./db-hydrate-local-skills.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { psqlConnectionArgs } from "./db-psql.mjs";

const __filename = fileURLToPath(import.meta.url);
const STORAGE_PROVIDER = "local-filesystem";
const STORAGE_BUCKET = "local-shadow";

export function parseArgs(argv = []) {
  const parsed = {
    dryRun: true,
    verify: false,
    inspect: false,
    includePayloads: false,
    json: false,
    appDir: process.cwd(),
    mattersHome: defaultMattersHome(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      parsed.verify = false;
      parsed.inspect = false;
    } else if (arg === "--apply") {
      parsed.dryRun = false;
      parsed.verify = false;
      parsed.inspect = false;
    } else if (arg === "--verify") {
      parsed.dryRun = true;
      parsed.verify = true;
      parsed.inspect = false;
    } else if (arg === "--inspect") {
      parsed.dryRun = true;
      parsed.verify = false;
      parsed.inspect = true;
    } else if (arg === "--include-payloads") {
      parsed.includePayloads = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--app-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--app-dir requires a value");
      parsed.appDir = path.resolve(value);
      i += 1;
    } else if (arg === "--matters-home") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matters-home requires a value");
      parsed.mattersHome = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function collectLocalStorageHydrationPlan({
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
  includePayloads = false,
} = {}) {
  const matterPlan = await collectLocalMatterHydrationPlan({ mattersHome });
  const skillPlan = await collectLocalSkillHydrationPlan({ appDir, mattersHome });
  const plan = buildShadowStoragePlan({ matterPlan, skillPlan, appDir, mattersHome });
  if (includePayloads) await attachLocalStoragePayloads(plan, { appDir, mattersHome });
  return plan;
}

export function buildShadowStoragePlan({
  matterPlan = {},
  skillPlan = {},
  appDir = "",
  mattersHome = "",
} = {}) {
  const tenant = matterPlan.tenant || skillPlan.tenant || {
    id: deterministicUuid("tenant:local-shadow"),
    name: "Matter Workbench Local Shadow",
    type: "internal_test",
  };
  const plan = {
    mode: "dry-run",
    databaseWrites: false,
    appDir,
    mattersHome,
    tenant,
    storageObjects: [],
    storageObjectPayloads: [],
    documentBlobs: [],
    extractionLinks: [],
    matterArtifactLinks: [],
    skillSampleLinks: [],
    warnings: [],
  };
  const objectKeys = new Set();

  for (const matter of matterPlan.matters || []) {
    appendMatterStorage(plan, { tenantId: tenant.id, matter, objectKeys });
  }
  for (const sample of skillPlan.samples || []) {
    appendSkillSampleStorage(plan, { tenantId: tenant.id, sample, objectKeys });
  }

  plan.totals = {
    storageObjects: plan.storageObjects.length,
    storageObjectPayloads: plan.storageObjectPayloads.length,
    documentBlobs: plan.documentBlobs.length,
    extractionPayloads: plan.extractionLinks.length,
    matterArtifacts: plan.matterArtifactLinks.length,
    skillSamples: plan.skillSampleLinks.length,
    warnings: plan.warnings.length,
  };
  plan.plannedRows = {
    storageObjects: plan.storageObjects.length,
    storageObjectPayloads: plan.storageObjectPayloads.length,
    documentBlobs: plan.documentBlobs.length,
    extractionStorageLinks: plan.extractionLinks.length,
    matterArtifactStorageLinks: plan.matterArtifactLinks.length,
    skillSampleStorageLinks: plan.skillSampleLinks.length,
  };
  return plan;
}

export function storageHydrationReportFromPlan(plan = {}) {
  return {
    mode: plan.mode || "dry-run",
    databaseWrites: Boolean(plan.databaseWrites),
    appDir: plan.appDir || "",
    mattersHome: plan.mattersHome || "",
    totals: plan.totals || emptyTotals(),
    plannedRows: plan.plannedRows || {},
    warnings: plan.warnings || [],
  };
}

export function buildLocalStorageHydrationSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Storage hydration plan is missing tenant.id.");
  const lines = [
    "begin;",
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, true);`,
  ];

  for (const object of plan.storageObjects || []) {
    lines.push(storageObjectSql(object));
  }
  for (const payload of plan.storageObjectPayloads || []) {
    lines.push(storageObjectPayloadSql(payload));
  }
  for (const blob of plan.documentBlobs || []) {
    lines.push(documentBlobSql(blob));
  }
  for (const link of plan.extractionLinks || []) {
    lines.push(`update extraction_records set storage_object_id = ${sqlUuid(link.storageObjectId)} where id = ${sqlUuid(link.id)} and tenant_id = current_app_tenant_id();`);
  }
  for (const link of plan.matterArtifactLinks || []) {
    lines.push(`update matter_artifacts set storage_object_id = ${sqlUuid(link.storageObjectId)} where id = ${sqlUuid(link.id)} and tenant_id = current_app_tenant_id();`);
  }
  for (const link of plan.skillSampleLinks || []) {
    lines.push(`update skill_samples set storage_object_id = ${sqlUuid(link.storageObjectId)} where id = ${sqlString(link.id)} and tenant_id = current_app_tenant_id();`);
  }

  lines.push("commit;");
  return `${lines.join("\n")}\n`;
}

export function applyLocalStorageHydrationPlan({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before applying storage shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1"], {
    input: buildLocalStorageHydrationSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  return {
    databaseWrites: true,
    insertedRows: plan?.plannedRows || {},
    stdout: result.stdout || "",
  };
}

export function buildStorageHydrationCountSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Storage hydration plan is missing tenant.id.");
  const storageIds = (plan.storageObjects || []).map((object) => object.id).filter(Boolean);
  const payloadIds = (plan.storageObjectPayloads || []).map((payload) => payload.id).filter(Boolean);
  const blobIds = (plan.documentBlobs || []).map((blob) => blob.id).filter(Boolean);
  const extractionIds = (plan.extractionLinks || []).map((link) => link.id).filter(Boolean);
  const artifactIds = (plan.matterArtifactLinks || []).map((link) => link.id).filter(Boolean);
  const sampleIds = (plan.skillSampleLinks || []).map((link) => link.id).filter(Boolean);

  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select 'storage_objects' as key, count(*)::int as count from storage_objects where id = any (" + sqlUuidArray(storageIds) + ")",
    "union all",
    "select 'storage_object_payloads' as key, count(*)::int as count from storage_object_payloads where id = any (" + sqlUuidArray(payloadIds) + ")",
    "union all",
    "select 'document_blobs' as key, count(*)::int as count from document_blobs where id = any (" + sqlUuidArray(blobIds) + ")",
    "union all",
    "select 'extraction_storage_links' as key, count(*)::int as count from extraction_records where id = any (" + sqlUuidArray(extractionIds) + ") and storage_object_id is not null",
    "union all",
    "select 'matter_artifact_storage_links' as key, count(*)::int as count from matter_artifacts where id = any (" + sqlUuidArray(artifactIds) + ") and storage_object_id is not null",
    "union all",
    "select 'skill_sample_storage_links' as key, count(*)::int as count from skill_samples where id = any (" + sqlTextArray(sampleIds) + ") and storage_object_id is not null;",
    "",
  ].join("\n");
}

export function verifyLocalStorageHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before verifying storage shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|"], {
    input: buildStorageHydrationCountSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const counts = parsePipeCounts(result.stdout || "");
  const expected = expectedStorageHydrationCounts(plan);
  const mismatches = countMismatches({ expected, counts });
  return { matched: mismatches.length === 0, expected, counts, mismatches };
}

export function buildStorageInspectionSql(plan = {}) {
  const tenantId = plan?.tenant?.id;
  if (!tenantId) throw new Error("Storage hydration plan is missing tenant.id.");
  const storageIds = (plan.storageObjects || []).map((object) => object.id).filter(Boolean);
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with role_rows as (",
    "  select object_role, count(*)::int as count",
    "  from storage_objects",
    "  where tenant_id = current_app_tenant_id()",
    `    and id = any (${sqlUuidArray(storageIds)})`,
    "  group by object_role",
    ")",
    "select coalesce(jsonb_agg(to_jsonb(role_rows) order by object_role), '[]'::jsonb)::text from role_rows;",
    "",
  ].join("\n");
}

export function inspectLocalStorageHydration({
  databaseUrl,
  plan,
  spawn = spawnSync,
} = {}) {
  if (!databaseUrl) throw new Error("Set MWB_DATABASE_URL or DATABASE_URL before inspecting storage shadow hydration.");
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: buildStorageInspectionSql(plan),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`psql failed: ${redactSecret(detail)}`);
  }
  const roles = parsePsqlJsonArray(result.stdout || "").map((row) => ({
    objectRole: stringValue(row.object_role),
    count: Number(row.count) || 0,
  }));
  return {
    tenantId: plan?.tenant?.id || "",
    roles,
    totals: {
      storageObjects: roles.reduce((sum, row) => sum + row.count, 0),
    },
  };
}

export function renderShadowStorageReport(report = {}) {
  const totals = report.totals || emptyTotals();
  const lines = [
    "Matter Workbench local storage DB hydration",
    `mode: ${report.mode || "dry-run"}`,
    `database_writes: ${report.databaseWrites ? "yes" : "no"}`,
    `matters_home: ${report.mattersHome || ""}`,
    "totals:",
    `  storage_objects: ${totals.storageObjects || 0}`,
    `  storage_object_payloads: ${totals.storageObjectPayloads || 0}`,
    `  document_blobs: ${totals.documentBlobs || 0}`,
    `  extraction_payloads: ${totals.extractionPayloads || 0}`,
    `  matter_artifacts: ${totals.matterArtifacts || 0}`,
    `  skill_samples: ${totals.skillSamples || 0}`,
    `  warnings: ${totals.warnings || 0}`,
    "planned_rows:",
    `  storage_objects: ${report.plannedRows?.storageObjects || 0}`,
    `  storage_object_payloads: ${report.plannedRows?.storageObjectPayloads || 0}`,
    `  document_blobs: ${report.plannedRows?.documentBlobs || 0}`,
    `  extraction_storage_links: ${report.plannedRows?.extractionStorageLinks || 0}`,
    `  matter_artifact_storage_links: ${report.plannedRows?.matterArtifactStorageLinks || 0}`,
    `  skill_sample_storage_links: ${report.plannedRows?.skillSampleStorageLinks || 0}`,
  ];
  for (const warning of report.warnings || []) lines.push(`warning: ${warning}`);
  return lines;
}

export function renderStorageHydrationVerification(result = {}) {
  const lines = [
    "Matter Workbench storage shadow hydration verification",
    `matched: ${result.matched ? "yes" : "no"}`,
    "row_counts:",
  ];
  for (const [key, expected] of Object.entries(result.expected || {})) {
    lines.push(`  ${key}: expected=${expected} actual=${result.counts?.[key] || 0}`);
  }
  if (result.mismatches?.length) {
    lines.push("mismatches:");
    for (const mismatch of result.mismatches) {
      lines.push(`  ${mismatch.key}: expected=${mismatch.expected} actual=${mismatch.actual}`);
    }
  }
  return lines;
}

export function renderStorageHydrationInspection(result = {}) {
  const lines = [
    "Matter Workbench storage shadow DB inspection",
    `tenant_id: ${result.tenantId || ""}`,
    `storage_objects: ${result.totals?.storageObjects || 0}`,
    "roles:",
  ];
  for (const role of result.roles || []) {
    lines.push(`  ${role.objectRole}: ${role.count}`);
  }
  if (!result.roles?.length) lines.push("  (none)");
  return lines;
}

function appendMatterStorage(plan, { tenantId, matter, objectKeys }) {
  const intakeById = new Map();
  for (const intake of matter.intakes || []) {
    if (intake.id) intakeById.set(intake.id, intake);
    if (intake.intakeId) intakeById.set(intake.intakeId, intake);
  }

  for (const document of matter.documents || []) {
    const originalPath = stringValue(document.originalPath);
    const workingCopyPath = stringValue(document.workingCopyPath || document.sourcePath);
    if (originalPath) {
      appendDocumentBlob(plan, { tenantId, matter, document, relativePath: originalPath, blobKind: "original", role: "source_original", objectKeys });
    }
    if (workingCopyPath) {
      appendDocumentBlob(plan, { tenantId, matter, document, relativePath: workingCopyPath, blobKind: "normalized_working_copy", role: "source_working_copy", objectKeys });
    }
  }

  for (const extraction of matter.extractions || []) {
    const intake = intakeById.get(extraction.intakeId);
    const document = (matter.documents || []).find((item) => item.fileId === extraction.fileId);
    if (!intake || !document) continue;
    const objectKey = matterObjectKey(matter, `${intake.intakeDir}/_extracted/${extraction.fileId}.json`);
    const storage = storageObject({
      tenantId,
      matterId: matter.id,
      objectKey,
      objectRole: "extraction_payload",
      sha256: stringValue(extraction.sha256 || document.sha256),
      idSeed: `storage:extraction:${extraction.id}:${objectKey}`,
    });
    addStorageObject(plan, storage, objectKeys);
    plan.extractionLinks.push({ id: extraction.id, storageObjectId: storage.id, objectKey });
  }

  appendArtifactStorage(plan, { tenantId, matter, artifact: matter.artifacts?.sourceIndex, family: "source_index", format: "json", objectKeys });
  appendArtifactStorage(plan, { tenantId, matter, artifact: matter.artifacts?.listOfDates, family: "list_of_dates", format: "json", objectKeys });
}

export async function attachLocalStoragePayloads(plan, {
  appDir = plan.appDir || process.cwd(),
  mattersHome = plan.mattersHome || defaultMattersHome(),
} = {}) {
  const existing = new Set((plan.storageObjectPayloads || []).map((payload) => payload.storageObjectId));
  for (const object of plan.storageObjects || []) {
    if (!object?.id || existing.has(object.id)) continue;
    const filePath = localFilePathForStorageObject(object, { appDir, mattersHome });
    try {
      const bytes = await readFile(filePath);
      const payload = storageObjectPayload({ object, bytes });
      plan.storageObjectPayloads.push(payload);
      existing.add(object.id);
    } catch (cause) {
      const code = cause?.code ? ` (${cause.code})` : "";
      plan.warnings.push(`payload missing for ${object.objectKey}${code}`);
    }
  }
  refreshStoragePlanTotals(plan);
  return plan;
}

function refreshStoragePlanTotals(plan) {
  plan.totals = {
    ...(plan.totals || emptyTotals()),
    storageObjects: plan.storageObjects?.length || 0,
    storageObjectPayloads: plan.storageObjectPayloads?.length || 0,
    documentBlobs: plan.documentBlobs?.length || 0,
    extractionPayloads: plan.extractionLinks?.length || 0,
    matterArtifacts: plan.matterArtifactLinks?.length || 0,
    skillSamples: plan.skillSampleLinks?.length || 0,
    warnings: plan.warnings?.length || 0,
  };
  plan.plannedRows = {
    ...(plan.plannedRows || {}),
    storageObjects: plan.storageObjects?.length || 0,
    storageObjectPayloads: plan.storageObjectPayloads?.length || 0,
    documentBlobs: plan.documentBlobs?.length || 0,
    extractionStorageLinks: plan.extractionLinks?.length || 0,
    matterArtifactStorageLinks: plan.matterArtifactLinks?.length || 0,
    skillSampleStorageLinks: plan.skillSampleLinks?.length || 0,
  };
}

function localFilePathForStorageObject(object, { appDir, mattersHome }) {
  const objectKey = normalizeRelativePath(object.objectKey);
  const parts = objectKey.split("/").filter(Boolean);
  if (object.objectRole === "skill_sample" && parts[0] === "local-skill-samples") {
    return path.join(appDir, ...parts);
  }
  return path.join(mattersHome, ...parts);
}

function storageObjectPayload({ object, bytes }) {
  return {
    id: deterministicUuid(`storage-payload:${object.id}`),
    tenantId: object.tenantId,
    matterId: object.matterId,
    storageObjectId: object.id,
    objectKey: object.objectKey,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    payloadHex: Buffer.from(bytes).toString("hex"),
  };
}

function appendDocumentBlob(plan, { tenantId, matter, document, relativePath, blobKind, role, objectKeys }) {
  const objectKey = matterObjectKey(matter, relativePath);
  const storage = storageObject({
    tenantId,
    matterId: matter.id,
    objectKey,
    objectRole: role,
    mimeType: mimeTypeFor(document.originalName || relativePath, document.category),
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
    idSeed: `storage:${blobKind}:${document.id}:${objectKey}`,
  });
  addStorageObject(plan, storage, objectKeys);
  plan.documentBlobs.push({
    id: deterministicUuid(`document-blob:${document.id}:${blobKind}:${objectKey}`),
    tenantId,
    matterId: matter.id,
    documentId: document.id,
    storageObjectId: storage.id,
    blobKind,
    objectKey,
    mimeType: storage.mimeType,
    sizeBytes: positiveInteger(document.sizeBytes, 0),
    sha256: stringValue(document.sha256),
    state: "verified",
  });
}

function appendArtifactStorage(plan, { tenantId, matter, artifact, family, format, objectKeys }) {
  if (!artifact?.present || !artifact.path) return;
  const objectKey = matterObjectKey(matter, artifact.path);
  const storage = storageObject({
    tenantId,
    matterId: matter.id,
    objectKey,
    objectRole: "matter_artifact",
    mimeType: mimeTypeFor(artifact.path, ""),
    idSeed: `storage:artifact:${matter.id}:${family}:${format}:${objectKey}`,
  });
  addStorageObject(plan, storage, objectKeys);
  plan.matterArtifactLinks.push({
    id: deterministicUuid(`artifact:${matter.id}:${family}:${format}`),
    storageObjectId: storage.id,
    objectKey,
  });
}

function appendSkillSampleStorage(plan, { tenantId, sample, objectKeys }) {
  const objectKey = stringValue(sample.sampleMarkdownObjectKey);
  if (!objectKey) return;
  const storage = storageObject({
    tenantId,
    matterId: stringValue(sample.matterId),
    objectKey,
    objectRole: "skill_sample",
    mimeType: "text/markdown",
    sha256: stringValue(sample.sampleHash),
    idSeed: `storage:skill-sample:${sample.id}:${objectKey}`,
  });
  addStorageObject(plan, storage, objectKeys);
  plan.skillSampleLinks.push({
    id: sample.id,
    storageObjectId: storage.id,
    objectKey,
  });
}

function addStorageObject(plan, storage, objectKeys) {
  if (objectKeys.has(storage.objectKey)) return;
  objectKeys.add(storage.objectKey);
  plan.storageObjects.push(storage);
}

function storageObject({
  tenantId,
  matterId = "",
  objectKey,
  objectRole,
  mimeType = "",
  sizeBytes = null,
  sha256 = "",
  idSeed,
}) {
  return {
    id: deterministicUuid(idSeed),
    tenantId,
    matterId,
    objectKey,
    bucket: STORAGE_BUCKET,
    storageProvider: STORAGE_PROVIDER,
    objectRole,
    state: "verified",
    mimeType: stringValue(mimeType),
    sizeBytes: numberOrNull(sizeBytes),
    sha256: stringValue(sha256),
    idempotencyKey: `local-shadow:${objectKey}`,
  };
}

function storageObjectSql(object) {
  return `insert into storage_objects (id, tenant_id, matter_id, object_key, bucket, storage_provider, object_role, state, mime_type, size_bytes, sha256, idempotency_key, uploaded_at, verified_at) values (${sqlUuid(object.id)}, ${sqlUuid(object.tenantId)}, ${sqlUuidOrNull(object.matterId)}, ${sqlString(object.objectKey)}, ${sqlString(object.bucket)}, ${sqlString(object.storageProvider)}, ${sqlString(object.objectRole)}, ${sqlString(object.state)}, ${sqlStringOrNull(object.mimeType)}, ${sqlIntegerOrNull(object.sizeBytes)}, ${sqlStringOrNull(object.sha256)}, ${sqlString(object.idempotencyKey)}, now(), now()) on conflict (tenant_id, object_key) do update set matter_id = excluded.matter_id, bucket = excluded.bucket, storage_provider = excluded.storage_provider, object_role = excluded.object_role, state = excluded.state, mime_type = excluded.mime_type, size_bytes = excluded.size_bytes, sha256 = excluded.sha256, idempotency_key = excluded.idempotency_key, uploaded_at = excluded.uploaded_at, verified_at = excluded.verified_at;`;
}

function documentBlobSql(blob) {
  return `insert into document_blobs (id, tenant_id, matter_id, document_id, blob_kind, object_key, mime_type, size_bytes, sha256, state, storage_object_id, verified_at) values (${sqlUuid(blob.id)}, ${sqlUuid(blob.tenantId)}, ${sqlUuid(blob.matterId)}, ${sqlUuid(blob.documentId)}, ${sqlString(blob.blobKind)}, ${sqlString(blob.objectKey)}, ${sqlStringOrNull(blob.mimeType)}, ${sqlInteger(blob.sizeBytes, 0)}, ${sqlStringOrNull(blob.sha256)}, ${sqlString(blob.state)}, ${sqlUuid(blob.storageObjectId)}, now()) on conflict (tenant_id, object_key) do update set blob_kind = excluded.blob_kind, mime_type = excluded.mime_type, size_bytes = excluded.size_bytes, sha256 = excluded.sha256, state = excluded.state, storage_object_id = excluded.storage_object_id, verified_at = excluded.verified_at;`;
}

function storageObjectPayloadSql(payload) {
  return `insert into storage_object_payloads (id, tenant_id, matter_id, storage_object_id, payload, sha256, size_bytes, verified_at) values (${sqlUuid(payload.id)}, ${sqlUuid(payload.tenantId)}, ${sqlUuidOrNull(payload.matterId)}, ${sqlUuid(payload.storageObjectId)}, decode(${sqlString(payload.payloadHex)}, 'hex'), ${sqlString(payload.sha256)}, ${sqlInteger(payload.sizeBytes, 0)}, now()) on conflict (tenant_id, storage_object_id) do update set matter_id = excluded.matter_id, payload = excluded.payload, sha256 = excluded.sha256, size_bytes = excluded.size_bytes, verified_at = excluded.verified_at;`;
}

function expectedStorageHydrationCounts(plan = {}) {
  return {
    storage_objects: plan.plannedRows?.storageObjects || 0,
    storage_object_payloads: plan.plannedRows?.storageObjectPayloads || 0,
    document_blobs: plan.plannedRows?.documentBlobs || 0,
    extraction_storage_links: plan.plannedRows?.extractionStorageLinks || 0,
    matter_artifact_storage_links: plan.plannedRows?.matterArtifactStorageLinks || 0,
    skill_sample_storage_links: plan.plannedRows?.skillSampleStorageLinks || 0,
  };
}

function countMismatches({ expected = {}, counts = {} } = {}) {
  const mismatches = [];
  for (const [key, expectedCount] of Object.entries(expected)) {
    const actual = counts[key] || 0;
    if (actual !== expectedCount) mismatches.push({ key, expected: expectedCount, actual });
  }
  return mismatches;
}

function parsePipeCounts(stdout = "") {
  const counts = {};
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("|")) continue;
    const [key, value] = trimmed.split("|");
    const count = Number.parseInt(value, 10);
    if (!key || !Number.isFinite(count)) continue;
    counts[key] = count;
  }
  return counts;
}

function parsePsqlJsonArray(stdout = "") {
  const text = String(stdout || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("psql inspection returned no JSON storage summary.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("psql inspection returned a non-array storage summary.");
  return parsed;
}

function emptyTotals() {
  return {
    storageObjects: 0,
    storageObjectPayloads: 0,
    documentBlobs: 0,
    extractionPayloads: 0,
    matterArtifacts: 0,
    skillSamples: 0,
    warnings: 0,
  };
}

function matterObjectKey(matter, relativePath) {
  return `${stringValue(matter.folderName || matter.name)}/${normalizeRelativePath(relativePath)}`;
}

function normalizeRelativePath(value) {
  return stringValue(value).replaceAll("\\", "/").replace(/^\/+/, "");
}

function mimeTypeFor(fileName, category = "") {
  const ext = path.extname(stringValue(fileName)).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".json") return "application/json";
  if (ext === ".md") return "text/markdown";
  if (ext === ".txt") return "text/plain";
  if (ext === ".csv") return "text/csv";
  if (ext === ".eml") return "message/rfc822";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/pdf/i.test(category)) return "application/pdf";
  return "";
}

function positiveInteger(value, fallback = 0) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function numberOrNull(value) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function sqlUuidOrNull(value) {
  const text = stringValue(value);
  return text ? sqlUuid(text) : "null";
}

function sqlUuidArray(values = []) {
  if (!values.length) return "ARRAY[]::uuid[]";
  return `ARRAY[${values.map((value) => sqlUuid(value)).join(", ")}]`;
}

function sqlTextArray(values = []) {
  if (!values.length) return "ARRAY[]::text[]";
  return `ARRAY[${values.map((value) => sqlString(value)).join(", ")}]::text[]`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlStringOrNull(value) {
  const text = stringValue(value);
  return text ? sqlString(text) : "null";
}

function sqlInteger(value, fallback = 0) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? String(number) : String(fallback);
}

function sqlIntegerOrNull(value) {
  return value === null || value === undefined ? "null" : sqlInteger(value, 0);
}

function redactSecret(value) {
  return String(value || "").replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@");
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseArgs(process.argv.slice(2));
  const plan = await collectLocalStorageHydrationPlan({
    appDir: args.appDir,
    mattersHome: args.mattersHome,
    includePayloads: args.includePayloads,
  });
  if (args.inspect) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = inspectLocalStorageHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderStorageHydrationInspection(result)) console.log(line);
    return;
  }
  if (args.verify) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = verifyLocalStorageHydration({ databaseUrl, plan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else for (const line of renderStorageHydrationVerification(result)) console.log(line);
    if (!result.matched) process.exitCode = 1;
    return;
  }
  if (!args.dryRun) {
    const databaseUrl = process.env.MWB_DATABASE_URL || process.env.DATABASE_URL || "";
    const result = applyLocalStorageHydrationPlan({ databaseUrl, plan });
    const report = { ...storageHydrationReportFromPlan(plan), mode: "apply", databaseWrites: true };
    if (args.json) console.log(JSON.stringify({ ...report, insertedRows: result.insertedRows }, null, 2));
    else {
      for (const line of renderShadowStorageReport(report)) console.log(line);
      console.log("storage_shadow_hydration: applied");
    }
    return;
  }
  const report = storageHydrationReportFromPlan(plan);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else for (const line of renderShadowStorageReport(report)) console.log(line);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

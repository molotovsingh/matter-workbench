import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { makeHttpError } from "../shared/safe-paths.mjs";
import { planNewMatterIdentity } from "../shared/upload-intake-planner.mjs";
import { sha256Bytes } from "./runtime-db-bytes.mjs";
import { buildMatterAddFilesAllocationSql } from "./runtime-db-storage-query-sql.mjs";
import { validateRuntimeUploadInputs } from "./runtime-db-upload-intake-planner.mjs";
import { readUploadFilePayloadBytes } from "./upload-file-payload.mjs";

export function createRuntimeDbUploadSessionStore({
  tenantId = "",
  withRuntimeDbClient,
  ensureEnabled = () => {},
  queryJson,
  actorProvider = () => null,
  persistActor = async () => {},
  normalizeMatter,
} = {}) {
  if (typeof withRuntimeDbClient !== "function") throw new Error("withRuntimeDbClient is required");
  if (typeof queryJson !== "function") throw new Error("queryJson is required");
  if (typeof normalizeMatter !== "function") throw new Error("normalizeMatter is required");

  async function createUploadSession(options = {}) {
    ensureEnabled();
    const actor = actorProvider();
    const action = normalizeUploadSessionAction(options.action);
    const expectedFileCount = positiveUploadInteger(options.expectedFileCount ?? options.fileCount, 0);
    if (expectedFileCount < 1) {
      throw makeHttpError("Upload session requires at least one expected file.", 400, "upload_session.expected_files_required");
    }
    const expectedBytes = positiveUploadInteger(options.expectedBytes, 0);
    const label = cleanUploadText(options.label, 200);

    if (action === "add_files") {
      const matter = await resolveMatter(options.matter || { name: options.matterName || options.name });
      const allocation = queryJson(buildMatterAddFilesAllocationSql({
        tenantId,
        matter,
        expectedFileCount,
        label,
        receivedDate: dateOnlyValue(options.receivedDate),
        actor,
      }));
      if (!allocation?.uploadSessionId) {
        throw makeHttpError("Runtime DB upload session allocation failed.", 503, "upload_session.allocation_failed");
      }
      await withRuntimeDbClient(async (client) => {
        await client.query([
          "update upload_sessions",
          "set action = 'add_files',",
          "    matter_name = $2,",
          "    label = $3,",
          "    metadata_json = $4::jsonb,",
          "    expected_bytes = $5::bigint,",
          "    updated_at = now()",
          "where tenant_id = current_app_tenant_id() and id = $1::uuid",
        ].join("\n"), [
          allocation.uploadSessionId,
          matter.name,
          label,
          JSON.stringify({ allocation }),
          expectedBytes,
        ]);
      });
      return readUploadSession(allocation.uploadSessionId);
    }

    const identityPlan = planNewMatterIdentity({
      name: cleanUploadText(options.name || options.matterName, 300),
      metadata: normalizeUploadMetadata(options.metadata),
    });
    const matterName = identityPlan.storageName;
    if (!matterName) throw makeHttpError("Matter name is required", 400, "upload.invalid_matter_name");
    const idempotencyKey = cleanUploadText(options.idempotencyKey, 240) || `first-class-upload:${action}:${randomUUID()}`;
    return withRuntimeDbClient(async (client) => {
      await persistActor(client, actor);
      const existing = await client.query(
        "select id from matters where tenant_id = current_app_tenant_id() and status = 'active' and lower(name) = lower($1) limit 1",
        [matterName],
      );
      if (existing.rows[0]?.id) {
        throw makeHttpError(`A matter named "${matterName}" already exists`, 409, "upload.matter_exists");
      }
      const inserted = await client.query([
        "insert into upload_sessions (tenant_id, matter_id, intake_id, idempotency_key, created_by_user_id, status, expected_file_count, action, matter_name, label, metadata_json, expected_bytes, created_at, updated_at)",
        "values (current_app_tenant_id(), null, null, $1, $2::uuid, 'pending', $3::int, 'create_matter', $4, '', $5::jsonb, $6::bigint, now(), now())",
        "on conflict (tenant_id, idempotency_key) do update set updated_at = now()",
        "returning id::text, matter_id::text, intake_id::text, idempotency_key, status, expected_file_count, action, matter_name, label, metadata_json, expected_bytes::text, received_file_count, received_bytes::text, created_at, updated_at, finished_at, committed_at, error_code, error_message",
      ].join("\n"), [
        idempotencyKey,
        actor?.id || null,
        expectedFileCount,
        matterName,
        JSON.stringify(identityPlan.metadata || {}),
        expectedBytes,
      ]);
      return normalizeUploadSessionRow(inserted.rows[0], []);
    });
  }

  async function readUploadSession(sessionId) {
    ensureEnabled();
    const session = await withRuntimeDbClient(async (client) => (
      readUploadSessionWithClient(client, sessionId, { includePayload: false }, normalizeMatter)
    ));
    if (!session) throw makeHttpError("Upload session not found.", 404, "upload_session.not_found");
    return session;
  }

  async function appendUploadSessionFiles({ sessionId, files = [], relativePaths = [], fileIndexes = [] } = {}) {
    ensureEnabled();
    const uploadFiles = Array.isArray(files) ? files : [];
    const safeRelativePaths = validateRuntimeUploadInputs({
      files: uploadFiles.map((file, index) => ({ ...file, index })),
      relativePaths,
      action: "uploading session files",
    });
    return withRuntimeDbClient(async (client) => {
      const session = await readUploadSessionWithClient(
        client,
        sessionId,
        { includePayload: false, forUpdate: true },
        normalizeMatter,
      );
      if (!session) throw makeHttpError("Upload session not found.", 404, "upload_session.not_found");
      if (["committed", "failed", "cancelled"].includes(session.status)) {
        throw makeHttpError("This upload session is no longer accepting files.", 409, "upload_session.closed");
      }
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const file = uploadFiles[index];
        const fileIndex = positiveUploadInteger(fileIndexes[index], Number.isInteger(file?.index) ? file.index : index);
        const bytes = await readUploadFilePayloadBytes(file);
        await client.query([
          "insert into upload_session_items (tenant_id, upload_session_id, file_index, relative_path, original_name, mime_type, expected_size_bytes, received_size_bytes, sha256, payload, status, created_at, updated_at)",
          "values (current_app_tenant_id(), $1::uuid, $2::int, $3, $4, $5, $6::bigint, $7::bigint, $8, $9::bytea, 'uploaded', now(), now())",
          "on conflict (tenant_id, upload_session_id, file_index) do update set",
          "  relative_path = excluded.relative_path,",
          "  original_name = excluded.original_name,",
          "  mime_type = excluded.mime_type,",
          "  expected_size_bytes = excluded.expected_size_bytes,",
          "  received_size_bytes = excluded.received_size_bytes,",
          "  sha256 = excluded.sha256,",
          "  payload = excluded.payload,",
          "  status = 'uploaded',",
          "  error_code = null,",
          "  error_message = null,",
          "  updated_at = now()",
        ].join("\n"), [
          session.id,
          fileIndex,
          safeRelativePaths[index],
          cleanUploadText(file.filename || path.posix.basename(safeRelativePaths[index]), 500),
          cleanUploadText(file.mimeType || file.type || "", 200),
          bytes.length,
          bytes.length,
          sha256Bytes(bytes),
          bytes,
        ]);
      }
      await refreshUploadSessionCounts(client, session.id);
      return readUploadSessionWithClient(client, session.id, { includePayload: false }, normalizeMatter);
    });
  }

  async function cancelUploadSessionRecord(sessionId) {
    return withRuntimeDbClient(async (client) => {
      const session = await readUploadSessionWithClient(
        client,
        sessionId,
        { includePayload: false, forUpdate: true },
        normalizeMatter,
      );
      if (!session) throw makeHttpError("Upload session not found.", 404, "upload_session.not_found");
      if (["committed", "cancelled", "failed"].includes(session.status)) return session;
      const result = await client.query([
        "update upload_sessions",
        "set status = 'cancelled',",
        "    error_code = null,",
        "    error_message = null,",
        "    finished_at = coalesce(finished_at, now()),",
        "    updated_at = now()",
        "where tenant_id = current_app_tenant_id() and id = $1::uuid",
        "  and status not in ('committed', 'cancelled', 'failed')",
        "returning id",
      ].join("\n"), [session.id]);
      if (!result.rows?.length) {
        return readUploadSessionWithClient(client, session.id, { includePayload: false }, normalizeMatter);
      }
      await client.query([
        "update upload_session_items",
        "set status = 'cancelled', payload = null, updated_at = now()",
        "where tenant_id = current_app_tenant_id() and upload_session_id = $1::uuid",
        "  and status <> 'committed'",
      ].join("\n"), [session.id]);
      return readUploadSessionWithClient(client, session.id, { includePayload: false }, normalizeMatter);
    });
  }

  async function readUploadSessionForCommit(sessionId) {
    return withRuntimeDbClient(async (client) => {
      const session = await readUploadSessionWithClient(
        client,
        sessionId,
        { includePayload: true, forUpdate: true },
        normalizeMatter,
      );
      return { session, items: session?.items || [] };
    });
  }

  async function resolveMatter(input = {}) {
    const normalized = normalizeMatter(input);
    if (normalized.id) return normalized;
    const name = normalized.name;
    if (!name) throw makeHttpError("Matter is required for add-files upload session.", 400, "upload_session.matter_required");
    const result = await withRuntimeDbClient(async (client) => client.query([
      "select id::text, name, name as matter_name, coalesce(client_name,'') as client_name, coalesce(opposite_party,'') as opposite_party, coalesce(matter_type,'') as matter_type, coalesce(jurisdiction,'') as jurisdiction, coalesce(brief_description,'') as brief_description, next_file_number",
      "from matters",
      "where tenant_id = current_app_tenant_id() and status = 'active' and lower(name) = lower($1)",
      "limit 1",
    ].join("\n"), [name]));
    const row = result.rows[0];
    if (!row) throw makeHttpError(`Matter not found in runtime database: ${name}`, 404, "runtime_db.upload.matter_not_found");
    return normalizeMatter({
      id: row.id,
      name: row.name,
      matterName: row.matter_name,
      clientName: row.client_name,
      oppositeParty: row.opposite_party,
      matterType: row.matter_type,
      jurisdiction: row.jurisdiction,
      briefDescription: row.brief_description,
      nextFileNumber: row.next_file_number,
    });
  }

  return {
    appendUploadSessionFiles,
    cancelUploadSessionRecord,
    createUploadSession,
    readUploadSession,
    readUploadSessionForCommit,
  };
}

async function readUploadSessionWithClient(
  client,
  sessionId,
  { includePayload = false, forUpdate = false } = {},
  normalizeMatter = null,
) {
  const sessionResult = await client.query([
    "select us.id::text, us.matter_id::text, us.intake_id::text, us.idempotency_key, us.status, us.expected_file_count, us.action, us.matter_name, us.label, us.metadata_json, us.expected_bytes::text, us.received_file_count, us.received_bytes::text, us.created_at, us.updated_at, us.finished_at, us.committed_at, us.error_code, us.error_message,",
    "       case when m.id is null then null else jsonb_build_object('id', m.id::text, 'name', m.name, 'matterName', m.name, 'clientName', coalesce(m.client_name,''), 'oppositeParty', coalesce(m.opposite_party,''), 'matterType', coalesce(m.matter_type,''), 'jurisdiction', coalesce(m.jurisdiction,''), 'briefDescription', coalesce(m.brief_description,'')) end as matter",
    "from upload_sessions us",
    "left join matters m on m.id = us.matter_id and m.tenant_id = us.tenant_id",
    "where us.tenant_id = current_app_tenant_id() and us.id = $1::uuid",
    forUpdate ? "for update of us" : "",
  ].filter(Boolean).join("\n"), [sessionId]);
  const row = sessionResult.rows[0];
  if (!row) return null;
  const itemColumns = includePayload
    ? "id::text, file_index, relative_path, original_name, mime_type, expected_size_bytes::text, received_size_bytes::text, sha256, payload, status, error_code, error_message, created_at, updated_at"
    : "id::text, file_index, relative_path, original_name, mime_type, expected_size_bytes::text, received_size_bytes::text, sha256, null::bytea as payload, status, error_code, error_message, created_at, updated_at";
  const itemsResult = await client.query([
    `select ${itemColumns}`,
    "from upload_session_items",
    "where tenant_id = current_app_tenant_id() and upload_session_id = $1::uuid",
    "order by file_index asc",
  ].join("\n"), [row.id]);
  return normalizeUploadSessionRow(row, itemsResult.rows.map(normalizeUploadSessionItemRow), normalizeMatter);
}

async function refreshUploadSessionCounts(client, sessionId) {
  await client.query([
    "with counts as (",
    "  select count(*) filter (where status in ('uploaded','verified','committed'))::int as received_file_count,",
    "         coalesce(sum(received_size_bytes) filter (where status in ('uploaded','verified','committed')), 0)::bigint as received_bytes",
    "  from upload_session_items",
    "  where tenant_id = current_app_tenant_id() and upload_session_id = $1::uuid",
    ")",
    "update upload_sessions us",
    "set received_file_count = c.received_file_count,",
    "    received_bytes = c.received_bytes,",
    "    status = case when c.received_file_count >= us.expected_file_count then 'uploaded' else 'uploading' end,",
    "    updated_at = now()",
    "from counts c",
    "where us.tenant_id = current_app_tenant_id() and us.id = $1::uuid",
  ].join("\n"), [sessionId]);
}

export function normalizeUploadSessionRow(row = {}, items = [], normalizeMatter = null) {
  const expectedFileCount = Number(row.expected_file_count ?? row.expectedFileCount);
  const receivedFileCount = Number(row.received_file_count ?? row.receivedFileCount);
  const expectedBytes = Number(row.expected_bytes ?? row.expectedBytes);
  const receivedBytes = Number(row.received_bytes ?? row.receivedBytes);
  return {
    id: stringValue(row.id),
    matterId: stringValue(row.matter_id ?? row.matterId),
    intakeId: stringValue(row.intake_id ?? row.intakeId),
    idempotencyKey: stringValue(row.idempotency_key ?? row.idempotencyKey),
    status: stringValue(row.status) || "pending",
    action: stringValue(row.action) || "create_matter",
    matterName: stringValue(row.matter_name ?? row.matterName),
    label: stringValue(row.label),
    metadata: parseUploadJsonObject(row.metadata_json ?? row.metadataJson),
    expectedFileCount: Number.isFinite(expectedFileCount) ? expectedFileCount : 0,
    expectedBytes: Number.isFinite(expectedBytes) ? expectedBytes : 0,
    receivedFileCount: Number.isFinite(receivedFileCount) ? receivedFileCount : 0,
    receivedBytes: Number.isFinite(receivedBytes) ? receivedBytes : 0,
    createdAt: isoStringOrEmpty(row.created_at ?? row.createdAt),
    updatedAt: isoStringOrEmpty(row.updated_at ?? row.updatedAt),
    finishedAt: isoStringOrEmpty(row.finished_at ?? row.finishedAt),
    committedAt: isoStringOrEmpty(row.committed_at ?? row.committedAt),
    errorCode: stringValue(row.error_code ?? row.errorCode),
    errorMessage: stringValue(row.error_message ?? row.errorMessage),
    matter: row.matter && typeof row.matter === "object"
      ? (typeof normalizeMatter === "function" ? normalizeMatter(row.matter) : row.matter)
      : null,
    items,
  };
}

function normalizeUploadSessionItemRow(row = {}) {
  const expectedSizeBytes = Number(row.expected_size_bytes ?? row.expectedSizeBytes);
  const receivedSizeBytes = Number(row.received_size_bytes ?? row.receivedSizeBytes);
  return {
    id: stringValue(row.id),
    fileIndex: positiveUploadInteger(row.file_index ?? row.fileIndex, 0),
    relativePath: stringValue(row.relative_path ?? row.relativePath),
    originalName: stringValue(row.original_name ?? row.originalName),
    mimeType: stringValue(row.mime_type ?? row.mimeType),
    expectedSizeBytes: Number.isFinite(expectedSizeBytes) ? expectedSizeBytes : 0,
    receivedSizeBytes: Number.isFinite(receivedSizeBytes) ? receivedSizeBytes : 0,
    sha256: stringValue(row.sha256),
    payload: Buffer.isBuffer(row.payload) ? row.payload : row.payload ? Buffer.from(row.payload) : null,
    status: stringValue(row.status) || "pending",
    errorCode: stringValue(row.error_code ?? row.errorCode),
    errorMessage: stringValue(row.error_message ?? row.errorMessage),
    createdAt: isoStringOrEmpty(row.created_at ?? row.createdAt),
    updatedAt: isoStringOrEmpty(row.updated_at ?? row.updatedAt),
  };
}

export function normalizeUploadMetadata(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) continue;
    if (item == null) continue;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      normalized[key] = String(item).replace(/[\r\n\t]+/g, " ").trim().slice(0, 1000);
    }
  }
  return normalized;
}

function normalizeUploadSessionAction(value) {
  return String(value || "").trim() === "add_files" ? "add_files" : "create_matter";
}

function positiveUploadInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
}

function cleanUploadText(value, maxLength = 200) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function dateOnlyValue(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function parseUploadJsonObject(value) {
  if (!value) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isoStringOrEmpty(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : String(value);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

import { Buffer } from "node:buffer";

import { runtimeArtifactMetadataForRow } from "./runtime-db-artifact-policy.mjs";
import {
  normalizeRuntimeObjectKey,
  runtimeObjectKeyForMatterPath,
} from "./runtime-db-object-key-policy.mjs";
import { wrapRuntimeDbWriteTransaction } from "./runtime-db-sql-safety.mjs";
import {
  deterministicUuid,
  sqlBoolean,
  sqlDateOrNull,
  sqlInteger,
  sqlNullableString,
  sqlString,
  sqlUuid,
  stringValue,
} from "./runtime-db-sql-format.mjs";

export function materializedRowsForFiles({ matter, files }) {
  const rows = [];
  for (const file of files) {
    const objectKey = runtimeObjectKeyForMatterPath({ matter, relativePath: file.relativePath });
    const storageObjectId = deterministicUuid(`runtime-storage:${matter.id}:${objectKey}`);
    const payloadId = deterministicUuid(`runtime-storage-payload:${storageObjectId}`);
    rows.push({
      relativePath: file.relativePath,
      objectKey,
      storageObjectId,
      payloadId,
      objectRole: file.objectRole,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      payloadHex: Buffer.from(file.bytes).toString("hex"),
    });
  }
  return rows;
}

export function materializedDeletionRowsForFiles({ matter, files }) {
  return files
    .map((file) => {
      const relativePath = normalizeRuntimeObjectKey(file.relativePath);
      return {
        relativePath,
        objectKey: normalizeRuntimeObjectKey(file.objectKey || runtimeObjectKeyForMatterPath({ matter, relativePath })),
      };
    })
    .filter((row) => row.relativePath && row.objectKey);
}

export function buildMaterializedFilePersistenceSql({ tenantId, matter, rows }) {
  return wrapRuntimeDbWriteTransaction([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    ...rows.flatMap((row) => [
      ...materializedFileUpsertSql({ matter, row }),
      ...matterArtifactUpsertSql({ matter, row }),
      ...extractionRecordUpsertSql({ matter, row }),
      ...sourceDescriptorUpsertSql({ matter, row }),
    ]),
    "select '{}'::jsonb::text;",
    "",
  ].join("\n"));
}

export function buildMaterializedDeletionPersistenceSql({ tenantId, matter, rows }) {
  return wrapRuntimeDbWriteTransaction([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    ...rows.flatMap((row) => materializedFileTombstoneSql({ matter, row })),
    "select '{}'::jsonb::text;",
    "",
  ].join("\n"));
}

export function summarizeMaterializedRows(rows = []) {
  return rows.map(({ relativePath, objectKey, objectRole, sizeBytes, sha256 }) => ({
    relativePath,
    objectKey,
    objectRole,
    sizeBytes,
    sha256,
  }));
}

export function summarizeMaterializedDeletionRows(rows = []) {
  return rows.map(({ relativePath, objectKey }) => ({ relativePath, objectKey }));
}

export function materializedFileUpsertSql({ matter, row }) {
  return [
    "insert into storage_objects (id, tenant_id, matter_id, object_key, bucket, storage_provider, object_role, state, mime_type, size_bytes, sha256, idempotency_key, uploaded_at, verified_at)",
    `values (${sqlUuid(row.storageObjectId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlString(row.objectKey)}, 'local-db-runtime', 'postgres', ${sqlString(row.objectRole)}, 'verified', ${sqlString(row.mimeType)}, ${sqlInteger(row.sizeBytes)}, ${sqlString(row.sha256)}, ${sqlString(`runtime-db:${row.objectKey}`)}, now(), now())`,
    "on conflict (tenant_id, object_key) do update set",
    "  matter_id = excluded.matter_id,",
    "  bucket = excluded.bucket,",
    "  storage_provider = excluded.storage_provider,",
    "  object_role = excluded.object_role,",
    "  state = excluded.state,",
    "  mime_type = excluded.mime_type,",
    "  size_bytes = excluded.size_bytes,",
    "  sha256 = excluded.sha256,",
    "  idempotency_key = excluded.idempotency_key,",
    "  uploaded_at = excluded.uploaded_at,",
    "  verified_at = excluded.verified_at;",
    "insert into storage_object_payloads (id, tenant_id, matter_id, storage_object_id, payload, sha256, size_bytes, verified_at)",
    `values (${sqlUuid(row.payloadId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(row.storageObjectId)}, decode(${sqlString(row.payloadHex)}, 'hex'), ${sqlString(row.sha256)}, ${sqlInteger(row.sizeBytes)}, now())`,
    "on conflict (tenant_id, storage_object_id) do update set",
    "  matter_id = excluded.matter_id,",
    "  payload = excluded.payload,",
    "  sha256 = excluded.sha256,",
    "  size_bytes = excluded.size_bytes,",
    "  verified_at = excluded.verified_at;",
  ];
}

function materializedFileTombstoneSql({ matter, row }) {
  return [
    "update storage_objects",
    "set state = 'deleted_pending', deleted_at = now(), updated_at = now()",
    "where tenant_id = current_app_tenant_id()",
    `  and matter_id = ${sqlUuid(matter.id)}`,
    `  and object_key = ${sqlString(row.objectKey)}`,
    "  and state in ('pending', 'uploading', 'uploaded', 'verified', 'failed', 'orphaned');",
    "update matter_artifacts",
    "set is_current = false",
    "where tenant_id = current_app_tenant_id()",
    `  and matter_id = ${sqlUuid(matter.id)}`,
    `  and object_key = ${sqlString(row.objectKey)};`,
    "update extraction_records",
    "set superseded_at = now()",
    "where tenant_id = current_app_tenant_id()",
    `  and matter_id = ${sqlUuid(matter.id)}`,
    "  and superseded_at is null",
    "  and storage_object_id in (",
    "    select id from storage_objects",
    "    where tenant_id = current_app_tenant_id()",
    `      and matter_id = ${sqlUuid(matter.id)}`,
    `      and object_key = ${sqlString(row.objectKey)}`,
    "  );",
    "update source_descriptors",
    "set superseded_at = now(), updated_at = now()",
    "where tenant_id = current_app_tenant_id()",
    `  and matter_id = ${sqlUuid(matter.id)}`,
    "  and superseded_at is null",
    "  and storage_object_id in (",
    "    select id from storage_objects",
    "    where tenant_id = current_app_tenant_id()",
    `      and matter_id = ${sqlUuid(matter.id)}`,
    `      and object_key = ${sqlString(row.objectKey)}`,
    "  );",
  ];
}

function matterArtifactUpsertSql({ matter, row }) {
  const artifact = runtimeArtifactMetadataForRow(row);
  if (!artifact) return [];
  const artifactId = deterministicUuid(`runtime-db-artifact:${matter.id}:${row.objectKey}`);
  return [
    "update matter_artifacts",
    "set is_current = false",
    "where tenant_id = current_app_tenant_id()",
    `  and matter_id = ${sqlUuid(matter.id)}`,
    `  and artifact_family = ${sqlString(artifact.family)}`,
    `  and mode = ${sqlString(artifact.mode)}`,
    `  and profile_key = ${sqlString(artifact.profileKey)}`,
    `  and format = ${sqlString(artifact.format)}`,
    `  and id <> ${sqlUuid(artifactId)};`,
    "insert into matter_artifacts (id, tenant_id, matter_id, artifact_family, mode, profile_key, format, object_key, content_hash, storage_object_id, is_current, created_at)",
    `values (${sqlUuid(artifactId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlString(artifact.family)}, ${sqlString(artifact.mode)}, ${sqlString(artifact.profileKey)}, ${sqlString(artifact.format)}, ${sqlString(row.objectKey)}, ${sqlString(row.sha256)}, ${sqlUuid(row.storageObjectId)}, true, now())`,
    "on conflict (id) do update set",
    "  object_key = excluded.object_key,",
    "  content_hash = excluded.content_hash,",
    "  storage_object_id = excluded.storage_object_id,",
    "  is_current = excluded.is_current;",
  ];
}

function extractionRecordUpsertSql({ matter, row }) {
  if (row.objectRole !== "extraction_payload") return [];
  const fileId = fileIdForExtractionPayloadPath(row.relativePath);
  if (!fileId) return [];
  const extractionId = deterministicUuid(`runtime-db-extraction:${matter.id}:${fileId}:${row.objectKey}`);
  return [
    "insert into extraction_records (id, tenant_id, matter_id, document_id, document_blob_id, status, engine, ocr_applied, needs_review, payload_object_key, content_hash, storage_object_id, created_at)",
    "values (",
    `  ${sqlUuid(extractionId)},`,
    "  current_app_tenant_id(),",
    `  ${sqlUuid(matter.id)},`,
    "  (select id from documents where tenant_id = current_app_tenant_id() and matter_id = " + sqlUuid(matter.id) + " and file_id = " + sqlString(fileId) + " limit 1),",
    "  (select db.id from document_blobs db join documents d on d.id = db.document_id and d.tenant_id = db.tenant_id where db.tenant_id = current_app_tenant_id() and db.matter_id = " + sqlUuid(matter.id) + " and d.file_id = " + sqlString(fileId) + " and db.blob_kind = 'original' order by db.created_at desc limit 1),",
    "  'succeeded',",
    "  'materialized-extract',",
    "  false,",
    "  false,",
    `  ${sqlString(row.objectKey)},`,
    `  ${sqlString(row.sha256)},`,
    `  ${sqlUuid(row.storageObjectId)},`,
    "  now()",
    ")",
    "on conflict (id) do update set",
    "  status = excluded.status,",
    "  engine = excluded.engine,",
    "  payload_object_key = excluded.payload_object_key,",
    "  content_hash = excluded.content_hash,",
    "  storage_object_id = excluded.storage_object_id;",
  ];
}

function sourceDescriptorUpsertSql({ matter, row }) {
  if (normalizeRuntimeObjectKey(row.relativePath) !== "10_Library/Source Index.json") return [];
  let artifact;
  try {
    artifact = JSON.parse(Buffer.from(row.payloadHex || "", "hex").toString("utf8"));
  } catch {
    return [];
  }
  const sources = Array.isArray(artifact?.sources) ? artifact.sources : [];
  return sources.flatMap((source) => {
    const fileId = stringValue(source.file_id || source.source_id).toUpperCase();
    if (!/^FILE-\d{4}$/.test(fileId)) return [];
    const descriptorId = deterministicUuid(`runtime-db-source-descriptor:${matter.id}:${fileId}`);
    const labelStatus = normalizeSourceLabelStatus(source.label_status);
    return [
      "insert into source_descriptors (id, tenant_id, matter_id, document_id, extraction_record_id, suggested_label, confirmed_label, label_status, label_source, document_type, document_date, needs_review, storage_object_id, created_at, updated_at)",
      "values (",
      `  ${sqlUuid(descriptorId)},`,
      "  current_app_tenant_id(),",
      `  ${sqlUuid(matter.id)},`,
      "  (select id from documents where tenant_id = current_app_tenant_id() and matter_id = " + sqlUuid(matter.id) + " and file_id = " + sqlString(fileId) + " limit 1),",
      "  (select id from extraction_records where tenant_id = current_app_tenant_id() and matter_id = " + sqlUuid(matter.id) + " and document_id = (select id from documents where tenant_id = current_app_tenant_id() and matter_id = " + sqlUuid(matter.id) + " and file_id = " + sqlString(fileId) + " limit 1) order by created_at desc limit 1),",
      `  ${sqlString(stringValue(source.source_label || source.suggested_label) || fileId)},`,
      `  ${sqlNullableString(source.confirmed_label)},`,
      `  ${sqlString(labelStatus)},`,
      `  ${sqlString(stringValue(source.label_source) || "model")},`,
      `  ${sqlString(stringValue(source.document_type))},`,
      `  ${sqlDateOrNull(source.document_date)},`,
      `  ${sqlBoolean(Boolean(source.needs_review) || labelStatus === "needs_review")},`,
      `  ${sqlUuid(row.storageObjectId)},`,
      "  now(),",
      "  now()",
      ")",
      "on conflict (id) do update set",
      "  extraction_record_id = excluded.extraction_record_id,",
      "  suggested_label = excluded.suggested_label,",
      "  confirmed_label = excluded.confirmed_label,",
      "  label_status = excluded.label_status,",
      "  label_source = excluded.label_source,",
      "  document_type = excluded.document_type,",
      "  document_date = excluded.document_date,",
      "  needs_review = excluded.needs_review,",
      "  storage_object_id = excluded.storage_object_id,",
      "  updated_at = excluded.updated_at;",
    ].join("\n");
  });
}

function normalizeSourceLabelStatus(value) {
  const status = stringValue(value);
  if (["suggested", "confirmed", "overridden", "needs_review"].includes(status)) return status;
  return "suggested";
}

function fileIdForExtractionPayloadPath(relativePath) {
  const normalized = normalizeRuntimeObjectKey(relativePath);
  const match = normalized.match(/(^|\/)\_extracted\/(FILE-\d{4})\.json$/i);
  return match ? match[2].toUpperCase() : "";
}

import path from "node:path";

import { materializedFileUpsertSql } from "./runtime-db-materialized-persistence-sql.mjs";
import { normalizeRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";
import { wrapRuntimeDbWriteTransaction } from "./runtime-db-sql-safety.mjs";
import {
  deterministicUuid,
  sqlInteger,
  sqlString,
  sqlUuid,
  sqlUuidOrNull,
  stringValue,
} from "./runtime-db-sql-format.mjs";

export function buildRuntimeUploadPersistenceSql({
  tenantId,
  actor,
  matter,
  uploadPlan,
  importItems,
  persistedRows,
  uploadSqls,
}) {
  return wrapRuntimeDbWriteTransaction([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    ...runtimeDbActorSqls({ actor, tenantId }),
    ...uploadSqls,
    ...persistedRows.flatMap((row) => materializedFileUpsertSql({ matter, row })),
    ...documentIdentityUpsertSqls({
      matter,
      intakeId: uploadPlan.intakeDbId,
      uploadSessionId: uploadPlan.uploadSessionId,
      importItems,
      persistedRows,
    }),
    ...matterImportItemUpsertSqls({ matter, importBatchId: uploadPlan.importBatchId, importItems, persistedRows }),
    "select '{}'::jsonb::text;",
    "",
  ].join("\n"));
}

export function createMatterUploadSql({
  matter,
  actor,
  intakeId,
  uploadSessionId,
  importBatchId,
  expectedFileCount,
  receivedDate,
}) {
  return [
    "insert into matters (id, tenant_id, created_by_user_id, name, client_name, opposite_party, matter_type, jurisdiction, brief_description, status, next_file_number, created_at, updated_at)",
    `values (${sqlUuid(matter.id)}, current_app_tenant_id(), ${sqlUuidOrNull(actor?.id)}, ${sqlString(matter.name)}, ${sqlString(matter.clientName)}, ${sqlString(matter.oppositeParty)}, ${sqlString(matter.matterType)}, ${sqlString(matter.jurisdiction)}, ${sqlString(matter.briefDescription)}, 'active', ${sqlInteger(expectedFileCount + 1)}, now(), now())`,
    "on conflict (id) do update set",
    "  name = excluded.name,",
    "  created_by_user_id = coalesce(matters.created_by_user_id, excluded.created_by_user_id),",
    "  client_name = excluded.client_name,",
    "  opposite_party = excluded.opposite_party,",
    "  matter_type = excluded.matter_type,",
    "  jurisdiction = excluded.jurisdiction,",
    "  brief_description = excluded.brief_description,",
    "  next_file_number = excluded.next_file_number,",
    "  updated_at = excluded.updated_at;",
    ...matterMembershipSqls({ matter, actor }),
    "insert into matter_intakes (id, tenant_id, matter_id, label, received_at, created_by_user_id, created_at)",
    `values (${sqlUuid(intakeId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, 'Initial', ${sqlString(receivedDate)}::date, ${sqlUuidOrNull(actor?.id)}, now())`,
    "on conflict (id) do nothing;",
    "insert into upload_sessions (id, tenant_id, matter_id, intake_id, idempotency_key, created_by_user_id, status, expected_file_count, created_at, finished_at)",
    `values (${sqlUuid(uploadSessionId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(intakeId)}, ${sqlString(`runtime-db-upload:${matter.id}:1`)}, ${sqlUuidOrNull(actor?.id)}, 'verified', ${sqlInteger(expectedFileCount)}, now(), now())`,
    "on conflict (tenant_id, idempotency_key) do update set status = excluded.status, expected_file_count = excluded.expected_file_count, finished_at = excluded.finished_at;",
    "insert into matter_import_batches (id, tenant_id, matter_id, created_by_user_id, source_kind, source_label, source_root_hint, collision_policy, status, idempotency_key, files_expected, files_imported, files_failed, started_at, finished_at)",
    `values (${sqlUuid(importBatchId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuidOrNull(actor?.id)}, 'zip_upload', ${sqlString(matter.name)}, ${sqlString(matter.name)}, 'fail_closed', 'succeeded', ${sqlString(`runtime-db-upload:${matter.id}:import:1`)}, ${sqlInteger(expectedFileCount)}, ${sqlInteger(expectedFileCount)}, 0, now(), now())`,
    "on conflict (tenant_id, idempotency_key) do update set files_expected = excluded.files_expected, files_imported = excluded.files_imported, files_failed = excluded.files_failed, status = excluded.status, finished_at = excluded.finished_at;",
  ];
}

export function createMatterAddFilesSql({
  matter,
  actor,
  intakeDbId,
  intakeNumber,
  uploadSessionId,
  importBatchId,
  expectedFileCount,
  label,
  receivedDate,
}) {
  const displayLabel = stringValue(label) || `Intake ${String(intakeNumber).padStart(2, "0")}`;
  return [
    ...matterMembershipSqls({ matter, actor }),
    "insert into matter_intakes (id, tenant_id, matter_id, label, received_at, created_by_user_id, created_at)",
    `values (${sqlUuid(intakeDbId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlString(displayLabel)}, ${sqlString(receivedDate)}::date, ${sqlUuidOrNull(actor?.id)}, now())`,
    "on conflict (id) do nothing;",
    "insert into upload_sessions (id, tenant_id, matter_id, intake_id, idempotency_key, created_by_user_id, status, expected_file_count, created_at, finished_at)",
    `values (${sqlUuid(uploadSessionId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(intakeDbId)}, ${sqlString(`runtime-db-upload:${matter.id}:${intakeNumber}`)}, ${sqlUuidOrNull(actor?.id)}, 'verified', ${sqlInteger(expectedFileCount)}, now(), now())`,
    "on conflict (tenant_id, idempotency_key) do update set status = excluded.status, expected_file_count = excluded.expected_file_count, finished_at = excluded.finished_at;",
    "insert into matter_import_batches (id, tenant_id, matter_id, created_by_user_id, source_kind, source_label, source_root_hint, collision_policy, status, idempotency_key, files_expected, files_imported, files_failed, started_at, finished_at)",
    `values (${sqlUuid(importBatchId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuidOrNull(actor?.id)}, 'zip_upload', ${sqlString(displayLabel)}, ${sqlString(matter.name)}, 'fail_closed', 'succeeded', ${sqlString(`runtime-db-upload:${matter.id}:import:${intakeNumber}`)}, ${sqlInteger(expectedFileCount)}, ${sqlInteger(expectedFileCount)}, 0, now(), now())`,
    "on conflict (tenant_id, idempotency_key) do update set files_expected = excluded.files_expected, files_imported = excluded.files_imported, files_failed = excluded.files_failed, status = excluded.status, finished_at = excluded.finished_at;",
  ];
}

export function runtimeDbActorSqls({ actor, tenantId }) {
  if (!actor?.id) return [];
  const tenantRole = actor.role === "superuser" || actor.role === "operator" ? "admin" : "member";
  return [
    "insert into users (id, email, name, status, created_at, updated_at)",
    `values (${sqlUuid(actor.id)}, ${sqlString(actor.email)}, ${sqlString(actor.displayName || actor.username)}, 'active', now(), now())`,
    "on conflict (id) do update set",
    "  email = excluded.email,",
    "  name = excluded.name,",
    "  status = 'active',",
    "  updated_at = excluded.updated_at;",
    "insert into tenant_memberships (id, tenant_id, user_id, role, status, created_at, updated_at)",
    `values (${sqlUuid(deterministicUuid(`runtime-db-tenant-membership:${tenantId}:${actor.id}`))}, current_app_tenant_id(), ${sqlUuid(actor.id)}, ${sqlString(tenantRole)}, 'active', now(), now())`,
    "on conflict (tenant_id, user_id) do update set",
    "  role = excluded.role,",
    "  status = excluded.status,",
    "  updated_at = excluded.updated_at;",
  ];
}

function matterMembershipSqls({ matter, actor }) {
  if (!actor?.id || !matter?.id) return [];
  return [
    "insert into matter_memberships (id, tenant_id, matter_id, user_id, role, status, created_at, updated_at)",
    `values (${sqlUuid(deterministicUuid(`runtime-db-matter-membership:${matter.id}:${actor.id}`))}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(actor.id)}, 'owner', 'active', now(), now())`,
    "on conflict (matter_id, user_id) do update set",
    "  role = excluded.role,",
    "  status = excluded.status,",
    "  updated_at = excluded.updated_at;",
  ];
}

function matterImportItemUpsertSqls({ matter, importBatchId, importItems, persistedRows }) {
  const storageByRelativePath = new Map(persistedRows.map((row) => [row.relativePath, row]));
  return importItems.map((item) => {
    const row = storageRowForImportItem(storageByRelativePath, item);
    if (!row) throw new Error(`Runtime DB upload did not persist a source payload for ${item.fileId}`);
    const documentId = documentIdForImportItem(matter, item);
    return [
      "insert into matter_import_items (id, tenant_id, import_batch_id, matter_id, document_id, storage_object_id, original_file_id, original_relative_path, source_sha256, target_file_number, target_file_id, status)",
      `values (${sqlUuid(deterministicUuid(`runtime-db-import-item:${importBatchId}:${item.relativePath}`))}, current_app_tenant_id(), ${sqlUuid(importBatchId)}, ${sqlUuid(matter.id)}, ${sqlUuid(documentId)}, ${sqlUuid(row.storageObjectId)}, ${sqlString(item.fileId)}, ${sqlString(item.originalRelativePath)}, ${sqlString(item.sha256)}, ${sqlInteger(item.fileNumber)}, ${sqlString(item.fileId)}, 'imported')`,
      "on conflict (tenant_id, import_batch_id, original_relative_path) do update set document_id = excluded.document_id, storage_object_id = excluded.storage_object_id, source_sha256 = excluded.source_sha256, target_file_number = excluded.target_file_number, target_file_id = excluded.target_file_id, status = excluded.status;",
    ].join("\n");
  });
}

function documentIdentityUpsertSqls({ matter, intakeId, uploadSessionId, importItems, persistedRows }) {
  const storageByRelativePath = new Map(persistedRows.map((row) => [row.relativePath, row]));
  return importItems.flatMap((item) => {
    const row = storageRowForImportItem(storageByRelativePath, item);
    if (!row) throw new Error(`Runtime DB upload did not persist a source payload for ${item.fileId}`);
    const documentId = documentIdForImportItem(matter, item);
    const blobId = documentBlobIdForImportItem(matter, item);
    const originalName = path.posix.basename(normalizeRuntimeObjectKey(item.originalRelativePath || item.relativePath));
    const duplicateDocumentIdSql = duplicateDocumentIdForImportItemSql({ matter, item });
    return [
      [
        "insert into documents (id, tenant_id, matter_id, intake_id, upload_session_id, file_number, file_id, original_name, category, sha256, size_bytes, duplicate_of_document_id, status)",
        `values (${sqlUuid(documentId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(intakeId)}, ${sqlUuid(uploadSessionId)}, ${sqlInteger(item.fileNumber)}, ${sqlString(item.fileId)}, ${sqlString(originalName)}, 'source_upload', ${sqlString(item.sha256)}, ${sqlInteger(row.sizeBytes)}, ${duplicateDocumentIdSql}, 'verified')`,
        "on conflict (matter_id, file_id) do update set",
        "  intake_id = excluded.intake_id,",
        "  upload_session_id = excluded.upload_session_id,",
        "  file_number = excluded.file_number,",
        "  original_name = excluded.original_name,",
        "  category = excluded.category,",
        "  sha256 = excluded.sha256,",
        "  size_bytes = excluded.size_bytes,",
        "  duplicate_of_document_id = excluded.duplicate_of_document_id,",
        "  status = excluded.status,",
        "  updated_at = now();",
      ].join("\n"),
      [
        "insert into document_blobs (id, tenant_id, matter_id, document_id, blob_kind, object_key, mime_type, size_bytes, sha256, state, storage_object_id, verified_at)",
        `values (${sqlUuid(blobId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(documentId)}, 'original', ${sqlString(row.objectKey)}, ${sqlString(row.mimeType)}, ${sqlInteger(row.sizeBytes)}, ${sqlString(row.sha256)}, 'verified', ${sqlUuid(row.storageObjectId)}, now())`,
        "on conflict (tenant_id, object_key) do update set",
        "  document_id = excluded.document_id,",
        "  blob_kind = excluded.blob_kind,",
        "  mime_type = excluded.mime_type,",
        "  size_bytes = excluded.size_bytes,",
        "  sha256 = excluded.sha256,",
        "  state = excluded.state,",
        "  storage_object_id = excluded.storage_object_id,",
        "  verified_at = excluded.verified_at;",
      ].join("\n"),
    ];
  });
}

function storageRowForImportItem(storageByRelativePath, item) {
  for (const candidate of [item.workingCopyPath, item.originalPath, item.relativePath]) {
    const normalized = normalizeRuntimeObjectKey(candidate);
    if (!normalized) continue;
    const row = storageByRelativePath.get(normalized);
    if (row) return row;
  }
  return null;
}

function documentIdForImportItem(matter, item) {
  return deterministicUuid(`runtime-db-document:${matter.id}:${item.fileId}`);
}

function documentBlobIdForImportItem(matter, item) {
  return deterministicUuid(`runtime-db-document-blob:${matter.id}:${item.fileId}:original`);
}

function duplicateDocumentIdForImportItemSql({ matter, item }) {
  const duplicateOf = stringValue(item.duplicateOf).toUpperCase();
  if (!/^FILE-\d{4}$/.test(duplicateOf) || duplicateOf === item.fileId) return "null";
  return [
    "(select id from documents",
    " where tenant_id = current_app_tenant_id()",
    `   and matter_id = ${sqlUuid(matter.id)}`,
    `   and file_id = ${sqlString(duplicateOf)}`,
    " limit 1)",
  ].join("");
}

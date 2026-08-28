import { assertSha256 } from "../../../packages/extraction-contracts/index.mjs";
import { withDocumentIntakeExtractionTenant } from "./tenant-transaction.mjs";

const AUTHORIZATION_SCHEMA = "document-intake-extraction.s3-upload-authorization-record/v1";
const TOKEN_DIGEST = /^[a-f0-9]{64}$/;

export class PostgresUploadAuthorizationStore {
  constructor({ pool } = {}) {
    if (!pool?.connect) throw new Error("PostgreSQL upload authorization store requires a pool");
    this.pool = pool;
  }

  async create(record = {}) {
    validateRecord(record);
    return withDocumentIntakeExtractionTenant(this.pool, record.tenantId, async (client) => {
      const result = await client.query([
        "update document_intake_extraction.intake_files",
        "set upload_token_digest = $4,",
        "    staged_object_key = $5,",
        "    upload_authorization_expires_at = $6::timestamptz,",
        "    upload_authorization_json = $7::jsonb",
        "where tenant_id = $1",
        "  and intake_id = $2::uuid",
        "  and file_id = $3::uuid",
        "  and expected_bytes = $8::bigint",
        "  and status = 'awaiting_upload'",
        "returning tenant_id, intake_id::text, file_id::text, expected_bytes::text, status, upload_token_digest, staged_object_key, upload_authorization_expires_at, upload_authorization_json, source_sha256, custody_receipt_json, committed_at",
      ].join("\n"), [
        record.tenantId,
        record.intakeId,
        record.fileId,
        record.tokenDigest,
        record.stagedObjectKey,
        record.expiresAt,
        JSON.stringify(record),
        record.expectedBytes,
      ]);
      if (!result.rows[0]) {
        const error = new Error("intake file was not eligible for upload authorization");
        error.code = "v4_postgres.authorization_conflict";
        throw error;
      }
      return normalizeRow(result.rows[0]);
    });
  }

  async readByTokenDigest(tokenDigest, { tenantId } = {}) {
    validateTokenDigest(tokenDigest);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "select tenant_id, intake_id::text, file_id::text, expected_bytes::text, status, upload_token_digest, staged_object_key, upload_authorization_expires_at, upload_authorization_json, source_sha256, custody_receipt_json, committed_at",
        "from document_intake_extraction.intake_files",
        "where tenant_id = $1 and upload_token_digest = $2",
        "limit 1",
      ].join("\n"), [tenantId, tokenDigest]);
      return result.rows[0] ? normalizeRow(result.rows[0]) : null;
    });
  }

  async updateByTokenDigest(tokenDigest, { tenantId, expectedStatuses = [], patch = {} } = {}) {
    validateTokenDigest(tokenDigest);
    if (!expectedStatuses.includes("authorized") && !expectedStatuses.includes("uploaded")) {
      throw new Error("PostgreSQL authorization commit requires an authorized/uploaded expected state");
    }
    if (patch.status !== "committed") throw new Error("PostgreSQL authorization store only permits terminal custody updates");
    const sha256 = assertSha256(patch.sha256, "patch.sha256");
    const bytes = positiveInteger(patch.bytes, "patch.bytes");
    const blobObjectKey = String(patch.blobObjectKey || "").trim();
    if (!blobObjectKey) throw new Error("patch.blobObjectKey is required");
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const locked = await client.query([
        "select tenant_id, intake_id::text, file_id::text, expected_bytes::text, status, upload_token_digest, staged_object_key, upload_authorization_expires_at, upload_authorization_json, source_sha256, custody_receipt_json, committed_at",
        "from document_intake_extraction.intake_files",
        "where tenant_id = $1 and upload_token_digest = $2",
        "for update",
      ].join("\n"), [tenantId, tokenDigest]);
      const current = locked.rows[0] ? normalizeRow(locked.rows[0]) : null;
      if (!current || current.status === "committed") return null;
      if (!expectedStatuses.includes(current.status) || current.expectedBytes !== bytes) return null;

      // No conflict target: source_blobs has TWO unique constraints (sha256
      // primary key and object_key), and a single-arbiter ON CONFLICT only
      // absorbs its own — two concurrent commits of the same new content raise
      // 23505 on object_key before the sha256 arbiter can swallow it. Any
      // unique collision falls through to the read-back below, which verifies
      // the surviving row matches this commit exactly or refuses custody.
      await client.query([
        "insert into document_intake_extraction.source_blobs",
        "  (sha256, object_key, bytes, verified_at, integrity_status)",
        "values ($1, $2, $3::bigint, $4::timestamptz, 'verified')",
        "on conflict do nothing",
      ].join("\n"), [sha256, blobObjectKey, bytes, patch.committedAt]);
      const blob = await client.query([
        "select object_key, bytes::text, integrity_status",
        "from document_intake_extraction.source_blobs",
        "where sha256 = $1",
      ].join("\n"), [sha256]);
      if (!blob.rows[0]
        || blob.rows[0].object_key !== blobObjectKey
        || Number(blob.rows[0].bytes) !== bytes
        || blob.rows[0].integrity_status !== "verified") {
        const error = new Error("content-addressed blob conflicts with verified custody metadata");
        error.code = "v4_postgres.blob_integrity_conflict";
        throw error;
      }

      const receiptJson = {
        ...patch,
        schemaVersion: "document-intake-extraction.custody-receipt/v1",
        tenantId,
        intakeId: current.intakeId,
        fileId: current.fileId,
      };
      const updated = await client.query([
        "update document_intake_extraction.intake_files",
        "set status = 'committed',",
        "    source_sha256 = $3,",
        "    custody_receipt_json = $4::jsonb,",
        "    committed_at = $5::timestamptz",
        "where tenant_id = $1",
        "  and upload_token_digest = $2",
        "  and status = 'awaiting_upload'",
        "returning tenant_id, intake_id::text, file_id::text, expected_bytes::text, status, upload_token_digest, staged_object_key, upload_authorization_expires_at, upload_authorization_json, source_sha256, custody_receipt_json, committed_at",
      ].join("\n"), [tenantId, tokenDigest, sha256, JSON.stringify(receiptJson), patch.committedAt]);
      if (!updated.rows[0]) return null;
      await client.query([
        "insert into document_intake_extraction.blob_tenant_references",
        "  (tenant_id, source_sha256, logical_reference_count)",
        "values ($1, $2, 1)",
        "on conflict (tenant_id, source_sha256) do update set",
        "  logical_reference_count = document_intake_extraction.blob_tenant_references.logical_reference_count + 1",
      ].join("\n"), [tenantId, sha256]);
      await client.query([
        "update document_intake_extraction.intakes",
        "set committed_file_count = committed_file_count + 1,",
        "    committed_bytes = committed_bytes + $3::bigint,",
        "    status = 'uploading_with_speculative_processing'",
        "where tenant_id = $1 and intake_id = $2::uuid",
        "  and committed_file_count < expected_file_count",
      ].join("\n"), [tenantId, current.intakeId, bytes]);
      return normalizeRow(updated.rows[0]);
    });
  }
}

function validateRecord(record) {
  if (record.schemaVersion !== AUTHORIZATION_SCHEMA) throw new Error("unsupported upload authorization record");
  for (const field of ["tenantId", "intakeId", "fileId", "stagedObjectKey", "expiresAt"]) {
    if (!String(record[field] || "").trim()) throw new Error(`${field} is required`);
  }
  validateTokenDigest(record.tokenDigest);
  positiveInteger(record.expectedBytes, "expectedBytes");
}

function normalizeRow(row) {
  const authorization = parseObject(row.upload_authorization_json);
  const receipt = parseObject(row.custody_receipt_json);
  const databaseStatus = String(row.status || "");
  const status = databaseStatus === "awaiting_upload" ? "authorized" : databaseStatus;
  return {
    ...authorization,
    ...receipt,
    schemaVersion: authorization.schemaVersion || AUTHORIZATION_SCHEMA,
    tenantId: String(row.tenant_id),
    intakeId: String(row.intake_id),
    fileId: String(row.file_id),
    expectedBytes: Number(row.expected_bytes),
    tokenDigest: String(row.upload_token_digest || ""),
    stagedObjectKey: String(row.staged_object_key || ""),
    expiresAt: iso(row.upload_authorization_expires_at),
    status,
    sha256: String(row.source_sha256 || receipt.sha256 || ""),
    blobObjectKey: String(receipt.blobObjectKey || ""),
    bytes: receipt.bytes === undefined ? undefined : Number(receipt.bytes),
    objectReused: Boolean(receipt.objectReused),
    committedAt: iso(row.committed_at) || String(receipt.committedAt || ""),
  };
}

function validateTokenDigest(value) {
  if (!TOKEN_DIGEST.test(String(value || ""))) throw new Error("upload token digest must be SHA-256");
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function iso(value) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

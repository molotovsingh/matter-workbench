import pg from "pg";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  isFilteredUploadPath,
  normalizeRelativePath,
  readJsonIfExists,
  sha256Bytes,
} from "./util.mjs";

const MAX_FILTERED_PLACEHOLDER_BYTES = 10 * 1024 * 1024;

export async function exportRuntimeUploadFixture({
  databaseUrl,
  tenantId,
  sessionId,
  batchId,
  outDir,
  force = false,
  createClient = (config) => new pg.Client(config),
} = {}) {
  if (!databaseUrl) throw new Error("runtime database URL is required");
  if (!tenantId || !sessionId || !batchId) throw new Error("tenant, session, and batch IDs are required");
  if (!outDir) throw new Error("fixture output directory is required");
  const root = path.resolve(outDir);
  if (!force && await readJsonIfExists(path.join(root, "fixture.json"))) {
    throw new Error(`fixture already exists: ${root}`);
  }

  const client = createClient({ connectionString: databaseUrl });
  await client.connect();
  let session;
  let sessionItems;
  let importedItems;
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const sessionResult = await client.query([
      "select id::text, matter_id::text, matter_name, status, expected_file_count, received_file_count, expected_bytes::text, received_bytes::text, created_at, committed_at",
      "from upload_sessions",
      "where tenant_id = current_app_tenant_id() and id = $1::uuid",
      "limit 1",
    ].join("\n"), [sessionId]);
    session = sessionResult.rows[0];
    if (!session) throw new Error(`upload session not found: ${sessionId}`);
    if (session.status !== "committed") throw new Error(`upload session is not committed: ${session.status}`);

    const itemResult = await client.query([
      "select file_index, relative_path, original_name, mime_type, expected_size_bytes::text, received_size_bytes::text, sha256, status",
      "from upload_session_items",
      "where tenant_id = current_app_tenant_id() and upload_session_id = $1::uuid",
      "order by file_index asc",
    ].join("\n"), [sessionId]);
    sessionItems = itemResult.rows;

    const importedResult = await client.query([
      "select mii.original_relative_path, mii.target_file_id, mii.document_id::text, mii.status as import_status,",
      "       coalesce(so.mime_type, '') as mime_type, sop.payload, sop.sha256 as payload_sha256, sop.size_bytes::text as payload_size_bytes,",
      "       coalesce(er.status, '') as baseline_status, coalesce(er.engine, '') as baseline_engine,",
      "       coalesce(er.page_count, 0) as baseline_page_count, coalesce(er.ocr_applied, false) as baseline_ocr_applied,",
      "       coalesce(er.needs_review, false) as baseline_needs_review",
      "from matter_import_items mii",
      "join storage_objects so on so.id = mii.storage_object_id and so.tenant_id = mii.tenant_id",
      "join storage_object_payloads sop on sop.storage_object_id = so.id and sop.tenant_id = so.tenant_id",
      "left join lateral (",
      "  select status, engine, page_count, ocr_applied, needs_review",
      "  from extraction_records",
      "  where tenant_id = mii.tenant_id and matter_id = mii.matter_id and document_id = mii.document_id and superseded_at is null",
      "  order by created_at desc",
      "  limit 1",
      ") er on true",
      "where mii.tenant_id = current_app_tenant_id() and mii.import_batch_id = $1::uuid",
      "order by mii.original_relative_path asc",
    ].join("\n"), [batchId]);
    importedItems = importedResult.rows;
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  const importedByPath = new Map(importedItems.map((item) => [normalizeRelativePath(item.original_relative_path), item]));
  await mkdir(path.join(root, "source"), { recursive: true, mode: 0o700 });
  await chmod(root, 0o700).catch(() => {});
  const files = [];
  let realFiles = 0;
  let filteredPlaceholders = 0;
  let totalBytes = 0;

  for (const item of sessionItems) {
    const relativePath = normalizeRelativePath(item.relative_path);
    const imported = importedByPath.get(relativePath);
    let bytes;
    let sourceKind;
    if (imported) {
      if (!Buffer.isBuffer(imported.payload)) throw new Error(`runtime payload missing for imported file index ${item.file_index}`);
      bytes = imported.payload;
      sourceKind = "real";
      realFiles += 1;
      const payloadSha = sha256Bytes(bytes);
      if (payloadSha !== String(imported.payload_sha256 || "") || payloadSha !== String(item.sha256 || "")) {
        throw new Error(`runtime payload hash mismatch for file index ${item.file_index}`);
      }
    } else {
      if (!isFilteredUploadPath(relativePath)) throw new Error(`unmatched non-filtered session item: ${relativePath}`);
      const expectedBytes = Number(item.received_size_bytes ?? item.expected_size_bytes) || 0;
      if (expectedBytes > MAX_FILTERED_PLACEHOLDER_BYTES) throw new Error(`filtered placeholder is unexpectedly large: ${expectedBytes}`);
      bytes = deterministicPlaceholder(expectedBytes, item.file_index);
      sourceKind = "filtered-placeholder";
      filteredPlaceholders += 1;
    }

    const sourceFile = `source/${String(item.file_index).padStart(6, "0")}.bin`;
    await writeFile(path.join(root, sourceFile), bytes, { mode: 0o600 });
    const actualSha256 = sha256Bytes(bytes);
    totalBytes += bytes.length;
    files.push({
      index: Number(item.file_index),
      relativePath,
      originalName: String(item.original_name || path.posix.basename(relativePath)),
      mimeType: String(item.mime_type || imported?.mime_type || ""),
      expectedBytes: bytes.length,
      sha256: actualSha256,
      sourceFile,
      sourceKind,
      originalSessionSha256: String(item.sha256 || ""),
      baseline: imported ? {
        targetFileId: String(imported.target_file_id || ""),
        documentId: String(imported.document_id || ""),
        importStatus: String(imported.import_status || ""),
        extractionStatus: String(imported.baseline_status || ""),
        engine: String(imported.baseline_engine || ""),
        pageCount: Number(imported.baseline_page_count) || 0,
        ocrApplied: Boolean(imported.baseline_ocr_applied),
        needsReview: Boolean(imported.baseline_needs_review),
      } : {},
    });
  }

  if (realFiles !== importedItems.length) {
    throw new Error(`fixture mapping mismatch: exported ${realFiles} real files from ${importedItems.length} imported rows`);
  }

  const fixture = {
    schemaVersion: "upload-extract-v2/fixture-v1",
    fixtureId: `runtime-session-${sessionId}`,
    generatedAt: new Date().toISOString(),
    source: {
      tenantId,
      sessionId,
      batchId,
      matterId: String(session.matter_id || ""),
      matterName: String(session.matter_name || ""),
      sessionCreatedAt: iso(session.created_at),
      sessionCommittedAt: iso(session.committed_at),
    },
    summary: {
      totalFiles: files.length,
      realFiles,
      filteredPlaceholders,
      totalBytes,
      realBytes: files.filter((file) => file.sourceKind === "real").reduce((sum, file) => sum + file.expectedBytes, 0),
    },
    files,
  };
  await atomicWriteJson(path.join(root, "fixture.json"), fixture);
  return fixture;
}

function deterministicPlaceholder(size, seed) {
  const bytes = Buffer.alloc(Math.max(0, Number(size) || 0));
  const marker = Buffer.from(`filtered-upload-placeholder-${seed}\n`);
  for (let offset = 0; offset < bytes.length; offset += marker.length) {
    marker.copy(bytes, offset, 0, Math.min(marker.length, bytes.length - offset));
  }
  return bytes;
}

function iso(value) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

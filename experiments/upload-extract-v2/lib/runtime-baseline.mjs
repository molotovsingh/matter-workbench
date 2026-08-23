import pg from "pg";
import path from "node:path";

import { parseCsv } from "../../../shared/csv.mjs";
import { atomicWriteJson, elapsedMs, summarizeNumbers } from "./util.mjs";

export async function captureRuntimeBaseline({
  databaseUrl,
  tenantId,
  matterId,
  jobId,
  extractionLogKey,
  outFile,
  createClient = (config) => new pg.Client(config),
} = {}) {
  if (!databaseUrl) throw new Error("runtime database URL is required");
  if (!tenantId || !matterId || !jobId || !extractionLogKey) throw new Error("tenant, matter, job, and extraction log key are required");
  if (!outFile) throw new Error("baseline output file is required");

  const client = createClient({ connectionString: databaseUrl });
  await client.connect();
  let job;
  let uploadSession;
  let logBytes;
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const jobResult = await client.query([
      "select id::text, kind, status, attempt_count, max_attempts, progress_json, created_at, started_at, finished_at, updated_at, error_code",
      "from processing_jobs",
      "where tenant_id = current_app_tenant_id() and id = $1::uuid and matter_id = $2::uuid",
      "limit 1",
    ].join("\n"), [jobId, matterId]);
    job = jobResult.rows[0];
    if (!job) throw new Error(`processing job not found: ${jobId}`);

    const uploadSessionId = String(job.progress_json?.uploadSessionId || "");
    if (uploadSessionId) {
      const uploadResult = await client.query([
        "select id::text, status, expected_file_count, received_file_count, expected_bytes::text, received_bytes::text, created_at, committed_at",
        "from upload_sessions",
        "where tenant_id = current_app_tenant_id() and id = $1::uuid",
        "limit 1",
      ].join("\n"), [uploadSessionId]);
      uploadSession = uploadResult.rows[0] || null;
    }

    const logResult = await client.query([
      "select sop.payload",
      "from storage_objects so",
      "join storage_object_payloads sop on sop.storage_object_id = so.id and sop.tenant_id = so.tenant_id",
      "where so.tenant_id = current_app_tenant_id() and so.matter_id = $1::uuid and so.object_key = $2",
      "limit 1",
    ].join("\n"), [matterId, extractionLogKey]);
    logBytes = logResult.rows[0]?.payload;
    if (!Buffer.isBuffer(logBytes)) throw new Error(`extraction log payload not found: ${extractionLogKey}`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  const rows = parseCsv(logBytes.toString("utf8"));
  const timings = rows.map((row) => Number(row.time_taken_ms) || 0);
  const pageCounts = rows.map((row) => Number(row.page_count) || 0);
  const baseline = {
    schemaVersion: "upload-extract-v2/baseline-v1",
    capturedAt: new Date().toISOString(),
    source: {
      tenantId,
      matterId,
      jobId,
      extractionLogKey,
    },
    upload: uploadSession ? {
      sessionId: String(uploadSession.id || ""),
      status: String(uploadSession.status || ""),
      totalFiles: Number(uploadSession.received_file_count) || 0,
      totalBytes: Number(uploadSession.received_bytes) || 0,
      startedAt: iso(uploadSession.created_at),
      finishedAt: iso(uploadSession.committed_at),
      wallMs: elapsedMs(iso(uploadSession.created_at), iso(uploadSession.committed_at)),
      clientConcurrency: 1,
    } : null,
    extraction: {
      status: String(job.status || ""),
      attemptCount: Number(job.attempt_count) || 0,
      maxAttempts: Number(job.max_attempts) || 0,
      startedAt: iso(job.started_at || job.created_at),
      finishedAt: iso(job.finished_at || job.updated_at),
      jobWallMs: elapsedMs(iso(job.started_at || job.created_at), iso(job.finished_at || job.updated_at)),
      fileProcessingMs: summarizeNumbers(timings),
      pageCounts: summarizeNumbers(pageCounts),
      totalFiles: rows.length,
      statusCounts: countBy(rows, (row) => row.status || "unknown"),
      engineCounts: countBy(rows, (row) => row.engine || "unknown"),
      ocrAppliedFiles: rows.filter((row) => truthyCsv(row.ocr_applied)).length,
      extractorConcurrency: 1,
    },
  };
  await atomicWriteJson(path.resolve(outFile), baseline);
  return baseline;
}

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = String(keyFor(item));
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function truthyCsv(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}

function iso(value) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

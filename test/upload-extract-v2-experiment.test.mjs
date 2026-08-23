import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runV2Extraction } from "../experiments/upload-extract-v2/lib/extract-runner.mjs";
import { createProviderMetrics } from "../experiments/upload-extract-v2/lib/provider-metrics.mjs";
import { buildV2BenchmarkReport } from "../experiments/upload-extract-v2/lib/report.mjs";
import { exportRuntimeUploadFixture } from "../experiments/upload-extract-v2/lib/runtime-fixture.mjs";
import { V2SessionStore } from "../experiments/upload-extract-v2/lib/session-store.mjs";
import { uploadFixture } from "../experiments/upload-extract-v2/lib/upload-client.mjs";
import { createV2UploadServer } from "../experiments/upload-extract-v2/lib/upload-server.mjs";

const silentLogger = { error() {} };

test("upload-extract v2 streams, resumes, filters, checkpoints, and resumes extraction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v2-root-"));
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "mwb-v2-fixture-"));
  const token = "v2-test-token";
  const sessionId = "test-session";
  const service = createV2UploadServer({ root, token, logger: silentLogger });
  const address = await service.listen({ port: 0 });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const files = [
      await fixtureFile(fixtureDir, 0, "folder/notice.txt", "Notice dated 20 April 2026."),
      await fixtureFile(fixtureDir, 1, "folder/response.txt", "Response dated 1 May 2026."),
      await fixtureFile(fixtureDir, 2, "folder/.DS_Store", "finder metadata", "filtered-placeholder"),
    ];
    await writeFile(path.join(fixtureDir, "fixture.json"), `${JSON.stringify({ fixtureId: "synthetic", files }, null, 2)}\n`);

    const pausedUpload = await uploadFixture({
      fixtureDir,
      baseUrl,
      token,
      sessionId,
      concurrency: 2,
      stopAfter: 1,
    });
    assert.equal(pausedUpload.state, "uploading");
    assert.equal(pausedUpload.counts.uploaded, 1);

    const committed = await uploadFixture({ fixtureDir, baseUrl, token, sessionId, concurrency: 2 });
    assert.equal(committed.state, "committed");
    assert.deepEqual(committed.counts, {
      total: 3,
      uploaded: 3,
      failed: 0,
      filtered: 1,
      extractable: 2,
      extracted: 0,
    });

    const pausedExtraction = await runV2Extraction({
      root,
      sessionId,
      concurrency: 2,
      stopAfter: 1,
      requireRealProvider: false,
      ocrProvider: null,
    });
    assert.equal(pausedExtraction.state, "paused");
    assert.equal(pausedExtraction.counts.succeeded, 1);
    assert.equal(pausedExtraction.counts.pending, 1);

    const complete = await runV2Extraction({
      root,
      sessionId,
      concurrency: 2,
      requireRealProvider: false,
      ocrProvider: null,
    });
    assert.equal(complete.state, "complete");
    assert.equal(complete.counts.succeeded, 2);
    assert.equal(complete.counts.filtered, 1);

    const session = await new V2SessionStore({ root }).readSession(sessionId);
    assert.equal(session.metrics.uploadRuns.length, 2);
    assert.equal(session.metrics.extractionRuns.length, 2);
    assert.deepEqual(
      session.files.filter((file) => file.commitDisposition === "ready").map((file) => file.extraction.attempts),
      [1, 1],
    );
    assert.equal(session.files.find((file) => file.index === 2).extraction.status, "skipped");
    assert.match(await readFile(path.join(root, "sessions", sessionId, "extracted", "000000.txt"), "utf8"), /Notice dated/);

    const beforeRuns = session.metrics.extractionRuns.length;
    await runV2Extraction({ root, sessionId, requireRealProvider: false, ocrProvider: null });
    const after = await new V2SessionStore({ root }).readSession(sessionId);
    assert.equal(after.metrics.extractionRuns.length, beforeRuns);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("upload-extract v2 finalizes interrupted run evidence and recovers only in-flight files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v2-interrupted-"));
  try {
    const store = new V2SessionStore({ root });
    const bytes = Buffer.from("source");
    await store.createSession({ id: "interrupted", files: [{
      index: 0,
      relativePath: "source.txt",
      expectedBytes: bytes.length,
      sha256: sha(bytes),
    }] });
    await store.markUploadStarted("interrupted", 0);
    await store.markUploadSucceeded("interrupted", 0, { receivedBytes: bytes.length, sha256: sha(bytes) });
    await store.commitSession("interrupted");
    await store.beginExtractionRun("interrupted", {
      runId: "crashed-run",
      startedAt: new Date(Date.now() - 1_000).toISOString(),
      concurrency: 2,
      attemptedFiles: 1,
    });
    await store.markExtractionStarted("interrupted", 0);

    const recovered = await new V2SessionStore({ root }).recoverInterruptedExtraction("interrupted");
    assert.equal(recovered.state, "paused");
    assert.equal(recovered.files[0].extraction.status, "pending");
    assert.equal(recovered.files[0].extraction.attempts, 1);
    assert.equal(recovered.metrics.recoveredInterruptedFiles, 1);
    assert.equal(recovered.metrics.extractionRuns[0].status, "interrupted");
    assert.match(recovered.metrics.extractionRuns[0].error, /interrupted/);
    assert.ok(recovered.metrics.extractionRuns[0].activeMs >= 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("upload-extract v2 captures real provider response usage without request bodies", async () => {
  const metrics = createProviderMetrics({
    env: { V2_MISTRAL_OCR_USD_PER_1000_PAGES: "1" },
    fetchImpl: async () => new Response(JSON.stringify({ usage_info: { pages_processed: 3 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  const response = await metrics.withFile(7, () => metrics.fetchImpl("https://api.mistral.ai/v1/ocr", { method: "POST" }));
  await response.json();
  const summary = await metrics.summary();

  assert.equal(summary.totalCalls, 1);
  assert.equal(summary.byProvider.mistral.pagesProcessed, 3);
  assert.equal(summary.byProvider.mistral.estimatedCostUsd, 0.003);
  assert.equal(metrics.events[0].fileIndex, 7);
  assert.equal(Object.hasOwn(metrics.events[0], "requestBody"), false);
});

test("runtime fixture export is read-only and substitutes only filtered upload entries", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-v2-export-"));
  await rm(outDir, { recursive: true, force: true });
  const realBytes = Buffer.from("real pleading text");
  const realSha = sha(realBytes);
  const queries = [];
  const fakeClient = {
    async connect() {},
    async end() {},
    async query(sql) {
      const text = String(sql);
      queries.push(text);
      if (/from upload_sessions\b/.test(text)) return { rows: [{ id: "session", matter_id: "matter", matter_name: "Matter", status: "committed" }] };
      if (/from upload_session_items\b/.test(text)) return { rows: [
        { file_index: 0, relative_path: "folder/pleading.txt", original_name: "pleading.txt", mime_type: "text/plain", expected_size_bytes: String(realBytes.length), received_size_bytes: String(realBytes.length), sha256: realSha, status: "committed" },
        { file_index: 1, relative_path: "folder/.DS_Store", original_name: ".DS_Store", mime_type: "application/octet-stream", expected_size_bytes: "7", received_size_bytes: "7", sha256: "a".repeat(64), status: "committed" },
      ] };
      if (/from matter_import_items\b/.test(text)) return { rows: [{
        original_relative_path: "folder/pleading.txt",
        target_file_id: "FILE-0001",
        document_id: "doc",
        import_status: "imported",
        mime_type: "text/plain",
        payload: realBytes,
        payload_sha256: realSha,
        payload_size_bytes: String(realBytes.length),
        baseline_status: "succeeded",
        baseline_engine: "text-v1",
        baseline_page_count: 1,
        baseline_ocr_applied: false,
        baseline_needs_review: false,
      }] };
      return { rows: [] };
    },
  };

  try {
    const fixture = await exportRuntimeUploadFixture({
      databaseUrl: "postgres://unused",
      tenantId: "tenant",
      sessionId: "session",
      batchId: "batch",
      outDir,
      createClient: () => fakeClient,
    });
    assert.equal(fixture.summary.totalFiles, 2);
    assert.equal(fixture.summary.realFiles, 1);
    assert.equal(fixture.summary.filteredPlaceholders, 1);
    assert.equal(fixture.files[0].baseline.targetFileId, "FILE-0001");
    assert.equal((await readFile(path.join(outDir, fixture.files[1].sourceFile))).length, 7);
    assert.equal(queries.some((sql) => /\binsert\b|\bupdate\b|\bdelete\b/i.test(sql)), false);
    assert.equal(queries[0].toLowerCase(), "begin read only");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("v2 report refuses a better verdict without observed paid provider calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v2-report-"));
  const baselinePath = path.join(root, "baseline.json");
  const reportPath = path.join(root, "report.json");
  try {
    const store = new V2SessionStore({ root });
    await store.createSession({ id: "report-session", files: [{
      index: 0,
      relativePath: "source.txt",
      expectedBytes: 1,
      sha256: "b".repeat(64),
      sourceKind: "real",
      baseline: { pageCount: 0 },
    }] });
    const manifestPath = path.join(root, "sessions", "report-session", "session.json");
    const session = JSON.parse(await readFile(manifestPath, "utf8"));
    session.state = "complete";
    session.files[0].upload.status = "uploaded";
    session.files[0].commitDisposition = "ready";
    session.files[0].extraction.status = "succeeded";
    session.files[0].extraction.attempts = 1;
    session.metrics.uploadRuns = [{ activeMs: 100, uploadedBytes: 1, peakRssBytes: 1, concurrency: 1 }];
    session.metrics.extractionRuns = [{ startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", activeMs: 1000, peakRssBytes: 1, concurrency: 1, provider: { totalCalls: 0, successfulCalls: 0, failedCalls: 0, byProvider: {} } }];
    await writeFile(manifestPath, `${JSON.stringify(session, null, 2)}\n`);
    await writeFile(baselinePath, `${JSON.stringify({
      upload: { wallMs: 200 },
      extraction: { fileProcessingMs: { sum: 2000 }, statusCounts: { extracted: 1 } },
    })}\n`);

    const report = await buildV2BenchmarkReport({ root, sessionId: "report-session", baselineFile: baselinePath, outFile: reportPath });
    assert.equal(report.comparison.extractionSpeedupControlled, 2);
    assert.equal(report.verdict.state, "review_required");
    assert.equal(report.verdict.realProviderCallsObserved, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixtureFile(root, index, relativePath, content, sourceKind = "real") {
  await mkdir(path.join(root, "source"), { recursive: true });
  const bytes = Buffer.from(content);
  const sourceFile = `source/${String(index).padStart(6, "0")}.bin`;
  await writeFile(path.join(root, sourceFile), bytes);
  return {
    index,
    relativePath,
    originalName: path.posix.basename(relativePath),
    mimeType: "text/plain",
    expectedBytes: bytes.length,
    sha256: sha(bytes),
    sourceFile,
    sourceKind,
  };
}

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

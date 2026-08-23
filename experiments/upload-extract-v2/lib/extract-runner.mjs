import { randomUUID } from "node:crypto";
import { copyFile, link, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { EXTRACT_ENGINE_VERSION, pickExtractor, resolveOcrProvider } from "../../../extract-engine.mjs";
import { classifyFile } from "../../../shared/matter-contract.mjs";
import { V2SessionStore } from "./session-store.mjs";
import { createProviderMetrics } from "./provider-metrics.mjs";
import {
  atomicWriteFile,
  atomicWriteJson,
  extractionRecordPath,
  extractionTextPath,
  mapWithConcurrency,
  nowIso,
  objectPath,
  positiveInteger,
  safeExperimentId,
  sha256Bytes,
} from "./util.mjs";

export async function runV2Extraction({
  root,
  sessionId,
  concurrency = 2,
  stopAfter = 0,
  env = process.env,
  requireRealProvider = true,
  fetchImpl = fetch,
  ocrProvider = PROVIDER_UNSET,
  onProgress = () => {},
} = {}) {
  if (!root) throw new Error("experiment root is required");
  const id = safeExperimentId(sessionId, "session id");
  const boundedConcurrency = positiveInteger(concurrency, 2, { max: 8 });
  const store = new V2SessionStore({ root });
  await store.recoverInterruptedExtraction(id);
  const before = await store.readSession(id);
  if (!["committed", "paused", "extracting"].includes(before.state)) {
    if (before.state === "complete") return extractionSummary(before);
    throw new Error(`session cannot extract from state ${before.state}`);
  }

  const pending = before.files.filter((file) => file.commitDisposition === "ready" && file.extraction.status === "pending");
  const selected = stopAfter > 0 ? pending.slice(0, positiveInteger(stopAfter, pending.length)) : pending;
  const hasPdf = selected.some((file) => classifyFile(file.relativePath) === "PDFs");
  if (requireRealProvider && hasPdf && (!env.MISTRAL_API_KEY || String(env.MISTRAL_OCR_ENABLED || "") !== "1")) {
    throw new Error("Real v2 PDF benchmark requires MISTRAL_API_KEY and MISTRAL_OCR_ENABLED=1");
  }

  const providerMetrics = createProviderMetrics({ env, fetchImpl });
  const resolvedOcrProvider = ocrProvider !== PROVIDER_UNSET
    ? ocrProvider
    : resolveOcrProvider({ env, fetchImpl: providerMetrics.fetchImpl });
  const runId = safeExperimentId(`extract-${Date.now()}-${randomUUID().slice(0, 8)}`, "run id");
  const startedAt = nowIso();
  const started = performance.now();
  let peakRssBytes = process.memoryUsage().rss;
  const memoryTimer = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 100);
  memoryTimer.unref?.();
  await store.beginExtractionRun(id, {
    runId,
    startedAt,
    concurrency: boundedConcurrency,
    attemptedFiles: selected.length,
  });

  let completedFiles = 0;
  let runError = "";
  try {
    await mapWithConcurrency(selected, boundedConcurrency, async (file) => {
      await store.markExtractionStarted(id, file.index);
      let result;
      try {
        result = await providerMetrics.withFile(file.index, () => extractOne({
          root,
          sessionId: id,
          file,
          ocrProvider: resolvedOcrProvider,
        }));
      } catch (error) {
        result = {
          status: "failed",
          durationMs: 0,
          engine: "",
          pageCount: 0,
          ocrApplied: false,
          outputTextBytes: 0,
          outputTextSha256: "",
          error: safeError(error),
        };
      }
      result.providerCalls = providerMetrics.callsForFile(file.index);
      await store.markExtractionFinished(id, file.index, result);
      completedFiles += 1;
      onProgress({ completedFiles, attemptedFiles: selected.length, fileIndex: file.index, status: result.status });
    });
  } catch (error) {
    runError = safeError(error);
    throw error;
  } finally {
    clearInterval(memoryTimer);
    const finishedAt = nowIso();
    const provider = await providerMetrics.summary();
    await store.finishExtractionRun(id, runId, {
      startedAt,
      finishedAt,
      wallMs: Math.round(performance.now() - started),
      activeMs: Math.round(performance.now() - started),
      concurrency: boundedConcurrency,
      attemptedFiles: selected.length,
      completedFiles,
      peakRssBytes,
      provider,
      error: runError,
      status: runError ? "failed" : (selected.length < pending.length ? "paused" : "finished"),
    });
  }

  return extractionSummary(await store.readSession(id));
}

async function extractOne({ root, sessionId, file, ocrProvider }) {
  const started = performance.now();
  const category = classifyFile(file.relativePath);
  const row = {
    file_id: file.baseline?.targetFileId || `V2-${String(file.index + 1).padStart(6, "0")}`,
    original_name: file.originalName || path.posix.basename(file.relativePath),
    category,
    sha256: file.sha256,
    working_copy_path: file.relativePath,
  };
  const route = pickExtractor(row);
  if (route.skipReason) {
    return {
      status: "skipped",
      durationMs: Math.round(performance.now() - started),
      engine: route.fingerprint || "",
      pageCount: 0,
      ocrApplied: false,
      outputTextBytes: 0,
      outputTextSha256: "",
      error: route.skipReason,
    };
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), "mwb-upload-extract-v2-"));
  try {
    const extension = safeExtension(row.original_name);
    const sourcePath = path.join(workDir, `source${extension}`);
    const storedPath = objectPath(root, sessionId, file.index);
    try {
      await link(storedPath, sourcePath);
    } catch {
      await copyFile(storedPath, sourcePath);
    }
    const extraction = await route.extractor({
      [route.pathField]: sourcePath,
      fileId: row.file_id,
      sha256: row.sha256,
      sourcePath: row.working_copy_path,
      ocrProvider,
    });
    if (extraction.failureReason) {
      return {
        status: "failed",
        durationMs: Math.round(performance.now() - started),
        engine: route.fingerprint || "",
        pageCount: Number(extraction.stats?.pageCount) || 0,
        ocrApplied: Boolean(extraction.stats?.ocrApplied),
        outputTextBytes: 0,
        outputTextSha256: "",
        error: extraction.failureReason,
      };
    }

    const text = String(extraction.flatText || "");
    const textBytes = Buffer.from(text);
    const record = {
      ...extraction.record,
      v2_experiment: {
        schema_version: "upload-extract-v2/extraction-checkpoint-v1",
        engine_version: EXTRACT_ENGINE_VERSION,
        source_index: file.index,
        source_sha256: file.sha256,
      },
    };
    await mkdir(path.dirname(extractionRecordPath(root, sessionId, file.index)), { recursive: true, mode: 0o700 });
    await atomicWriteJson(extractionRecordPath(root, sessionId, file.index), record);
    await atomicWriteFile(extractionTextPath(root, sessionId, file.index), textBytes);
    return {
      status: "succeeded",
      durationMs: Math.round(performance.now() - started),
      engine: String(extraction.record?.engine || route.fingerprint || ""),
      pageCount: Number(extraction.stats?.pageCount) || 0,
      ocrApplied: Boolean(extraction.stats?.ocrApplied),
      outputTextBytes: textBytes.length,
      outputTextSha256: sha256Bytes(textBytes),
      error: "",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export function extractionSummary(session) {
  const extractable = session.files.filter((file) => file.commitDisposition === "ready");
  const runs = session.metrics?.extractionRuns || [];
  return {
    schemaVersion: "upload-extract-v2/extraction-summary-v1",
    sessionId: session.id,
    state: session.state,
    counts: {
      totalUploadFiles: session.files.length,
      filtered: session.files.filter((file) => file.commitDisposition === "filtered").length,
      extractable: extractable.length,
      succeeded: extractable.filter((file) => file.extraction.status === "succeeded").length,
      failed: extractable.filter((file) => file.extraction.status === "failed").length,
      skipped: extractable.filter((file) => file.extraction.status === "skipped").length,
      pending: extractable.filter((file) => ["pending", "running"].includes(file.extraction.status)).length,
    },
    runs,
  };
}

const PROVIDER_UNSET = Symbol("provider-unset");

function safeExtension(name) {
  const extension = path.extname(String(name || "")).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".bin";
}

function safeError(error) {
  return String(error?.message || error || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 500);
}

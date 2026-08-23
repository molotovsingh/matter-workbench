import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  elapsedMs,
  fileExists,
  isFilteredUploadPath,
  nowIso,
  objectPath,
  normalizeRelativePath,
  readJsonIfExists,
  safeExperimentId,
  sessionDir,
  sessionManifestPath,
} from "./util.mjs";

export const V2_SESSION_SCHEMA = "upload-extract-v2/session-v1";

export class V2SessionStore {
  constructor({ root }) {
    if (!root) throw new Error("experiment root is required");
    this.root = path.resolve(root);
    this.queues = new Map();
  }

  async createSession({ id, files, fixtureId = "" }) {
    const sessionId = safeExperimentId(id, "session id");
    const descriptors = normalizeDescriptors(files);
    const fingerprint = descriptorFingerprint(descriptors);
    return this.#update(sessionId, async (current) => {
      if (current) {
        if (current.descriptorFingerprint !== fingerprint) {
          throw conflict("existing session descriptor does not match this fixture");
        }
        return current;
      }
      const createdAt = nowIso();
      return {
        schemaVersion: V2_SESSION_SCHEMA,
        id: sessionId,
        fixtureId: String(fixtureId || ""),
        descriptorFingerprint: fingerprint,
        state: "created",
        createdAt,
        updatedAt: createdAt,
        committedAt: "",
        completedAt: "",
        files: descriptors.map((file) => ({
          ...file,
          upload: {
            status: "pending",
            receivedBytes: 0,
            actualSha256: "",
            startedAt: "",
            finishedAt: "",
            durationMs: 0,
            attempts: 0,
            error: "",
          },
          commitDisposition: "pending",
          extraction: {
            status: "pending",
            startedAt: "",
            finishedAt: "",
            durationMs: 0,
            attempts: 0,
            engine: "",
            pageCount: 0,
            ocrApplied: false,
            outputTextBytes: 0,
            outputTextSha256: "",
            providerCalls: 0,
            error: "",
          },
        })),
        metrics: {
          uploadRuns: [],
          extractionRuns: [],
          recoveredInterruptedFiles: 0,
        },
      };
    });
  }

  async readSession(sessionId) {
    const id = safeExperimentId(sessionId, "session id");
    const session = await readJsonIfExists(sessionManifestPath(this.root, id));
    if (!session) throw notFound(`session not found: ${id}`);
    return session;
  }

  async uploadedFile(sessionId, fileIndex) {
    const session = await this.readSession(sessionId);
    const file = session.files.find((candidate) => candidate.index === Number(fileIndex));
    if (!file) throw notFound(`session file not found: ${fileIndex}`);
    if (file.upload.status !== "uploaded") return null;
    const storedPath = objectPath(this.root, session.id, file.index);
    if (!(await fileExists(storedPath))) return null;
    return { file, storedPath };
  }

  async markUploadStarted(sessionId, fileIndex) {
    return this.#updateFile(sessionId, fileIndex, (file, session) => {
      if (file.upload.status === "uploaded") return;
      const now = nowIso();
      file.upload.status = "uploading";
      file.upload.startedAt = now;
      file.upload.finishedAt = "";
      file.upload.durationMs = 0;
      file.upload.error = "";
      file.upload.attempts += 1;
      if (session.state === "created") session.state = "uploading";
    });
  }

  async markUploadSucceeded(sessionId, fileIndex, { receivedBytes, sha256 }) {
    return this.#updateFile(sessionId, fileIndex, (file, session) => {
      if (Number(receivedBytes) !== file.expectedBytes) throw conflict(`size mismatch for file index ${file.index}`);
      if (String(sha256) !== file.sha256) throw conflict(`SHA-256 mismatch for file index ${file.index}`);
      const finishedAt = nowIso();
      file.upload.status = "uploaded";
      file.upload.receivedBytes = Number(receivedBytes);
      file.upload.actualSha256 = String(sha256);
      file.upload.finishedAt = finishedAt;
      file.upload.durationMs = elapsedMs(file.upload.startedAt, finishedAt);
      file.upload.error = "";
      if (session.state === "created") session.state = "uploading";
    });
  }

  async markUploadFailed(sessionId, fileIndex, error) {
    return this.#updateFile(sessionId, fileIndex, (file) => {
      const finishedAt = nowIso();
      file.upload.status = "failed";
      file.upload.finishedAt = finishedAt;
      file.upload.durationMs = elapsedMs(file.upload.startedAt, finishedAt);
      file.upload.error = safeError(error);
    });
  }

  async recordUploadRun(sessionId, run) {
    return this.#update(sessionId, async (session) => {
      if (!session) throw notFound(`session not found: ${sessionId}`);
      session.metrics.uploadRuns.push(normalizeRunMetric(run));
      return session;
    });
  }

  async commitSession(sessionId) {
    return this.#update(sessionId, async (session) => {
      if (!session) throw notFound(`session not found: ${sessionId}`);
      if (["committed", "extracting", "paused", "complete"].includes(session.state)) return session;
      const missing = session.files.filter((file) => file.upload.status !== "uploaded");
      if (missing.length) throw conflict(`${missing.length} file(s) are not uploaded`);
      for (const file of session.files) {
        file.commitDisposition = isFilteredUploadPath(file.relativePath) ? "filtered" : "ready";
        file.extraction.status = file.commitDisposition === "filtered" ? "skipped" : "pending";
        if (file.commitDisposition === "filtered") file.extraction.error = "filtered before extraction";
      }
      session.state = "committed";
      session.committedAt = nowIso();
      return session;
    });
  }

  async recoverInterruptedExtraction(sessionId) {
    return this.#update(sessionId, async (session) => {
      if (!session) throw notFound(`session not found: ${sessionId}`);
      let recovered = 0;
      for (const file of session.files) {
        if (file.extraction.status !== "running") continue;
        file.extraction.status = "pending";
        file.extraction.error = "recovered after interrupted run";
        file.extraction.startedAt = "";
        file.extraction.finishedAt = "";
        file.extraction.durationMs = 0;
        recovered += 1;
      }
      session.metrics.recoveredInterruptedFiles += recovered;
      if (recovered && session.state === "extracting") session.state = "paused";
      return session;
    });
  }

  async beginExtractionRun(sessionId, run) {
    return this.#update(sessionId, async (session) => {
      if (!session) throw notFound(`session not found: ${sessionId}`);
      if (!["committed", "paused", "extracting"].includes(session.state)) {
        throw conflict(`session cannot extract from state ${session.state}`);
      }
      session.state = "extracting";
      session.metrics.extractionRuns.push({ ...normalizeRunMetric(run), status: "running" });
      return session;
    });
  }

  async markExtractionStarted(sessionId, fileIndex) {
    return this.#updateFile(sessionId, fileIndex, (file) => {
      if (file.commitDisposition !== "ready") throw conflict(`file index ${file.index} is not extractable`);
      if (file.extraction.status === "succeeded" || file.extraction.status === "skipped") return;
      file.extraction.status = "running";
      file.extraction.startedAt = nowIso();
      file.extraction.finishedAt = "";
      file.extraction.durationMs = 0;
      file.extraction.error = "";
      file.extraction.attempts += 1;
    });
  }

  async markExtractionFinished(sessionId, fileIndex, result) {
    return this.#updateFile(sessionId, fileIndex, (file) => {
      const finishedAt = nowIso();
      file.extraction.status = normalizeExtractionStatus(result.status);
      file.extraction.finishedAt = finishedAt;
      file.extraction.durationMs = Number(result.durationMs) || elapsedMs(file.extraction.startedAt, finishedAt);
      file.extraction.engine = String(result.engine || "");
      file.extraction.pageCount = Math.max(0, Number(result.pageCount) || 0);
      file.extraction.ocrApplied = Boolean(result.ocrApplied);
      file.extraction.outputTextBytes = Math.max(0, Number(result.outputTextBytes) || 0);
      file.extraction.outputTextSha256 = String(result.outputTextSha256 || "");
      file.extraction.providerCalls = Math.max(0, Number(result.providerCalls) || 0);
      file.extraction.error = safeError(result.error || "");
    });
  }

  async finishExtractionRun(sessionId, runId, patch = {}) {
    return this.#update(sessionId, async (session) => {
      if (!session) throw notFound(`session not found: ${sessionId}`);
      const run = session.metrics.extractionRuns.find((candidate) => candidate.runId === runId);
      if (!run) throw notFound(`extraction run not found: ${runId}`);
      Object.assign(run, normalizeRunMetric({ ...run, ...patch, runId }), { status: String(patch.status || "finished") });
      const pending = session.files.filter((file) => file.commitDisposition === "ready" && ["pending", "running"].includes(file.extraction.status));
      session.state = pending.length ? "paused" : "complete";
      if (!pending.length) session.completedAt = nowIso();
      return session;
    });
  }

  async #updateFile(sessionId, fileIndex, mutate) {
    return this.#update(sessionId, async (session) => {
      if (!session) throw notFound(`session not found: ${sessionId}`);
      const file = session.files.find((candidate) => candidate.index === Number(fileIndex));
      if (!file) throw notFound(`session file not found: ${fileIndex}`);
      await mutate(file, session);
      return session;
    });
  }

  async #update(sessionId, mutate) {
    const id = safeExperimentId(sessionId, "session id");
    const previous = this.queues.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const filePath = sessionManifestPath(this.root, id);
      const current = await readJsonIfExists(filePath);
      const updated = await mutate(current);
      if (!updated) throw new Error("session update returned no value");
      updated.updatedAt = nowIso();
      await mkdir(sessionDir(this.root, id), { recursive: true, mode: 0o700 });
      await atomicWriteJson(filePath, updated);
      return structuredClone(updated);
    });
    this.queues.set(id, next);
    return next;
  }
}

function normalizeDescriptors(files) {
  if (!Array.isArray(files) || !files.length) throw new Error("session requires files");
  const seenIndexes = new Set();
  const seenPaths = new Set();
  return files.map((input, position) => {
    const index = Number.isInteger(Number(input.index)) ? Number(input.index) : position;
    const relativePath = normalizeRelativePath(input.relativePath);
    const expectedBytes = Number(input.expectedBytes ?? input.size);
    const sha256 = String(input.sha256 || "").toLowerCase();
    if (index < 0 || seenIndexes.has(index)) throw new Error(`duplicate or invalid file index: ${index}`);
    if (seenPaths.has(relativePath.toLowerCase())) throw new Error(`duplicate relative path: ${relativePath}`);
    if (!Number.isFinite(expectedBytes) || expectedBytes < 0) throw new Error(`invalid size for file index ${index}`);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`invalid SHA-256 for file index ${index}`);
    seenIndexes.add(index);
    seenPaths.add(relativePath.toLowerCase());
    return {
      index,
      relativePath,
      originalName: String(input.originalName || path.posix.basename(relativePath)),
      mimeType: String(input.mimeType || ""),
      expectedBytes,
      sha256,
      sourceKind: String(input.sourceKind || "real"),
      baseline: input.baseline && typeof input.baseline === "object" ? input.baseline : {},
    };
  }).sort((a, b) => a.index - b.index);
}

function descriptorFingerprint(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${file.index}\0${file.relativePath}\0${file.expectedBytes}\0${file.sha256}\n`);
  }
  return hash.digest("hex");
}

function normalizeRunMetric(run = {}) {
  return {
    runId: safeExperimentId(run.runId || `run-${Date.now()}`, "run id"),
    startedAt: String(run.startedAt || ""),
    finishedAt: String(run.finishedAt || ""),
    wallMs: Math.max(0, Number(run.wallMs) || 0),
    activeMs: Math.max(0, Number(run.activeMs) || 0),
    concurrency: Math.max(1, Number(run.concurrency) || 1),
    attemptedFiles: Math.max(0, Number(run.attemptedFiles) || 0),
    completedFiles: Math.max(0, Number(run.completedFiles) || 0),
    uploadedBytes: Math.max(0, Number(run.uploadedBytes) || 0),
    peakRssBytes: Math.max(0, Number(run.peakRssBytes) || 0),
    provider: run.provider && typeof run.provider === "object" ? run.provider : {},
    error: safeError(run.error || ""),
  };
}

function normalizeExtractionStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["succeeded", "failed", "skipped"].includes(value)) return value;
  throw new Error(`invalid extraction terminal status: ${status}`);
}

function safeError(error) {
  return String(error?.message || error || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 500);
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import { currentRequestContext } from "./request-context.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const LEDGER_SCHEMA_VERSION = "job-status-ledger/v1";
const JOB_SCHEMA_VERSION = "job-status/v1";
const DEFAULT_LIMIT = 100;
const DEFAULT_STALE_RUNNING_JOB_MS = 30 * 60 * 1000;

export function createJobStatusService({
  appDir = process.cwd(),
  jobsPath,
  now = () => new Date(),
  idFactory = () => `job_${randomUUID()}`,
  staleRunningJobMs = DEFAULT_STALE_RUNNING_JOB_MS,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = jobsPath || path.join(root, ".local", "job-status-ledger.json");
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: (store) => formatJsonStore(normalizeStore(store)),
  });

  async function loadStore() {
    try {
      const raw = JSON.parse(await readFile(storePath, "utf8"));
      return normalizeStore(raw);
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async function writeMutatedStore(mutator) {
    return persistence.withStoreMutation(async () => {
      const store = await loadStore();
      const result = await mutator(store);
      await persistence.writeStoreFile(store);
      return result;
    });
  }

  async function createJob(input = {}) {
    return writeMutatedStore(async (store) => {
      const startedAt = isoNow(now);
      const requestContext = currentRequestContext();
      const job = normalizeJobStatus({
        schema_version: JOB_SCHEMA_VERSION,
        id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : idFactory(),
        kind: input.kind,
        label: input.label,
        matterName: input.matterName,
        matterId: input.matterId,
        status: "running",
        traceId: input.traceId || requestContext.traceId,
        requestId: input.requestId || requestContext.requestId,
        user: input.user || requestContext.user,
        startedAt,
        updatedAt: startedAt,
        metadata: sanitizeMetadata(input.metadata),
      });
      store.jobs.push(job);
      return job;
    });
  }

  async function updateJob(jobId, patch = {}) {
    return writeMutatedStore(async (store) => {
      const index = store.jobs.findIndex((job) => job.id === jobId);
      if (index < 0) throw new Error(`Job not found: ${jobId}`);
      const current = store.jobs[index];
      const updated = normalizeJobStatus({
        ...current,
        ...patch,
        metadata: sanitizeMetadata(mergeMetadata(current.metadata || {}, patch.metadata || {})),
        errorMessage: patch.errorMessage !== undefined ? sanitizeText(patch.errorMessage) : current.errorMessage,
        errorCode: patch.errorCode !== undefined ? safeErrorCode(patch.errorCode) : current.errorCode,
        updatedAt: isoNow(now),
      });
      store.jobs[index] = updated;
      return updated;
    });
  }

  async function completeJob(jobId, patch = {}) {
    return updateJob(jobId, {
      ...patch,
      status: "succeeded",
      finishedAt: isoNow(now),
    });
  }

  async function failJob(jobId, error, patch = {}) {
    const message = errorToMessage(error);
    const errorCode = safeErrorCode(patch.errorCode || error?.code);
    return updateJob(jobId, {
      ...patch,
      status: "failed",
      finishedAt: isoNow(now),
      errorMessage: message,
      ...(errorCode ? { errorCode } : {}),
      failureClass: patch.failureClass || classifyFailure(message),
    });
  }

  async function runTrackedJob({ operation, ...input } = {}) {
    if (typeof operation !== "function") throw new Error("operation is required");
    const job = await createJob(input);
    try {
      const result = await operation({ job });
      const completed = await completeJob(job.id, resultMetadata(result));
      return { result, job: completed };
    } catch (error) {
      await failJob(job.id, error);
      throw error;
    }
  }

  async function listJobs(filters = {}) {
    await finalizeStaleRunningJobs();
    const store = await loadStore();
    const limit = parseLimit(filters.limit);
    const matterName = normalizeFilter(filters.matterName || filters.matter);
    const kind = normalizeFilter(filters.kind);
    const status = normalizeFilter(filters.status);
    const jobs = store.jobs
      .filter((job) => !matterName || job.matterName === matterName)
      .filter((job) => !kind || job.kind === kind)
      .filter((job) => !status || job.status === status)
      .sort(compareNewestJobFirst)
      .slice(0, limit);
    return {
      schema_version: LEDGER_SCHEMA_VERSION,
      jobs,
    };
  }

  async function finalizeStaleRunningJobs() {
    const staleAfterMs = parsePositiveInteger(staleRunningJobMs);
    if (!staleAfterMs) return;
    await writeMutatedStore(async (store) => {
      const currentTime = now();
      const currentIso = currentTime.toISOString();
      for (const job of store.jobs) {
        if (job.status !== "running") continue;
        const lastSeenAt = Date.parse(job.updatedAt || job.startedAt || "");
        if (!Number.isFinite(lastSeenAt)) continue;
        if (currentTime.getTime() - lastSeenAt <= staleAfterMs) continue;
        job.status = "failed";
        job.finishedAt = currentIso;
        job.updatedAt = currentIso;
        job.errorMessage = sanitizeText(`Stale running job marked failed after ${Math.round(staleAfterMs / 1000)} seconds without progress.`);
      }
    });
  }

  return {
    createJob,
    updateJob,
    completeJob,
    failJob,
    runTrackedJob,
    listJobs,
  };
}

export function normalizeJobStatus(job = {}) {
  const status = normalizeStatus(job.status);
  const startedAt = normalizeIso(job.startedAt) || isoNow(() => new Date());
  const normalized = {
    schema_version: JOB_SCHEMA_VERSION,
    id: stringOr(job.id, `job_${randomUUID()}`),
    kind: normalizeKind(job.kind),
    label: stringOr(job.label, humanizeKind(job.kind)),
    status,
    matterName: stringOr(job.matterName, ""),
    matterId: stringOr(job.matterId, ""),
    traceId: stringOr(job.traceId, ""),
    requestId: stringOr(job.requestId, ""),
    startedAt,
    updatedAt: normalizeIso(job.updatedAt) || startedAt,
  };
  if (job.user && typeof job.user === "object" && !Array.isArray(job.user)) {
    normalized.user = sanitizeUser(job.user);
  }
  if (job.finishedAt) normalized.finishedAt = normalizeIso(job.finishedAt) || String(job.finishedAt);
  if (job.resultState) normalized.resultState = sanitizeText(job.resultState, 120);
  if (job.summary) normalized.summary = sanitizeText(job.summary, 500);
  if (job.errorMessage) normalized.errorMessage = sanitizeText(job.errorMessage, 500);
  if (job.errorCode) normalized.errorCode = safeErrorCode(job.errorCode);
  if (job.failureClass) normalized.failureClass = normalizeFailureClass(job.failureClass);
  if (job.metadata && typeof job.metadata === "object") normalized.metadata = sanitizeMetadata(job.metadata);
  return normalized;
}

function emptyStore() {
  return { schema_version: LEDGER_SCHEMA_VERSION, jobs: [] };
}

function normalizeStore(store = {}) {
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    jobs: Array.isArray(store.jobs) ? store.jobs.map(normalizeJobStatus) : [],
  };
}

function resultMetadata(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  return {
    resultState: typeof result.state === "string" ? result.state : undefined,
    summary: summarizeResult(result),
  };
}

function summarizeResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  if (typeof result.message === "string") return result.message;
  if (typeof result.reason === "string") return result.reason;
  if (typeof result.description === "string") return result.description;
  if (typeof result.artifactPath === "string") return result.artifactPath;
  if (result.outputPaths && typeof result.outputPaths === "object") {
    const paths = Object.values(result.outputPaths).filter((value) => typeof value === "string" && value.trim());
    if (paths.length) return paths.join(", ");
  }
  return "";
}

function sanitizeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const entries = Object.entries(metadata)
    .filter(([key]) => typeof key === "string" && key.trim())
    .slice(0, 30)
    .map(([key, value]) => [key, sanitizeMetadataValue(value)]);
  return Object.fromEntries(entries);
}

function mergeMetadata(current = {}, patch = {}) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) continue;
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && merged[key]
      && typeof merged[key] === "object"
      && !Array.isArray(merged[key])
    ) {
      merged[key] = mergeMetadata(merged[key], value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function sanitizeMetadataValue(value) {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeText(value, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeMetadataValue);
  if (typeof value === "object") {
    return sanitizeMetadata(Object.fromEntries(Object.entries(value).slice(0, 20)));
  }
  return sanitizeText(String(value), 500);
}

function sanitizeUser(user = {}) {
  return {
    username: sanitizeText(user.username || "", 180).trim(),
    role: sanitizeText(user.role || "tester", 40).trim() || "tester",
    displayName: sanitizeText(user.displayName || "", 180).trim(),
  };
}

function errorToMessage(error) {
  if (error instanceof Error && error.message) return sanitizeText(error.message, 500);
  return sanitizeText(String(error || "Unknown job failure"), 500);
}

function sanitizeText(value, maxLength = 500) {
  return redactSensitiveText(value).slice(0, maxLength);
}

function compareNewestJobFirst(a, b) {
  return Date.parse(b.startedAt || b.updatedAt || 0) - Date.parse(a.startedAt || a.updatedAt || 0);
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(parsed), 500);
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeFilter(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeStatus(status) {
  const text = typeof status === "string" ? status.trim() : "";
  if (["running", "succeeded", "failed", "cancelled"].includes(text)) return text;
  return "running";
}

export function classifyFailure(message = "") {
  const text = String(message || "").toLowerCase();
  if (/login required|unauth|forbidden|permission denied/.test(text)) return "auth";
  if (/api key|provider|openrouter|openai|gemini|mistral|rate limit|quota|timeout|timed out/.test(text)) return "provider";
  if (/database|postgres|psql|storage|write|read|enoent|no such file|not found/.test(text)) return "storage";
  if (/source folder is missing|source files|pick one|no matter|missing|required|invalid/.test(text)) return "user_action_needed";
  return "unknown";
}

function normalizeFailureClass(value) {
  const text = sanitizeText(value, 80).trim();
  if (["auth", "provider", "storage", "user_action_needed", "unknown"].includes(text)) return text;
  return "unknown";
}

function normalizeKind(kind) {
  const text = typeof kind === "string" ? kind.trim() : "";
  return text || "job";
}

function humanizeKind(kind) {
  const text = normalizeKind(kind);
  return text.split("_").map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : "").join(" ");
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeErrorCode(value) {
  const code = String(value || "").trim();
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(code) ? code : "";
}

function normalizeIso(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toISOString();
}

function isoNow(now) {
  const value = now();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

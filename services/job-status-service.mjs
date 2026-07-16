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
const VALID_STAGE_STATUSES = new Set(["pending", "running", "succeeded", "failed", "skipped", "cancelled"]);
const STAGE_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;

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
      const job = newJob(input);
      store.jobs.push(job);
      return job;
    });
  }

  async function createSkillRunJob(input = {}, { slash = "", idempotencyKey = "" } = {}) {
    await finalizeStaleRunningJobs();
    return writeMutatedStore(async (store) => {
      const existing = activeSkillRunJob(store.jobs, {
        slash,
        matterId: input.matterId,
        matterName: input.matterName,
      });
      if (existing) {
        const existingKey = normalizeFilter(existing.metadata?.skill?.idempotencyKey);
        return {
          created: false,
          deduplicationReason: existingKey && existingKey === normalizeFilter(idempotencyKey)
            ? "idempotency_key"
            : "active_skill_matter",
          job: existing,
        };
      }
      const job = newJob(input);
      store.jobs.push(job);
      return { created: true, deduplicationReason: "", job };
    });
  }

  function newJob(input = {}) {
    const startedAt = isoNow(now);
    const requestContext = currentRequestContext();
    return normalizeJobStatus({
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

  async function updateJobStage(jobId, stagePatch = {}) {
    const stageId = normalizeStageId(stagePatch.id);
    if (!stageId) throw new Error("stage id is required");
    return writeMutatedStore(async (store) => {
      const index = store.jobs.findIndex((job) => job.id === jobId);
      if (index < 0) throw new Error(`Job not found: ${jobId}`);
      const current = normalizeJobStatus(store.jobs[index]);
      const currentStages = Array.isArray(current.stages) ? current.stages : [];
      const stageIndex = currentStages.findIndex((stage) => stage.id === stageId);
      const existing = stageIndex >= 0 ? currentStages[stageIndex] : { id: stageId };
      const mergedRawStage = {
        ...existing,
        ...stagePatch,
        id: stageId,
      };
      const mergedMetadata = sanitizeMetadata(mergeMetadata(existing.metadata || {}, stagePatch.metadata || {}));
      if (Object.keys(mergedMetadata).length) mergedRawStage.metadata = mergedMetadata;
      else delete mergedRawStage.metadata;
      if (mergedRawStage.durationMs === undefined && mergedRawStage.startedAt && mergedRawStage.finishedAt) {
        const started = Date.parse(mergedRawStage.startedAt);
        const finished = Date.parse(mergedRawStage.finishedAt);
        if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
          mergedRawStage.durationMs = finished - started;
        }
      }
      const mergedStage = normalizeJobStage(mergedRawStage);
      const stages = stageIndex >= 0
        ? currentStages.map((stage, i) => (i === stageIndex ? mergedStage : stage))
        : [...currentStages, mergedStage];
      const updated = normalizeJobStatus({
        ...current,
        stages,
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
    const errorCode = safeErrorCode(patch.errorCode || error?.code) || safeErrorCode(patch.fallbackErrorCode);
    const failureClass = patch.failureClass || classifyFailure(message, { errorCode });
    return writeMutatedStore(async (store) => {
      const index = store.jobs.findIndex((job) => job.id === jobId);
      if (index < 0) throw new Error(`Job not found: ${jobId}`);
      const current = store.jobs[index];
      const finishedAt = isoNow(now);
      const currentStages = Array.isArray(current.stages) ? current.stages : [];
      const stages = Array.isArray(patch.stages)
        ? patch.stages
        : currentStages.map((stage) => finalizeFailedRunningStage(stage, {
          finishedAt,
          message,
          errorCode,
          failureClass,
        }));
      const updated = normalizeJobStatus({
        ...current,
        ...patch,
        ...(stages.length ? { stages } : {}),
        metadata: sanitizeMetadata(mergeMetadata(current.metadata || {}, patch.metadata || {})),
        status: "failed",
        finishedAt,
        errorMessage: message,
        ...(errorCode ? { errorCode } : {}),
        failureClass,
      });
      store.jobs[index] = updated;
      return updated;
    });
  }

  async function runTrackedJob({ operation, failureErrorCode, ...input } = {}) {
    if (typeof operation !== "function") throw new Error("operation is required");
    const job = await createJob(input);
    try {
      const result = await operation({ job });
      const completed = await completeJob(job.id, resultMetadata(result));
      return { result, job: completed };
    } catch (error) {
      await failJob(job.id, error, { fallbackErrorCode: failureErrorCode });
      throw error;
    }
  }

  async function getJob(jobId) {
    const id = typeof jobId === "string" ? jobId.trim() : "";
    if (!id) throw new Error("job id is required");
    await finalizeStaleRunningJobs();
    const store = await loadStore();
    const job = store.jobs.find((entry) => entry.id === id);
    if (!job) throw new Error(`Job not found: ${id}`);
    return normalizeJobStatus(job);
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
        const message = sanitizeText(`Stale running job marked failed after ${Math.round(staleAfterMs / 1000)} seconds without progress.`);
        job.status = "failed";
        job.finishedAt = currentIso;
        job.updatedAt = currentIso;
        job.errorMessage = message;
        job.errorCode = "job.stale_running";
        job.failureClass = "unknown";
        if (Array.isArray(job.stages)) {
          job.stages = job.stages.map((stage) => finalizeStaleRunningStage(stage, {
            currentTime,
            currentIso,
            message,
          }));
        }
      }
    });
  }

  return {
    createJob,
    createSkillRunJob,
    updateJob,
    updateJobStage,
    completeJob,
    failJob,
    runTrackedJob,
    getJob,
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
  const durationMs = normalizeJobDurationMs({ ...job, startedAt: normalized.startedAt, finishedAt: normalized.finishedAt });
  if (durationMs !== null) normalized.durationMs = durationMs;
  if (job.resultState) normalized.resultState = sanitizeText(job.resultState, 120);
  if (job.summary) normalized.summary = sanitizeText(job.summary, 500);
  if (job.outputPaths && typeof job.outputPaths === "object" && !Array.isArray(job.outputPaths)) {
    const outputPaths = sanitizeOutputPaths(job.outputPaths);
    if (Object.keys(outputPaths).length) normalized.outputPaths = outputPaths;
  }
  if (job.outputAvailability && typeof job.outputAvailability === "object" && !Array.isArray(job.outputAvailability)) {
    const outputAvailability = sanitizeOutputAvailability(job.outputAvailability);
    if (Object.keys(outputAvailability).length) normalized.outputAvailability = outputAvailability;
  }
  if (job.warnings !== undefined) {
    const warnings = sanitizeWarnings(job.warnings);
    if (warnings.length) normalized.warnings = warnings;
  }
  if (job.errorMessage) normalized.errorMessage = sanitizeText(job.errorMessage, 500);
  if (job.errorCode) normalized.errorCode = safeErrorCode(job.errorCode);
  if (job.failureClass) normalized.failureClass = normalizeFailureClass(job.failureClass);
  if (Array.isArray(job.stages)) normalized.stages = normalizeJobStages(job.stages);
  if (job.metadata && typeof job.metadata === "object") normalized.metadata = sanitizeMetadata(job.metadata);
  return normalized;
}

function finalizeStaleRunningStage(stage = {}, { currentTime, currentIso, message } = {}) {
  return finalizeRunningStageFailure(stage, {
    finishedAt: currentIso,
    finishedTime: currentTime instanceof Date ? currentTime.getTime() : Date.parse(currentIso || ""),
    message,
    errorCode: "job.stale_running",
    failureClass: "unknown",
  });
}

function finalizeFailedRunningStage(stage = {}, { finishedAt, message, errorCode = "", failureClass = "unknown" } = {}) {
  return finalizeRunningStageFailure(stage, {
    finishedAt,
    finishedTime: Date.parse(finishedAt || ""),
    message,
    errorCode: errorCode || "job.failed",
    failureClass,
  });
}

function finalizeRunningStageFailure(stage = {}, { finishedAt, finishedTime, message, errorCode, failureClass } = {}) {
  if (!stage || stage.status !== "running") return stage;
  const next = {
    ...stage,
    status: "failed",
    finishedAt,
    failureCode: errorCode,
    failureClass,
    errorMessage: message,
  };
  const started = Date.parse(stage.startedAt || "");
  if (Number.isFinite(started) && Number.isFinite(finishedTime) && finishedTime >= started) {
    next.durationMs = finishedTime - started;
  }
  return normalizeJobStage(next) || stage;
}

function normalizeJobStages(stages = []) {
  const normalized = [];
  const seen = new Set();
  for (const stage of Array.isArray(stages) ? stages : []) {
    const next = normalizeJobStage(stage);
    if (!next || !next.id || seen.has(next.id)) continue;
    seen.add(next.id);
    normalized.push(next);
  }
  return normalized.slice(0, 50);
}

function normalizeJobDurationMs(job = {}) {
  const explicit = normalizeNonNegativeInteger(job.durationMs);
  if (explicit !== null) return explicit;
  if (!job.startedAt || !job.finishedAt) return null;
  const started = Date.parse(job.startedAt);
  const finished = Date.parse(job.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
  return Math.trunc(finished - started);
}

function normalizeJobStage(stage = {}) {
  const id = normalizeStageId(stage.id);
  if (!id) return null;
  const normalized = {
    id,
    status: normalizeStageStatus(stage.status),
  };
  if (stage.label) normalized.label = sanitizeText(stage.label, 160);
  if (stage.startedAt) normalized.startedAt = normalizeIso(stage.startedAt) || String(stage.startedAt);
  if (stage.updatedAt) normalized.updatedAt = normalizeIso(stage.updatedAt) || String(stage.updatedAt);
  if (stage.finishedAt) normalized.finishedAt = normalizeIso(stage.finishedAt) || String(stage.finishedAt);
  const durationMs = normalizeNonNegativeInteger(stage.durationMs);
  if (durationMs !== null) normalized.durationMs = durationMs;
  if (stage.provider) normalized.provider = sanitizeText(stage.provider, 80);
  if (stage.model) normalized.model = sanitizeText(stage.model, 160);
  if (stage.failureCode) normalized.failureCode = safeErrorCode(stage.failureCode);
  if (stage.failureClass) normalized.failureClass = normalizeFailureClass(stage.failureClass);
  if (stage.errorMessage) normalized.errorMessage = sanitizeText(stage.errorMessage, 500);
  if (stage.summary) normalized.summary = sanitizeText(stage.summary, 500);
  if (stage.aiRun && typeof stage.aiRun === "object" && !Array.isArray(stage.aiRun)) {
    normalized.aiRun = sanitizeMetadata(stage.aiRun);
  }
  if (stage.metadata && typeof stage.metadata === "object" && !Array.isArray(stage.metadata)) {
    normalized.metadata = sanitizeMetadata(stage.metadata);
  }
  if (stage.salvageable !== undefined) normalized.salvageable = Boolean(stage.salvageable);
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
  const outputPaths = sanitizeOutputPaths(result.outputPaths);
  const outputAvailability = sanitizeOutputAvailability(result.outputAvailability);
  const warnings = sanitizeWarnings(result.warnings);
  return {
    resultState: typeof result.state === "string" ? result.state : undefined,
    summary: summarizeResult(result),
    ...(Object.keys(outputPaths).length ? { outputPaths } : {}),
    ...(Object.keys(outputAvailability).length ? { outputAvailability } : {}),
    ...(warnings.length ? { warnings } : {}),
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

function sanitizeOutputPaths(outputPaths = {}) {
  if (!outputPaths || typeof outputPaths !== "object" || Array.isArray(outputPaths)) return {};
  const safe = {};
  for (const key of ["markdown", "json"]) {
    if (typeof outputPaths[key] === "string" && outputPaths[key].trim()) {
      safe[key] = sanitizeText(outputPaths[key], 500).trim();
    }
  }
  return safe;
}

function sanitizeOutputAvailability(outputAvailability = {}) {
  if (!outputAvailability || typeof outputAvailability !== "object" || Array.isArray(outputAvailability)) return {};
  const safe = {};
  for (const key of ["markdown", "json"]) {
    const value = typeof outputAvailability[key] === "string" ? outputAvailability[key].trim() : "";
    if (/^[a-z][a-z0-9_]{0,80}$/.test(value)) safe[key] = value;
  }
  return safe;
}

function sanitizeWarnings(warnings = []) {
  const input = Array.isArray(warnings) ? warnings : warnings ? [warnings] : [];
  return input
    .map((warning) => sanitizeText(warning, 800).trim())
    .filter(Boolean)
    .slice(0, 10);
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

function activeSkillRunJob(jobs = [], { slash = "", matterId = "", matterName = "" } = {}) {
  const targetSlash = normalizeFilter(slash);
  const targetMatterId = normalizeFilter(matterId);
  const targetMatterName = normalizeFilter(matterName).toLowerCase();
  if (!targetSlash || (!targetMatterId && !targetMatterName)) return null;
  return [...(Array.isArray(jobs) ? jobs : [])].reverse().find((job) => {
    if (job?.status !== "running" || normalizeFilter(job.metadata?.skill?.slash) !== targetSlash) return false;
    const jobMatterId = normalizeFilter(job.matterId);
    if (targetMatterId && jobMatterId) return targetMatterId === jobMatterId;
    return Boolean(targetMatterName) && normalizeFilter(job.matterName).toLowerCase() === targetMatterName;
  }) || null;
}

function normalizeFilter(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeStatus(status) {
  const text = typeof status === "string" ? status.trim() : "";
  if (["running", "succeeded", "failed", "cancelled"].includes(text)) return text;
  return "running";
}

function normalizeStageId(value) {
  const text = String(value || "").trim().toLowerCase();
  return STAGE_ID_PATTERN.test(text) ? text : "";
}

function normalizeStageStatus(status) {
  const text = typeof status === "string" ? status.trim() : "";
  return VALID_STAGE_STATUSES.has(text) ? text : "pending";
}

function normalizeNonNegativeInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.trunc(number);
}

export function classifyFailure(message = "", { errorCode = "" } = {}) {
  const codeClass = classifyFailureCode(errorCode);
  if (codeClass) return codeClass;
  const text = String(message || "").toLowerCase();
  if (/login required|unauth|forbidden|permission denied/.test(text)) return "auth";
  if (/api key|provider|openrouter|openai|gemini|mistral|rate limit|quota|timeout|timed out/.test(text)) return "provider";
  if (/database|postgres|psql|storage|write|read|enoent|no such file|not found/.test(text)) return "storage";
  if (/source folder is missing|source files|pick one|no matter|missing|required|invalid/.test(text)) return "user_action_needed";
  return "unknown";
}

function classifyFailureCode(errorCode = "") {
  const code = safeErrorCode(errorCode);
  if (!code) return "";
  if (/^(provider|openai|openrouter|gemini|mistral)\./.test(code)) return "provider";
  if (/^(auth|authentication|authorization|permission)\./.test(code)) return "auth";
  if (/^(storage|database|postgres|runtime_db|artifact)\./.test(code)) return "storage";
  if (/^(user_action|validation|missing_input)\./.test(code)) return "user_action_needed";
  return "";
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

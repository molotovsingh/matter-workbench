import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import {
  attemptTelemetrySync,
  drainQueuedTelemetrySync,
  markTelemetrySyncQueued,
  normalizeTelemetrySyncConfig,
} from "./telemetry-sync-client.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const LEDGER_SCHEMA_VERSION = "private-beta-signal-ledger/v1";
const SIGNAL_SCHEMA_VERSION = "private-beta-signal/v1";
const CAPTURE_RESULT_SCHEMA_VERSION = "private-beta-signal-capture-result/v1";
const SYNC_RESULT_SCHEMA_VERSION = "private-beta-signal-sync-result/v1";
const DEFAULT_LIMIT = 100;

const ALLOWED_SOURCES = new Set(["matter_attention", "job_status", "skill_factory_health"]);
const ALLOWED_SEVERITIES = new Set(["blocker", "warning", "info", "error"]);

export function createPrivateBetaSignalService({
  appDir = process.cwd(),
  signalsPath,
  syncUrl = "",
  syncToken = "",
  installId = "",
  telemetryMode = "safe",
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  idFactory = () => `signal_${randomUUID()}`,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = signalsPath || path.join(root, ".local", "private-beta-signal-ledger.json");
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  const syncConfig = normalizeTelemetrySyncConfig({ syncUrl, syncToken, installId, fetchImpl });
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: (store) => formatJsonStore(normalizeStore(store, { telemetryMode: normalizedTelemetryMode })),
  });

  async function loadStore() {
    try {
      return normalizeStore(JSON.parse(await readFile(storePath, "utf8")), { telemetryMode: normalizedTelemetryMode });
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

  async function captureMatterAttention(attention = {}, context = {}) {
    const summary = sanitizeAttentionSummary(attention.summary || {});
    const matterName = sanitizeText(attention.matterName, 180).trim();
    const matterRoot = sanitizeText(attention.matterRoot, 500).trim();
    const runtimeMode = sanitizeText(context.runtimeMode, 60).trim();
    const candidates = Array.isArray(attention.items) ? attention.items : [];
    const signals = candidates
      .filter((item) => item?.severity === "blocker" || item?.severity === "warning")
      .map((item) => buildMatterAttentionSignal({
        item,
        matterName,
        matterRoot,
        runtimeMode,
        summary,
        telemetryMode: normalizedTelemetryMode,
      }));
    return captureSignals(signals);
  }

  async function captureJobSignals(ledger = {}, context = {}) {
    const runtimeMode = sanitizeText(context.runtimeMode, 60).trim();
    const jobs = Array.isArray(ledger.jobs) ? ledger.jobs : [];
    const signals = jobs
      .filter((job) => job?.status === "failed")
      .map((job) => buildJobSignal({ job, runtimeMode, telemetryMode: normalizedTelemetryMode }));
    return captureSignals(signals);
  }

  async function captureSkillFactoryHealth(health = {}, context = {}) {
    if (health.state !== "error" && health.state !== "warning") {
      return emptyCaptureResult();
    }
    const runtimeMode = sanitizeText(context.runtimeMode, 60).trim();
    const summary = sanitizeSkillFactorySummary(health.summary || {});
    const issues = Array.isArray(health.issues) ? health.issues : [];
    const signals = issues
      .filter((issue) => issue?.severity === "error" || issue?.severity === "warning")
      .map((issue) => buildSkillFactoryHealthSignal({
        issue,
        runtimeMode,
        summary,
        storePaths: health.storePaths,
        telemetryMode: normalizedTelemetryMode,
      }));
    return captureSignals(signals);
  }

  async function captureSignals(inputSignals = []) {
    const candidates = inputSignals
      .map((signal) => {
        const seenAt = isoNow(now);
        return normalizeSignal({
          ...signal,
          id: validId(signal.id) || idFactory(),
          schema_version: SIGNAL_SCHEMA_VERSION,
          telemetryMode: normalizedTelemetryMode,
          createdAt: seenAt,
          updatedAt: seenAt,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          occurrenceCount: 1,
        });
      })
      .filter((signal) => signal.source && signal.fingerprint);

    if (!candidates.length) return emptyCaptureResult();

    return writeMutatedStore(async (store) => {
      const capturedSignals = [];
      const result = emptyCaptureResult();
      for (const candidate of candidates) {
        const index = store.signals.findIndex((signal) => signal.fingerprint === candidate.fingerprint);
        if (index >= 0) {
          const existing = store.signals[index];
          const seenAt = candidate.lastSeenAt;
          const updated = normalizeSignal({
            ...existing,
            summary: candidate.summary,
            details: candidate.details,
            updatedAt: seenAt,
            lastSeenAt: seenAt,
            occurrenceCount: (existing.occurrenceCount || 1) + 1,
          }, { telemetryMode: existing.telemetryMode || normalizedTelemetryMode });
          updated.sync = markTelemetrySyncQueued({
            syncConfig,
            previousSync: updated.sync,
            normalizeSync,
          });
          store.signals[index] = updated;
          capturedSignals.push(updated);
          if (updated.sync.status === "queued") result.queued += 1;
          else if (updated.sync.status === "not_configured") result.skipped += 1;
          else result.failed += 1;
          continue;
        }

        const signal = normalizeSignal(candidate, { telemetryMode: normalizedTelemetryMode });
        signal.sync = markTelemetrySyncQueued({
          syncConfig,
          previousSync: signal.sync,
          normalizeSync,
        });
        store.signals.push(signal);
        capturedSignals.push(signal);
        if (signal.sync.status === "sent") result.sent += 1;
        else if (signal.sync.status === "queued") result.queued += 1;
        else if (signal.sync.status === "not_configured") result.skipped += 1;
        else result.failed += 1;
      }
      result.captured = capturedSignals.length;
      result.signals = capturedSignals;
      return result;
    });
  }

  async function listSignals(filters = {}) {
    const store = await loadStore();
    const limit = parseLimit(filters.limit);
    const source = sanitizeText(filters.source, 80).trim();
    const severity = sanitizeText(filters.severity, 40).trim();
    const syncStatus = sanitizeText(filters.syncStatus || filters.sync, 40).trim();
    const signals = store.signals
      .filter((signal) => !source || signal.source === source)
      .filter((signal) => !severity || signal.severity === severity)
      .filter((signal) => !syncStatus || signal.sync?.status === syncStatus)
      .sort(compareNewestSignalFirst)
      .slice(0, limit);
    return {
      schema_version: LEDGER_SCHEMA_VERSION,
      signals,
    };
  }

  async function syncQueuedSignals(filters = {}) {
    return drainQueuedTelemetrySync({
      loadStore,
      writeMutatedStore,
      selectItems: (store) => store.signals,
      attemptSync,
      schemaVersion: SYNC_RESULT_SCHEMA_VERSION,
      limit: parseLimit(filters.limit),
    });
  }

  return {
    captureMatterAttention,
    captureJobSignals,
    captureSkillFactoryHealth,
    listSignals,
    syncQueuedSignals,
  };

  async function attemptSync(signal, previousSync = {}) {
    return attemptTelemetrySync({
      syncConfig,
      previousSync,
      normalizeSync,
      now,
      buildPayload: (install) => buildSyncPayload(signal, install),
      sanitizeError: (message) => sanitizeText(message, 300).trim(),
    });
  }
}

export function normalizeSignal(input = {}, { telemetryMode = "safe" } = {}) {
  const normalizedTelemetryMode = normalizeTelemetryMode(input.telemetryMode || telemetryMode);
  const createdAt = normalizeIso(input.createdAt) || isoNow(() => new Date());
  const signal = {
    schema_version: SIGNAL_SCHEMA_VERSION,
    id: validId(input.id) || `signal_${randomUUID()}`,
    source: normalizeSource(input.source),
    telemetryMode: normalizedTelemetryMode,
    fingerprint: sanitizeText(input.fingerprint, 160).trim(),
    severity: normalizeSeverity(input.severity),
    category: sanitizeText(input.category, 80).trim(),
    code: sanitizeText(input.code, 120).trim(),
    title: sanitizeText(input.title, 180).trim() || "Private beta signal",
    matterName: sanitizeText(input.matterName, 180).trim(),
    runtimeMode: sanitizeText(input.runtimeMode, 60).trim(),
    createdAt,
    updatedAt: normalizeIso(input.updatedAt) || createdAt,
    firstSeenAt: normalizeIso(input.firstSeenAt) || createdAt,
    lastSeenAt: normalizeIso(input.lastSeenAt) || createdAt,
    occurrenceCount: Math.max(1, Math.trunc(Number(input.occurrenceCount) || 1)),
    summary: sanitizeSummary(input.summary || {}),
    details: sanitizeDetails(input.details || {}, { telemetryMode: normalizedTelemetryMode }),
    sync: normalizeSync(input.sync),
  };
  return signal;
}

function buildMatterAttentionSignal({
  item = {},
  matterName = "",
  matterRoot = "",
  runtimeMode = "",
  summary = {},
  telemetryMode = "safe",
}) {
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  const category = sanitizeText(item.category || "matter", 80).trim();
  const code = sanitizeText(item.code || "attention", 120).trim();
  const title = sanitizeText(item.title || "Matter attention needed", 180).trim();
  const severity = normalizeSeverity(item.severity);
  return {
    source: "matter_attention",
    fingerprint: stableFingerprint(["matter_attention", matterName, category, code, item.id || title, severity]),
    severity,
    category,
    code,
    title,
    matterName,
    runtimeMode,
    telemetryMode: normalizedTelemetryMode,
    summary: {
      state: sanitizeText(summary.state, 60).trim(),
      blockers: toSafeNumber(summary.blocker),
      warnings: toSafeNumber(summary.warning),
      info: toSafeNumber(summary.info),
      total: toSafeNumber(summary.total),
    },
    details: {
      action: sanitizeText(item.action, 240).trim(),
      evidence: sanitizeEvidenceList(item.evidence, { telemetryMode: normalizedTelemetryMode }),
      ...(normalizedTelemetryMode === "firm_internal" && item.detail ? { detail: sanitizeText(item.detail, 2000).trim() } : {}),
      ...(normalizedTelemetryMode === "firm_internal" && matterRoot ? { matterRoot } : {}),
    },
  };
}

function buildJobSignal({ job = {}, runtimeMode = "", telemetryMode = "safe" }) {
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  const kind = sanitizeText(job.kind || "job", 80).trim();
  const title = sanitizeText(job.label || humanizeText(kind) || "Job failed", 180).trim();
  const code = sanitizeSignalCode(job.errorCode || "job_failed");
  const workflow = sanitizeWorkflowSignalDetails(job.metadata?.workflow);
  const failureClass = sanitizeText(job.failureClass || "", 80).trim();
  return {
    source: "job_status",
    fingerprint: stableFingerprint(["job_status", job.id || "", job.matterName || "", kind, title]),
    severity: "error",
    category: kind,
    code,
    title,
    matterName: sanitizeText(job.matterName, 180).trim(),
    runtimeMode,
    telemetryMode: normalizedTelemetryMode,
    summary: {
      state: "failed",
      ...(code ? { errorCode: code } : {}),
      ...(workflow.stage ? { stage: workflow.stage } : {}),
    },
    details: {
      jobId: sanitizeText(job.id, 120).trim(),
      kind,
      status: "failed",
      errorCode: code,
      ...(failureClass ? { failureClass } : {}),
      ...(workflow.stage ? { stage: workflow.stage } : {}),
      ...(workflow.route ? { route: workflow.route } : {}),
      errorMessage: sanitizeText(job.errorMessage || "Job failed", 300).trim(),
      startedAt: normalizeIso(job.startedAt),
      finishedAt: normalizeIso(job.finishedAt),
      ...(normalizedTelemetryMode === "firm_internal" && job.metadata ? { metadata: sanitizeDiagnosticValue(job.metadata) } : {}),
    },
  };
}

function buildSkillFactoryHealthSignal({
  issue = {},
  runtimeMode = "",
  summary = {},
  storePaths = {},
  telemetryMode = "safe",
}) {
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  const severity = issue.severity === "error" ? "error" : "warning";
  const code = sanitizeText(issue.code || "skill_factory_issue", 120).trim();
  return {
    source: "skill_factory_health",
    fingerprint: stableFingerprint(["skill_factory_health", severity, code, issue.message || ""]),
    severity,
    category: "skill_factory",
    code,
    title: humanizeText(code) || "Skill factory health issue",
    runtimeMode,
    telemetryMode: normalizedTelemetryMode,
    summary: sanitizeSkillFactorySummary(summary),
    details: {
      message: sanitizeText(issue.message || "", 300).trim(),
      ...(normalizedTelemetryMode === "firm_internal" ? { storePaths: sanitizeDiagnosticValue(storePaths) } : {}),
    },
  };
}

function emptyStore() {
  return { schema_version: LEDGER_SCHEMA_VERSION, signals: [] };
}

function normalizeStore(store = {}, { telemetryMode = "safe" } = {}) {
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    signals: Array.isArray(store.signals) ? store.signals.map((signal) => normalizeSignal(signal, { telemetryMode })) : [],
  };
}

function emptyCaptureResult() {
  return {
    schema_version: CAPTURE_RESULT_SCHEMA_VERSION,
    captured: 0,
    sent: 0,
    queued: 0,
    failed: 0,
    skipped: 0,
    signals: [],
  };
}

function buildSyncPayload(signal, installId) {
  const safeSignal = normalizeSignal(signal, { telemetryMode: signal.telemetryMode || "safe" });
  delete safeSignal.sync;
  return {
    schema_version: "private-beta-signal-sync/v1",
    installId,
    signal: safeSignal,
  };
}

function normalizeSync(sync = {}) {
  if (!sync || typeof sync !== "object" || Array.isArray(sync)) {
    return { status: "not_configured", attempts: 0 };
  }
  const status = ["not_configured", "queued", "sent", "failed"].includes(sync.status)
    ? sync.status
    : "not_configured";
  const normalized = {
    status,
    attempts: Math.max(0, Math.trunc(Number(sync.attempts) || 0)),
  };
  const lastAttemptAt = normalizeIso(sync.lastAttemptAt);
  const sentAt = normalizeIso(sync.sentAt);
  if (lastAttemptAt) normalized.lastAttemptAt = lastAttemptAt;
  if (sentAt) normalized.sentAt = sentAt;
  if (typeof sync.endpointHost === "string" && sync.endpointHost.trim()) {
    normalized.endpointHost = sanitizeText(sync.endpointHost, 120).trim();
  }
  if (typeof sync.lastError === "string" && sync.lastError.trim()) {
    normalized.lastError = sanitizeText(sync.lastError, 300).trim();
  }
  return normalized;
}

function sanitizeAttentionSummary(summary = {}) {
  return {
    state: sanitizeText(summary.state, 60).trim(),
    blocker: toSafeNumber(summary.blocker),
    warning: toSafeNumber(summary.warning),
    info: toSafeNumber(summary.info),
    total: toSafeNumber(summary.total),
  };
}

function sanitizeSkillFactorySummary(summary = {}) {
  return {
    state: sanitizeText(summary.state, 60).trim(),
    errors: toSafeNumber(summary.errors),
    warnings: toSafeNumber(summary.warnings),
    activeSkills: toSafeNumber(summary.activeSkills),
    configurableSkills: toSafeNumber(summary.configurableSkills),
  };
}

function sanitizeSummary(summary = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(summary).slice(0, 20)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") safe[key] = value;
    else if (typeof value === "string") safe[key] = sanitizeText(value, 120).trim();
  }
  return safe;
}

function sanitizeDetails(details = {}, { telemetryMode = "safe" } = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  const safe = {};
  const allowed = new Set([
    "action",
    "detail",
    "evidence",
    "errorCode",
    "errorMessage",
    "failureClass",
    "finishedAt",
    "jobId",
    "kind",
    "message",
    "metadata",
    "matterRoot",
    "route",
    "stage",
    "startedAt",
    "status",
    "storePaths",
  ]);
  for (const [key, value] of Object.entries(details)) {
    if (!allowed.has(key)) continue;
    if (key === "evidence") safe.evidence = sanitizeEvidenceList(value, { telemetryMode: normalizedTelemetryMode });
    else if ((key === "metadata" || key === "storePaths") && normalizedTelemetryMode === "firm_internal") {
      safe[key] = sanitizeDiagnosticValue(value);
    } else if (typeof value === "string" && value.trim()) {
      const maxLength = normalizedTelemetryMode === "firm_internal"
        ? 2000
        : key === "errorMessage" || key === "message"
          ? 300
          : 160;
      safe[key] = sanitizeText(value, maxLength).trim();
    }
    else if (typeof value === "number" || typeof value === "boolean") safe[key] = value;
  }
  return safe;
}

function sanitizeSignalCode(value, fallback = "job_failed") {
  const code = sanitizeText(value, 120).trim();
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(code) ? code : fallback;
}

function sanitizeWorkflowSignalDetails(workflow = {}) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return {};
  const stage = sanitizeText(workflow.stage, 80).trim();
  const route = sanitizeText(workflow.route, 120).trim();
  const details = {};
  if (/^[a-z0-9_]{1,80}$/.test(stage)) details.stage = stage;
  if (/^\/api\/[a-z0-9/_-]{1,120}$/i.test(route)) details.route = route;
  return details;
}

function sanitizeEvidenceList(evidence = [], { telemetryMode = "safe" } = {}) {
  if (!Array.isArray(evidence)) return [];
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  return evidence
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => sanitizeText(value, normalizedTelemetryMode === "firm_internal" ? 1000 : 240).trim())
    .filter((line) => normalizedTelemetryMode === "firm_internal" || isSafeEvidenceLine(line))
    .slice(0, normalizedTelemetryMode === "firm_internal" ? 30 : 10);
}

function isSafeEvidenceLine(line = "") {
  if (!line || line.includes("\n")) return false;
  if (/source\s*text|generated\s*output|privileged|legal\s*work\s*product/i.test(line)) return false;
  return true;
}

function normalizeSource(source) {
  const text = sanitizeText(source, 80).trim();
  return ALLOWED_SOURCES.has(text) ? text : "";
}

function normalizeSeverity(severity) {
  const text = sanitizeText(severity, 40).trim();
  return ALLOWED_SEVERITIES.has(text) ? text : "warning";
}

function normalizeTelemetryMode(value) {
  return String(value || "").trim().toLowerCase() === "firm_internal" ? "firm_internal" : "safe";
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeText(value, 4000).trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  if (typeof value === "object") {
    if (depth >= 4) return "[truncated]";
    const entries = Object.entries(value)
      .filter(([key]) => typeof key === "string" && key.trim())
      .slice(0, 50)
      .map(([key, item]) => [sanitizeText(key, 120).trim(), sanitizeDiagnosticValue(item, depth + 1)]);
    return Object.fromEntries(entries);
  }
  return sanitizeText(String(value), 4000).trim();
}

function stableFingerprint(parts = []) {
  const plain = parts.map((part) => sanitizeText(part, 240).trim()).join("|");
  const digest = createHash("sha256").update(plain).digest("hex").slice(0, 24);
  return `signal_${digest}`;
}

function compareNewestSignalFirst(a, b) {
  return Date.parse(b.lastSeenAt || b.createdAt || 0) - Date.parse(a.lastSeenAt || a.createdAt || 0);
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(parsed), 500);
}

function normalizeIso(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isoNow(now) {
  return now().toISOString();
}

function validId(value) {
  const text = sanitizeText(value, 120).trim();
  return /^[a-zA-Z0-9_-]{3,120}$/.test(text) ? text : "";
}

function toSafeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.trunc(number);
}

function humanizeText(text = "") {
  return sanitizeText(text, 120)
    .replace(/^\/+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sanitizeText(value, maxLength = 500) {
  return redactSensitiveText(String(value ?? "")).slice(0, maxLength);
}

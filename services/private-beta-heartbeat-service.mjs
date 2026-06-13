import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import {
  attemptTelemetrySync,
  drainQueuedTelemetrySync,
  markTelemetrySyncQueued,
  normalizeTelemetrySyncConfig,
} from "./telemetry-sync-client.mjs";

const LEDGER_SCHEMA_VERSION = "private-beta-heartbeat-ledger/v1";
const HEARTBEAT_SCHEMA_VERSION = "private-beta-heartbeat/v1";
const SYNC_RESULT_SCHEMA_VERSION = "private-beta-heartbeat-sync-result/v1";
const DEFAULT_LIMIT = 100;
const MAX_HEARTBEATS = 500;
const MAX_JOURNEYS = 20;

export function createPrivateBetaHeartbeatService({
  appDir = process.cwd(),
  heartbeatPath,
  syncUrl = "",
  syncToken = "",
  installId = "",
  telemetryMode = "safe",
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  idFactory = () => `heartbeat_${randomUUID()}`,
  journeyProvider = () => ({}),
  deploymentProvider = () => ({}),
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = heartbeatPath || path.join(root, ".local", "private-beta-heartbeat-ledger.json");
  const syncConfig = normalizeTelemetrySyncConfig({ syncUrl, syncToken, installId, fetchImpl });
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: (store) => formatJsonStore(normalizeStore(store)),
  });

  async function captureHeartbeat(input = {}) {
    return writeMutatedStore(async (store) => {
      const createdAt = isoNow(now);
      const deployment = safeObject(
        typeof deploymentProvider === "function"
          ? await deploymentProvider()
          : deploymentProvider,
      );
      const journey = safeObject(
        typeof journeyProvider === "function"
          ? await journeyProvider()
          : journeyProvider,
      );
      const heartbeat = normalizeHeartbeat({
        schema_version: HEARTBEAT_SCHEMA_VERSION,
        id: validId(input.id) || idFactory(),
        installId: syncConfig.installId || sanitizeText(input.installId, 160).trim(),
        appVersion: deployment.appVersion || deployment.commit || "",
        runtimeMode: deployment.runtimeMode || deployment.storageMode || "",
        publicUrl: deployment.publicUrl || deployment.baseUrl || "",
        telemetryMode: normalizedTelemetryMode,
        createdAt,
        sentAt: createdAt,
        activeSessions: input.activeSessions ?? journey.activeSessions,
        journeys: input.journeys ?? journey.journeys,
        matterHealth: input.matterHealth ?? journey.matterHealth,
        counters: input.counters ?? journey.counters,
      });
      heartbeat.sync = markTelemetrySyncQueued({
        syncConfig,
        previousSync: heartbeat.sync,
        normalizeSync,
      });
      store.heartbeats.push(heartbeat);
      if (store.heartbeats.length > MAX_HEARTBEATS) {
        store.heartbeats.splice(0, store.heartbeats.length - MAX_HEARTBEATS);
      }
      return heartbeat;
    });
  }

  async function listHeartbeats(filters = {}) {
    const store = await loadStore();
    const limit = parseLimit(filters.limit);
    return {
      schema_version: LEDGER_SCHEMA_VERSION,
      heartbeats: store.heartbeats
        .sort(compareNewestFirst)
        .slice(0, limit),
    };
  }

  async function syncQueuedHeartbeats(filters = {}) {
    return drainQueuedTelemetrySync({
      loadStore,
      writeMutatedStore,
      selectItems: (store) => store.heartbeats,
      attemptSync,
      schemaVersion: SYNC_RESULT_SCHEMA_VERSION,
      limit: parseLimit(filters.limit),
    });
  }

  async function loadStore() {
    try {
      return normalizeStore(JSON.parse(await readFile(storePath, "utf8")));
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

  async function attemptSync(heartbeat, previousSync = {}) {
    return attemptTelemetrySync({
      syncConfig,
      previousSync,
      normalizeSync,
      now,
      buildPayload: (install) => buildSyncPayload(heartbeat, install),
      sanitizeError: (message) => sanitizeText(message, 300).trim(),
    });
  }

  return {
    captureHeartbeat,
    listHeartbeats,
    syncQueuedHeartbeats,
  };
}

function normalizeHeartbeat(input = {}) {
  const createdAt = normalizeIso(input.createdAt) || new Date().toISOString();
  const telemetryMode = normalizeTelemetryMode(input.telemetryMode);
  return {
    schema_version: HEARTBEAT_SCHEMA_VERSION,
    id: validId(input.id) || `heartbeat_${randomUUID()}`,
    installId: sanitizeText(input.installId, 160).trim(),
    telemetryMode,
    appVersion: sanitizeText(input.appVersion, 80).trim(),
    runtimeMode: sanitizeText(input.runtimeMode, 80).trim(),
    publicUrl: sanitizeText(input.publicUrl, 240).trim(),
    createdAt,
    updatedAt: normalizeIso(input.updatedAt) || createdAt,
    sentAt: normalizeIso(input.sentAt) || createdAt,
    activeSessions: nonNegativeInt(input.activeSessions),
    journeys: sanitizeJourneys(input.journeys, telemetryMode),
    matterHealth: sanitizeMatterHealth(input.matterHealth, telemetryMode),
    counters: sanitizeCounters(input.counters),
    sync: normalizeSync(input.sync),
  };
}

function sanitizeJourneys(items = [], telemetryMode = "safe") {
  if (!Array.isArray(items)) return [];
  return items.slice(0, MAX_JOURNEYS).map((item = {}) => {
    const normalized = {
      user: sanitizeText(item.user, 180).trim(),
      matter: sanitizeText(item.matter, 300).trim(),
      screen: sanitizeText(item.screen, 80).trim(),
      route: sanitizeText(item.route, 120).trim(),
      lastAction: sanitizeText(item.lastAction, 120).trim(),
      currentStage: sanitizeText(item.currentStage, 120).trim(),
      currentStageStatus: sanitizeText(item.currentStageStatus, 80).trim(),
      traceId: sanitizeText(item.traceId, 180).trim(),
      jobId: sanitizeText(item.jobId, 180).trim(),
      lastError: sanitizeText(item.lastError, 500).trim(),
      patienceRisk: normalizePatienceRisk(item.patienceRisk),
    };
    if (telemetryMode === "firm_internal" && item.details && typeof item.details === "object") {
      normalized.details = safeObject(item.details, { maxDepth: 3 });
    }
    return normalized;
  });
}

function sanitizeCounters(counters = {}) {
  return {
    queuedFeedback: nonNegativeInt(counters.queuedFeedback),
    openSignals: nonNegativeInt(counters.openSignals),
    failedJobs: nonNegativeInt(counters.failedJobs),
    slowStages: nonNegativeInt(counters.slowStages),
  };
}

function sanitizeMatterHealth(items = [], telemetryMode = "safe") {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).map((item = {}) => {
    const normalized = {
      matter: sanitizeText(item.matter || item.matterName, 300).trim(),
      prepareState: sanitizeText(item.prepareState || item.nextStepState, 80).trim(),
      nextStepLabel: sanitizeText(item.nextStepLabel || item.nextStep || "", 160).trim(),
      attentionState: sanitizeText(item.attentionState, 80).trim(),
      blockers: nonNegativeInt(item.blockers),
      warnings: nonNegativeInt(item.warnings),
      checkedAt: normalizeIso(item.checkedAt) || "",
    };
    if (telemetryMode === "firm_internal" && item.details && typeof item.details === "object") {
      normalized.details = safeObject(item.details, { maxDepth: 2 });
    }
    return normalized;
  }).filter((item) => item.matter);
}

function buildSyncPayload(heartbeat, installId) {
  const safeHeartbeat = normalizeHeartbeat(heartbeat);
  delete safeHeartbeat.sync;
  return {
    schema_version: "private-beta-heartbeat-sync/v1",
    installId,
    heartbeat: safeHeartbeat,
  };
}

function emptyStore() {
  return { schema_version: LEDGER_SCHEMA_VERSION, heartbeats: [] };
}

function normalizeStore(store = {}) {
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    heartbeats: Array.isArray(store.heartbeats)
      ? store.heartbeats.map((item) => normalizeHeartbeat(item))
      : [],
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

function compareNewestFirst(a, b) {
  return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(parsed), 500);
}

function validId(value) {
  const text = sanitizeText(value, 120).trim();
  return /^[a-zA-Z0-9_-]{3,120}$/.test(text) ? text : "";
}

function normalizeIso(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isoNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeTelemetryMode(value) {
  return String(value || "").trim().toLowerCase() === "firm_internal" ? "firm_internal" : "safe";
}

function normalizePatienceRisk(value) {
  return ["low", "medium", "high"].includes(value) ? value : "low";
}

function sanitizeText(value, maxLength = 500) {
  return redactSecretLikeText(String(value ?? "")).slice(0, maxLength);
}

function redactSecretLikeText(text) {
  return text
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/g, "$1=[redacted-secret]")
    .replace(/\b(password|token|secret)\s*[:=]\s*([^\s"'`]+)/gi, "$1=[redacted-secret]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[redacted-secret]")
    .replace(/\bmwb_ing_[A-Za-z0-9_-]+/gi, "mwb_ing_[redacted-secret]");
}

function nonNegativeInt(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function safeObject(value, { maxDepth = 4 } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || maxDepth <= 0) return {};
  const output = {};
  for (const [key, rawValue] of Object.entries(value).slice(0, 80)) {
    const safeKey = sanitizeText(key, 80).trim();
    if (!safeKey) continue;
    if (typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
      output[safeKey] = sanitizeText(rawValue, 500);
    } else if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      output[safeKey] = safeObject(rawValue, { maxDepth: maxDepth - 1 });
    } else if (Array.isArray(rawValue)) {
      output[safeKey] = rawValue.slice(0, 20).map((item) => {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          return sanitizeText(item, 300);
        }
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return safeObject(item, { maxDepth: maxDepth - 1 });
        }
        return "";
      });
    }
  }
  return output;
}

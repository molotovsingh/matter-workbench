import { randomUUID } from "node:crypto";
import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import {
  attemptTelemetrySync,
  markTelemetrySyncQueued,
  normalizeTelemetrySyncConfig,
} from "./telemetry-sync-client.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const LEDGER_SCHEMA_VERSION = "private-beta-metrics-ledger/v1";
const METRICS_SCHEMA_VERSION = "private-beta-metrics/v1";
const SYNC_RESULT_SCHEMA_VERSION = "private-beta-metrics-sync-result/v1";
const DEFAULT_LIMIT = 100;
const MAX_OBSERVATIONS = 500;

export function createPrivateBetaMetricsService({
  appDir = process.cwd(),
  metricsPath,
  syncUrl = "",
  syncToken = "",
  installId = "",
  telemetryMode = "safe",
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  idFactory = () => `metrics_${randomUUID()}`,
  sampleRuntime,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = metricsPath || path.join(root, ".local", "private-beta-metrics-ledger.json");
  const syncConfig = normalizeTelemetrySyncConfig({ syncUrl, syncToken, installId, fetchImpl });
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  const latencyObservations = [];
  const runtimeSampler = typeof sampleRuntime === "function"
    ? sampleRuntime
    : () => sampleRuntimeMetrics({ appDir: root });
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: (store) => formatJsonStore(normalizeStore(store)),
  });

  function observeRequest(input = {}) {
    const observedAt = isoNow(now);
    const durationMs = clampNumber(input.durationMs, 0, 24 * 60 * 60 * 1000);
    latencyObservations.push({
      route: normalizeRoute(input),
      statusCode: normalizeStatusCode(input.statusCode),
      durationMs,
      visibleProgress: input.visibleProgress !== false,
      observedAt,
    });
    while (latencyObservations.length > MAX_OBSERVATIONS) latencyObservations.shift();
  }

  async function captureRuntimeSnapshot(input = {}) {
    return writeMutatedStore(async (store) => {
      const createdAt = isoNow(now);
      const runtime = sanitizeRuntimeMetrics(await runtimeSampler());
      const latency = summarizeRequestLatency(latencyObservations);
      const deployment = sanitizeDeployment(input.deployment || {});
      const scores = scoreSnapshot({ deployment, runtime, latency });
      const metric = normalizeMetric({
        schema_version: METRICS_SCHEMA_VERSION,
        id: validId(input.id) || idFactory(),
        telemetryMode: normalizedTelemetryMode,
        createdAt,
        deployment,
        runtime,
        latency,
        scores,
      });
      metric.sync = markTelemetrySyncQueued({
        syncConfig,
        previousSync: metric.sync,
        normalizeSync,
      });
      store.metrics.push(metric);
      if (store.metrics.length > 300) store.metrics.splice(0, store.metrics.length - 300);
      return metric;
    });
  }

  async function listMetrics(filters = {}) {
    const store = await loadStore();
    const limit = parseLimit(filters.limit);
    return {
      schema_version: LEDGER_SCHEMA_VERSION,
      metrics: store.metrics
        .sort(compareNewestMetricFirst)
        .slice(0, limit),
    };
  }

  async function syncQueuedMetrics(filters = {}) {
    return writeMutatedStore(async (store) => {
      const limit = parseLimit(filters.limit);
      const candidates = store.metrics
        .filter((metric) => metric.sync?.status === "queued")
        .sort(compareOldestSyncFirst)
        .slice(0, limit);
      const result = {
        schema_version: SYNC_RESULT_SCHEMA_VERSION,
        attempted: 0,
        sent: 0,
        queued: 0,
        failed: 0,
        skipped: 0,
      };
      for (const metric of candidates) {
        result.attempted += 1;
        metric.sync = await attemptSync(metric, metric.sync);
        metric.updatedAt = metric.sync.lastAttemptAt || metric.updatedAt;
        if (metric.sync.status === "sent") result.sent += 1;
        else if (metric.sync.status === "queued") result.queued += 1;
        else if (metric.sync.status === "not_configured") result.skipped += 1;
        else result.failed += 1;
      }
      return result;
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

  async function attemptSync(metric, previousSync = {}) {
    return attemptTelemetrySync({
      syncConfig,
      previousSync,
      normalizeSync,
      now,
      buildPayload: (install) => buildSyncPayload(metric, install),
      sanitizeError: (message) => sanitizeText(message, 300).trim(),
    });
  }

  return {
    observeRequest,
    captureRuntimeSnapshot,
    listMetrics,
    syncQueuedMetrics,
  };
}

export function summarizeRequestLatency(observations = []) {
  const normalized = observations
    .map((item) => ({
      route: sanitizeText(item.route || "UNKNOWN /", 120).trim() || "UNKNOWN /",
      statusCode: normalizeStatusCode(item.statusCode),
      durationMs: Math.round(clampNumber(item.durationMs, 0, 24 * 60 * 60 * 1000)),
      visibleProgress: item.visibleProgress !== false,
    }))
    .filter((item) => Number.isFinite(item.durationMs));
  const durations = normalized.map((item) => item.durationMs).sort((a, b) => a - b);
  const requestCount = normalized.length;
  const errorCount = normalized.filter((item) => item.statusCode >= 500).length;
  const slowRequestCount = normalized.filter((item) => item.durationMs >= 8000).length;
  const silentWaitMaxMs = normalized
    .filter((item) => item.visibleProgress === false)
    .reduce((max, item) => Math.max(max, item.durationMs), 0);
  const byRoute = [...groupByRoute(normalized).values()]
    .map((items) => {
      const routeDurations = items.map((item) => item.durationMs).sort((a, b) => a - b);
      return {
        route: items[0].route,
        count: items.length,
        errors: items.filter((item) => item.statusCode >= 500).length,
        p95Ms: percentile(routeDurations, 0.95),
        maxMs: routeDurations.at(-1) || 0,
      };
    })
    .sort((left, right) => right.count - left.count || right.p95Ms - left.p95Ms)
    .slice(0, 12);

  return {
    requestCount,
    errorCount,
    p50Ms: percentile(durations, 0.50),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations.at(-1) || 0,
    slowRequestCount,
    silentWaitMaxMs,
    byRoute,
  };
}

export async function sampleRuntimeMetrics({ appDir = process.cwd() } = {}) {
  const memory = process.memoryUsage();
  const disk = await sampleDisk(appDir);
  return sanitizeRuntimeMetrics({
    uptimeSeconds: Math.round(process.uptime()),
    rssMb: bytesToMb(memory.rss),
    heapUsedMb: bytesToMb(memory.heapUsed),
    loadAverage1m: os.loadavg?.()[0] || 0,
    cpuCount: os.cpus?.().length || 0,
    ...disk,
  });
}

function scoreSnapshot({ deployment = {}, runtime = {}, latency = {} } = {}) {
  const backendSuitability = clampScore(100
    - (latency.p95Ms >= 15000 ? 20 : latency.p95Ms >= 8000 ? 10 : 0)
    - (latency.silentWaitMaxMs >= 15000 ? 15 : latency.silentWaitMaxMs >= 8000 ? 8 : 0)
    - (latency.requestCount && latency.errorCount / latency.requestCount >= 0.10 ? 15 : 0)
    - (runtime.diskFreePercent > 0 && runtime.diskFreePercent < 20 ? 30 : runtime.diskFreePercent < 40 ? 15 : 0)
    - (runtime.loadAverage1m && runtime.cpuCount && runtime.loadAverage1m / runtime.cpuCount > 1.5 ? 10 : 0));
  const portability = clampScore(100
    - (!deployment.commit ? 10 : 0)
    - (deployment.storageMode !== "postgres" ? 20 : 0)
    - (isLocalBaseUrl(deployment.baseUrl) ? 10 : 0)
    - (deployment.restoreDrill !== "passed" ? 20 : 0)
    - (deployment.storageBackup !== "verified" ? 20 : 0));
  const restoreConfidence = clampScore(100
    - (deployment.restoreDrill !== "passed" ? 40 : 0)
    - (deployment.storageBackup !== "verified" ? 20 : 0));
  const capacityHeadroom = clampScore(100
    - (runtime.diskFreePercent > 0 ? Math.max(0, 40 - runtime.diskFreePercent) : 15)
    - (latency.p95Ms >= 15000 ? 15 : 0));
  return {
    backendSuitability,
    portability,
    restoreConfidence,
    capacityHeadroom,
    userPatienceRisk: patienceRisk(latency),
  };
}

function patienceRisk(latency = {}) {
  if ((latency.silentWaitMaxMs || 0) >= 30000 || (latency.p95Ms || 0) >= 30000) return "high";
  if ((latency.silentWaitMaxMs || 0) >= 12000 || (latency.p95Ms || 0) >= 8000) return "medium";
  return "low";
}

function normalizeMetric(input = {}) {
  const createdAt = normalizeIso(input.createdAt) || new Date().toISOString();
  return {
    schema_version: METRICS_SCHEMA_VERSION,
    id: validId(input.id) || `metrics_${randomUUID()}`,
    telemetryMode: normalizeTelemetryMode(input.telemetryMode),
    createdAt,
    updatedAt: normalizeIso(input.updatedAt) || createdAt,
    deployment: sanitizeDeployment(input.deployment || {}),
    runtime: sanitizeRuntimeMetrics(input.runtime || {}),
    latency: sanitizeLatency(input.latency || {}),
    scores: sanitizeScores(input.scores || {}),
    sync: normalizeSync(input.sync),
  };
}

function buildSyncPayload(metric, installId) {
  const safeMetric = normalizeMetric(metric);
  delete safeMetric.sync;
  return {
    schema_version: "private-beta-metrics-sync/v1",
    installId,
    metric: safeMetric,
  };
}

function emptyStore() {
  return { schema_version: LEDGER_SCHEMA_VERSION, metrics: [] };
}

function normalizeStore(store = {}) {
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    metrics: Array.isArray(store.metrics) ? store.metrics.map((item) => normalizeMetric(item)) : [],
  };
}

function sanitizeDeployment(deployment = {}) {
  return {
    commit: sanitizeText(deployment.commit, 80).trim(),
    baseUrl: sanitizeText(deployment.baseUrl, 240).trim(),
    storageMode: sanitizeText(deployment.storageMode, 40).trim(),
    runtimeMode: sanitizeText(deployment.runtimeMode, 80).trim(),
    restoreDrill: sanitizeText(deployment.restoreDrill || "unknown", 40).trim() || "unknown",
    storageBackup: sanitizeText(deployment.storageBackup || "unknown", 40).trim() || "unknown",
  };
}

function sanitizeRuntimeMetrics(runtime = {}) {
  return {
    uptimeSeconds: Math.max(0, Math.round(Number(runtime.uptimeSeconds) || 0)),
    rssMb: roundNumber(runtime.rssMb),
    heapUsedMb: roundNumber(runtime.heapUsedMb),
    loadAverage1m: roundNumber(runtime.loadAverage1m),
    cpuCount: Math.max(0, Math.round(Number(runtime.cpuCount) || 0)),
    diskFreePercent: roundNumber(runtime.diskFreePercent),
    diskFreeGb: roundNumber(runtime.diskFreeGb),
    diskTotalGb: roundNumber(runtime.diskTotalGb),
  };
}

function sanitizeLatency(latency = {}) {
  return {
    requestCount: Math.max(0, Math.round(Number(latency.requestCount) || 0)),
    errorCount: Math.max(0, Math.round(Number(latency.errorCount) || 0)),
    p50Ms: Math.max(0, Math.round(Number(latency.p50Ms) || 0)),
    p95Ms: Math.max(0, Math.round(Number(latency.p95Ms) || 0)),
    maxMs: Math.max(0, Math.round(Number(latency.maxMs) || 0)),
    slowRequestCount: Math.max(0, Math.round(Number(latency.slowRequestCount) || 0)),
    silentWaitMaxMs: Math.max(0, Math.round(Number(latency.silentWaitMaxMs) || 0)),
    byRoute: Array.isArray(latency.byRoute) ? latency.byRoute.slice(0, 12).map((route) => ({
      route: sanitizeText(route.route, 120).trim(),
      count: Math.max(0, Math.round(Number(route.count) || 0)),
      errors: Math.max(0, Math.round(Number(route.errors) || 0)),
      p95Ms: Math.max(0, Math.round(Number(route.p95Ms) || 0)),
      maxMs: Math.max(0, Math.round(Number(route.maxMs) || 0)),
    })) : [],
  };
}

function sanitizeScores(scores = {}) {
  return {
    backendSuitability: clampScore(scores.backendSuitability),
    portability: clampScore(scores.portability),
    restoreConfidence: clampScore(scores.restoreConfidence),
    capacityHeadroom: clampScore(scores.capacityHeadroom),
    userPatienceRisk: ["low", "medium", "high"].includes(scores.userPatienceRisk) ? scores.userPatienceRisk : "low",
  };
}

async function sampleDisk(appDir) {
  try {
    const stats = await statfs(appDir);
    const totalBytes = Number(stats.blocks || 0) * Number(stats.bsize || 0);
    const freeBytes = Number(stats.bavail || 0) * Number(stats.bsize || 0);
    return {
      diskFreePercent: totalBytes > 0 ? Math.round((freeBytes / totalBytes) * 1000) / 10 : 0,
      diskFreeGb: bytesToGb(freeBytes),
      diskTotalGb: bytesToGb(totalBytes),
    };
  } catch {
    return { diskFreePercent: 0, diskFreeGb: 0, diskTotalGb: 0 };
  }
}

function groupByRoute(items = []) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.route)) groups.set(item.route, []);
    groups.get(item.route).push(item);
  }
  return groups;
}

function normalizeRoute(input = {}) {
  const method = sanitizeText(input.method || "", 12).trim().toUpperCase() || "GET";
  const pathname = sanitizeText(input.pathname || input.path || "", 120).trim() || "/";
  return `${method} ${pathname}`;
}

function normalizeSync(sync = {}) {
  if (!sync || typeof sync !== "object" || Array.isArray(sync)) return { status: "not_configured", attempts: 0 };
  const status = ["not_configured", "queued", "sent", "failed"].includes(sync.status)
    ? sync.status
    : "not_configured";
  const normalized = { status, attempts: Math.max(0, Math.trunc(Number(sync.attempts) || 0)) };
  const lastAttemptAt = normalizeIso(sync.lastAttemptAt);
  const sentAt = normalizeIso(sync.sentAt);
  if (lastAttemptAt) normalized.lastAttemptAt = lastAttemptAt;
  if (sentAt) normalized.sentAt = sentAt;
  if (typeof sync.endpointHost === "string" && sync.endpointHost.trim()) normalized.endpointHost = sanitizeText(sync.endpointHost, 120).trim();
  if (typeof sync.lastError === "string" && sync.lastError.trim()) normalized.lastError = sanitizeText(sync.lastError, 300).trim();
  return normalized;
}

function compareNewestMetricFirst(a, b) {
  return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
}

function compareOldestSyncFirst(a, b) {
  return Date.parse(a.sync?.lastAttemptAt || a.createdAt || 0) - Date.parse(b.sync?.lastAttemptAt || b.createdAt || 0);
}

function percentile(sortedDurations = [], ratio = 0.95) {
  if (!sortedDurations.length) return 0;
  const index = Math.min(sortedDurations.length - 1, Math.max(0, Math.ceil(sortedDurations.length * ratio) - 1));
  return sortedDurations[index];
}

function normalizeStatusCode(value) {
  const statusCode = Number(value);
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : 200;
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
  return now().toISOString();
}

function normalizeTelemetryMode(value) {
  return String(value || "").trim().toLowerCase() === "firm_internal" ? "firm_internal" : "safe";
}

function sanitizeText(value, maxLength = 500) {
  return redactSensitiveText(String(value ?? "")).slice(0, maxLength);
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function roundNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0;
}

function bytesToMb(value) {
  return Math.round((Number(value) || 0) / 1024 / 1024);
}

function bytesToGb(value) {
  return Math.round((Number(value) || 0) / 1024 / 1024 / 102.4) / 10;
}

function isLocalBaseUrl(value = "") {
  return /(^|\/\/)(127\.0\.0\.1|localhost)(:|\/|$)/i.test(String(value || ""));
}

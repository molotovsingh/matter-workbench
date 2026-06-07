import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

const LEDGER_SCHEMA_VERSION = "private-beta-feedback-ledger/v1";
const FEEDBACK_SCHEMA_VERSION = "private-beta-feedback/v1";
const DEFAULT_LIMIT = 100;
const ALLOWED_CHOICES = new Set(["did_not_work", "confused", "want_something"]);
const CLASSIFICATION_BY_CHOICE = {
  did_not_work: "bug",
  confused: "confusing_ux",
  want_something: "feature_idea",
};

export function createPrivateBetaFeedbackService({
  appDir = process.cwd(),
  feedbackPath,
  syncUrl = "",
  syncToken = "",
  installId = "",
  telemetryMode = "safe",
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  idFactory = () => `feedback_${randomUUID()}`,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = feedbackPath || path.join(root, ".local", "private-beta-feedback-ledger.json");
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  const syncConfig = normalizeSyncConfig({ syncUrl, syncToken, installId, fetchImpl });
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: (store) => formatJsonStore(normalizeStore(store)),
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

  async function createFeedback(input = {}) {
    return writeMutatedStore(async (store) => {
      const createdAt = isoNow(now);
      const feedback = normalizeFeedback({
        ...input,
        id: validId(input.id) || idFactory(),
        schema_version: FEEDBACK_SCHEMA_VERSION,
        createdAt,
        updatedAt: createdAt,
        status: "new",
      }, { telemetryMode: normalizedTelemetryMode });
      feedback.sync = await attemptSync(feedback, feedback.sync);
      feedback.updatedAt = feedback.sync.lastAttemptAt || feedback.updatedAt;
      store.feedback.push(feedback);
      if (feedback.sync.status === "sent") {
        await syncQueuedItems(store, { excludeId: feedback.id, limit: 10 });
      }
      return feedback;
    });
  }

  async function listFeedback(filters = {}) {
    const store = await loadStore();
    const limit = parseLimit(filters.limit);
    const status = stringOr(filters.status, "");
    const classification = stringOr(filters.classification, "");
    const feedback = store.feedback
      .filter((item) => !status || item.status === status)
      .filter((item) => !classification || item.classification === classification)
      .sort(compareNewestFeedbackFirst)
      .slice(0, limit);
    return {
      schema_version: LEDGER_SCHEMA_VERSION,
      feedback,
    };
  }

  async function syncQueuedFeedback(filters = {}) {
    return writeMutatedStore(async (store) => {
      const limit = parseLimit(filters.limit);
      return syncQueuedItems(store, { limit });
    });
  }

  return {
    createFeedback,
    listFeedback,
    syncQueuedFeedback,
  };

  async function attemptSync(feedback, previousSync = {}) {
    const previous = normalizeSync(previousSync);
    if (!syncConfig.url || !syncConfig.fetchImpl) {
      return {
        ...previous,
        status: "not_configured",
        attempts: previous.attempts || 0,
      };
    }

    const attemptedAt = isoNow(now);
    const attempts = (previous.attempts || 0) + 1;
    const endpointHost = syncConfig.url.hostname;
    try {
      const response = await syncConfig.fetchImpl(syncConfig.url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(syncConfig.token ? { Authorization: `Bearer ${syncConfig.token}` } : {}),
        },
        body: JSON.stringify(buildSyncPayload(feedback, syncConfig.installId)),
      });
      if (!response?.ok) {
        const body = typeof response?.text === "function" ? await response.text().catch(() => "") : "";
        throw new Error(`mothership returned ${response?.status || "unknown"}${body ? `: ${body}` : ""}`);
      }
      return {
        status: "sent",
        attempts,
        lastAttemptAt: attemptedAt,
        sentAt: attemptedAt,
        endpointHost,
      };
    } catch (error) {
      return {
        status: "queued",
        attempts,
        lastAttemptAt: attemptedAt,
        endpointHost,
        lastError: sanitizeText(error?.message || "sync failed", 300).trim(),
      };
    }
  }

  async function syncQueuedItems(store, { excludeId = "", limit = DEFAULT_LIMIT } = {}) {
    const candidates = store.feedback
      .filter((item) => item.id !== excludeId)
      .filter((item) => item.sync?.status === "queued")
      .sort(compareOldestSyncFirst)
      .slice(0, limit);
    const result = {
      schema_version: "private-beta-feedback-sync-result/v1",
      attempted: 0,
      sent: 0,
      queued: 0,
      failed: 0,
      skipped: 0,
    };

    for (const item of candidates) {
      result.attempted += 1;
      item.sync = await attemptSync(item, item.sync);
      item.updatedAt = item.sync.lastAttemptAt || item.updatedAt;
      if (item.sync.status === "sent") result.sent += 1;
      else if (item.sync.status === "queued") result.queued += 1;
      else if (item.sync.status === "not_configured") result.skipped += 1;
      else result.failed += 1;
    }
    return result;
  }
}

export function normalizeFeedback(input = {}, { telemetryMode = "safe" } = {}) {
  const normalizedTelemetryMode = normalizeTelemetryMode(input.telemetryMode || telemetryMode);
  const choice = normalizeChoice(input.choice);
  const tryingToDo = sanitizeText(input.tryingToDo, 1000).trim();
  if (!tryingToDo) {
    throw makeHttpError("What were you trying to do? is required", 400);
  }

  const createdAt = normalizeIso(input.createdAt) || isoNow(() => new Date());
  const feedback = {
    schema_version: FEEDBACK_SCHEMA_VERSION,
    id: validId(input.id) || `feedback_${randomUUID()}`,
    choice,
    classification: CLASSIFICATION_BY_CHOICE[choice],
    status: normalizeStatus(input.status),
    telemetryMode: normalizedTelemetryMode,
    tryingToDo,
    createdAt,
    updatedAt: normalizeIso(input.updatedAt) || createdAt,
    context: sanitizeContext(input.context || {}, { telemetryMode: normalizedTelemetryMode }),
    sync: normalizeSync(input.sync),
  };

  const happenedInstead = sanitizeText(input.happenedInstead, 1000).trim();
  if (happenedInstead) feedback.happenedInstead = happenedInstead;
  if (input.operatorNotes) feedback.operatorNotes = sanitizeText(input.operatorNotes, 1000).trim();
  return feedback;
}

export function formatPrivateBetaFeedbackReport(feedback = {}) {
  const item = normalizeFeedback(feedback);
  const lines = [
    "Private beta feedback",
    "",
    `ID: ${item.id}`,
    `Created: ${item.createdAt}`,
    `Choice: ${formatChoice(item.choice)}`,
    `Classification: ${item.classification}`,
    `Status: ${item.status}`,
  ];
  if (item.context?.activeMatterName) lines.push(`Matter: ${item.context.activeMatterName}`);
  if (item.context?.screen) lines.push(`Screen: ${item.context.screen}`);
  if (item.context?.route) lines.push(`Route: ${item.context.route}`);
  lines.push("", "What were you trying to do?", item.tryingToDo);
  if (item.happenedInstead) lines.push("", "What happened instead?", item.happenedInstead);
  if (item.context?.recentActivity?.length) {
    lines.push("", "Recent activity");
    for (const line of item.context.recentActivity) lines.push(`- ${line}`);
  }
  if (item.context?.providerRoutes?.length) {
    lines.push("", "Provider routes");
    for (const route of item.context.providerRoutes) {
      lines.push(`- ${route.task || "task"}: ${route.provider || "unknown"} / ${route.model || "unknown"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function emptyStore() {
  return { schema_version: LEDGER_SCHEMA_VERSION, feedback: [] };
}

function normalizeStore(store = {}, { telemetryMode = "safe" } = {}) {
  const feedback = [];
  if (Array.isArray(store.feedback)) {
    for (const item of store.feedback) {
      try {
        feedback.push(normalizeFeedback(item, { telemetryMode }));
      } catch {
        // Historical or manually edited beta feedback rows should not disable
        // the whole ledger. New writes still use strict normalizeFeedback().
      }
    }
  }
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    feedback,
  };
}

function buildSyncPayload(feedback, installId) {
  const safeFeedback = normalizeFeedback(feedback, { telemetryMode: feedback.telemetryMode || "safe" });
  delete safeFeedback.sync;
  return {
    schema_version: "private-beta-feedback-sync/v1",
    installId,
    feedback: safeFeedback,
  };
}

function normalizeSyncConfig({ syncUrl, syncToken, installId, fetchImpl }) {
  const url = parseSyncUrl(syncUrl);
  return {
    url,
    token: stringOr(syncToken, ""),
    installId: sanitizeText(installId || "local-beta-install", 120).trim() || "local-beta-install",
    fetchImpl: typeof fetchImpl === "function" ? fetchImpl : null,
  };
}

function parseSyncUrl(value) {
  const text = stringOr(value, "");
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
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

function sanitizeContext(context = {}, { telemetryMode = "safe" } = {}) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  const safe = {};
  const simpleFields = [
    "screen",
    "route",
    "currentView",
    "activeMatterName",
    "activeMatterFolder",
    "lastCommand",
    "lastAction",
    "runtimeMode",
    "appVersion",
    "commit",
    "viewport",
    "visibleError",
  ];
  for (const field of simpleFields) {
    if (typeof context[field] === "string" && context[field].trim()) {
      safe[field] = sanitizeText(context[field], 300).trim();
    }
  }
  if (normalizedTelemetryMode === "firm_internal") {
    const richFields = [
      "providerPrompt",
      "sourceText",
      "generatedOutput",
      "visibleText",
      "selectedText",
      "errorDetail",
      "debugDetail",
      "jobError",
      "advisoryDetail",
    ];
    for (const field of richFields) {
      if (typeof context[field] === "string" && context[field].trim()) {
        safe[field] = sanitizeText(context[field], 4000).trim();
      }
    }
  }
  if (Array.isArray(context.recentActivity)) {
    safe.recentActivity = context.recentActivity
      .filter((line) => typeof line === "string" && line.trim())
      .slice(normalizedTelemetryMode === "firm_internal" ? -30 : -8)
      .map((line) => sanitizeText(line, normalizedTelemetryMode === "firm_internal" ? 1000 : 300).trim());
  }
  if (Array.isArray(context.providerRoutes)) {
    safe.providerRoutes = context.providerRoutes
      .filter((route) => route && typeof route === "object" && !Array.isArray(route))
      .slice(0, 10)
      .map((route) => ({
        task: sanitizeText(route.task || "", 80).trim(),
        provider: sanitizeText(route.provider || "", 80).trim(),
        model: sanitizeText(route.model || "", 120).trim(),
      }))
      .filter((route) => route.task || route.provider || route.model);
  }
  return safe;
}

function normalizeTelemetryMode(value) {
  return String(value || "").trim().toLowerCase() === "firm_internal" ? "firm_internal" : "safe";
}

function normalizeChoice(choice) {
  const value = stringOr(choice, "");
  if (!ALLOWED_CHOICES.has(value)) {
    throw makeHttpError("choice must be one of: did_not_work, confused, want_something", 400);
  }
  return value;
}

function normalizeStatus(status) {
  const value = stringOr(status, "new");
  if (["new", "reviewed", "needs_evidence", "fixed", "parked", "not_reproducible"].includes(value)) return value;
  return "new";
}

function formatChoice(choice) {
  if (choice === "did_not_work") return "Something did not work";
  if (choice === "confused") return "I got confused";
  if (choice === "want_something") return "I want this to do something";
  return choice || "Unknown";
}

function sanitizeText(value, maxLength = 500) {
  return redactSecretLikeText(String(value ?? "")).slice(0, maxLength);
}

function redactSecretLikeText(text) {
  return text
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/g, "$1=[redacted-secret]")
    .replace(/\b(password|token|secret)\s*[:=]\s*([^\s"'`]+)/gi, "$1=[redacted-secret]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[redacted-secret]");
}

function compareNewestFeedbackFirst(a, b) {
  return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
}

function compareOldestSyncFirst(a, b) {
  return Date.parse(a.sync?.lastAttemptAt || a.createdAt || 0) - Date.parse(b.sync?.lastAttemptAt || b.createdAt || 0);
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
  const text = stringOr(value, "");
  return /^[a-zA-Z0-9_-]{3,120}$/.test(text) ? text : "";
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

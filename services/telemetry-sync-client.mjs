const DEFAULT_SYNC_TIMEOUT_MS = 10_000;

export function normalizeTelemetrySyncConfig({
  syncUrl = "",
  syncToken = "",
  installId = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
} = {}) {
  const url = normalizeUrl(syncUrl);
  return {
    url,
    token: String(syncToken || "").trim().slice(0, 500),
    installId: String(installId || "local-beta-install").trim().slice(0, 120) || "local-beta-install",
    fetchImpl: typeof fetchImpl === "function" ? fetchImpl : null,
    timeoutMs: normalizeTimeoutMs(timeoutMs),
  };
}

export async function attemptTelemetrySync({
  syncConfig,
  previousSync = {},
  normalizeSync,
  now,
  buildPayload,
  sanitizeError,
} = {}) {
  const previous = typeof normalizeSync === "function"
    ? normalizeSync(previousSync)
    : normalizeDefaultSync(previousSync);
  if (!syncConfig?.url || !syncConfig.fetchImpl) {
    return {
      ...previous,
      status: "not_configured",
      attempts: previous.attempts || 0,
    };
  }

  const attemptedAt = isoNow(now);
  const attempts = (previous.attempts || 0) + 1;
  const endpointHost = syncConfig.url.hostname;
  const timeout = createSyncTimeout(syncConfig.timeoutMs);
  try {
    const response = await syncConfig.fetchImpl(syncConfig.url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(syncConfig.token ? { Authorization: `Bearer ${syncConfig.token}` } : {}),
      },
      body: JSON.stringify(buildPayload(syncConfig.installId)),
      ...(timeout.signal ? { signal: timeout.signal } : {}),
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
    const message = typeof sanitizeError === "function"
      ? sanitizeError(error?.message || "sync failed")
      : String(error?.message || "sync failed").slice(0, 300);
    return {
      status: "queued",
      attempts,
      lastAttemptAt: attemptedAt,
      endpointHost,
      lastError: message,
    };
  } finally {
    timeout.clear();
  }
}

export function markTelemetrySyncQueued({ syncConfig, previousSync = {}, normalizeSync } = {}) {
  const previous = typeof normalizeSync === "function"
    ? normalizeSync(previousSync)
    : normalizeDefaultSync(previousSync);
  if (!syncConfig?.url || !syncConfig.fetchImpl) {
    return {
      ...previous,
      status: "not_configured",
      attempts: previous.attempts || 0,
    };
  }
  return {
    ...previous,
    status: "queued",
  };
}

export async function syncTelemetryItemOutsideLock({
  writeMutatedStore,
  selectItems,
  item,
  attemptSync,
} = {}) {
  if (!item || typeof item !== "object") return item;
  const sync = typeof attemptSync === "function" ? await attemptSync(item, item.sync) : item.sync;
  const synced = {
    ...item,
    sync,
    updatedAt: sync?.lastAttemptAt || item.updatedAt,
  };
  if (typeof writeMutatedStore !== "function" || typeof selectItems !== "function") return synced;
  await writeMutatedStore(async (store) => {
    const items = selectItems(store);
    if (!Array.isArray(items)) return null;
    const index = items.findIndex((candidate) => candidate?.id === item.id);
    if (index < 0) return null;
    items[index].sync = sync;
    items[index].updatedAt = sync?.lastAttemptAt || items[index].updatedAt;
    return null;
  });
  return synced;
}

export async function drainQueuedTelemetrySync({
  loadStore,
  writeMutatedStore,
  selectItems,
  attemptSync,
  schemaVersion = "telemetry-sync-result/v1",
  excludeId = "",
  limit = 100,
} = {}) {
  const result = emptyTelemetrySyncResult(schemaVersion);
  if (typeof loadStore !== "function" || typeof writeMutatedStore !== "function" || typeof selectItems !== "function") {
    result.skipped += 1;
    return result;
  }
  const store = await loadStore();
  const candidates = (Array.isArray(selectItems(store)) ? selectItems(store) : [])
    .filter((item) => item?.id !== excludeId)
    .filter((item) => item?.sync?.status === "queued")
    .sort(compareOldestTelemetrySyncFirst)
    .slice(0, normalizeLimit(limit));

  for (const item of candidates) {
    result.attempted += 1;
    const synced = await syncTelemetryItemOutsideLock({
      writeMutatedStore,
      selectItems,
      item,
      attemptSync,
    });
    tallyTelemetrySyncStatus(result, synced?.sync?.status);
  }
  return result;
}

export function tallyTelemetrySyncStatus(result, status) {
  if (status === "sent") result.sent += 1;
  else if (status === "queued") result.queued += 1;
  else if (status === "not_configured") result.skipped += 1;
  else result.failed += 1;
  return result;
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeTimeoutMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_SYNC_TIMEOUT_MS;
  return Math.min(Math.round(number), 60_000);
}

function createSyncTimeout(timeoutMs) {
  if (!timeoutMs || typeof AbortController === "undefined") {
    return { signal: undefined, clear: () => {} };
  }
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return { signal: AbortSignal.timeout(timeoutMs), clear: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function normalizeDefaultSync(sync = {}) {
  if (!sync || typeof sync !== "object" || Array.isArray(sync)) {
    return { status: "not_configured", attempts: 0 };
  }
  const status = ["not_configured", "queued", "sent", "failed"].includes(sync.status)
    ? sync.status
    : "not_configured";
  return {
    ...sync,
    status,
    attempts: Number.isFinite(Number(sync.attempts)) ? Math.max(0, Math.round(Number(sync.attempts))) : 0,
  };
}

function emptyTelemetrySyncResult(schemaVersion) {
  return {
    schema_version: schemaVersion,
    attempted: 0,
    sent: 0,
    queued: 0,
    failed: 0,
    skipped: 0,
  };
}

function compareOldestTelemetrySyncFirst(a, b) {
  return Date.parse(a.sync?.lastAttemptAt || a.createdAt || 0) - Date.parse(b.sync?.lastAttemptAt || b.createdAt || 0);
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(Math.trunc(parsed), 500);
}

function isoNow(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

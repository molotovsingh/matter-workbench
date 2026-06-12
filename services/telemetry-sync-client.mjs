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

function isoNow(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

import { createServer } from "node:http";

import { buildMothershipReport, filterMothershipReport } from "./report.mjs";
import {
  httpError,
  readBearerToken,
  readJsonBody,
  redactErrorText,
  sendJson,
  serveStaticAsset,
} from "./http.mjs";

const FEEDBACK_SYNC_SCHEMA = "private-beta-feedback-sync/v1";
const SIGNAL_SYNC_SCHEMA = "private-beta-signal-sync/v1";
const METRICS_SYNC_SCHEMA = "private-beta-metrics-sync/v1";
const HEARTBEAT_SYNC_SCHEMA = "private-beta-heartbeat-sync/v1";

const CONSOLE_API_PREFIX = "/api/";
const INSTALLATION_REVOKE_RE = /^\/api\/installations\/([^/]+)\/revoke$/;
const INSTALLATION_REPORT_RE = /^\/api\/installations\/([^/]+)\/report$/;
const FEEDBACK_STATUS_RE = /^\/api\/feedback\/([^/]+)\/([^/]+)\/status$/;
const SIGNAL_STATUS_RE = /^\/api\/signals\/([^/]+)\/([^/]+)\/status$/;

export function createMothershipServer({
  store,
  consoleAuth = null,
  consoleAssetRoot = null,
  maxBodyBytes = 256 * 1024,
  log = console,
} = {}) {
  if (!store) throw new Error("Mothership server requires a store.");

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        if (request.method !== "GET") throw httpError("Method not allowed", 405);
        const health = await store.health();
        sendJson(response, health.database === "ready" ? 200 : 503, {
          schema_version: "mothership-health/v1",
          status: health.database === "ready" ? "ready" : "unavailable",
          database: health.database,
        });
        return;
      }

      const handledApi = await routeConsoleApi({
        request,
        url,
        response,
        store,
        consoleAuth,
        maxBodyBytes,
      });
      if (handledApi) return;

      if (url.pathname === "/v1/feedback" || url.pathname === "/v1/signals"
        || url.pathname === "/v1/metrics" || url.pathname === "/v1/heartbeats") {
        if (request.method !== "POST") throw httpError("Method not allowed", 405);

        const rawToken = readBearerToken(request);
        const payload = await readJsonBody(request, { maxBodyBytes });
        const kind = url.pathname === "/v1/feedback"
          ? "feedback"
          : url.pathname === "/v1/signals"
            ? "signal"
            : url.pathname === "/v1/metrics"
              ? "metric"
              : "heartbeat";
        validateSyncPayload(payload, kind);
        await store.authorizeIngestion({ rawToken, installationId: payload.installId });
        const result = await ingestPayload({ store, kind, payload });
        sendJson(response, 202, {
          accepted: true,
          duplicate: !result.inserted,
          schema_version: "mothership-ingestion-result/v1",
        });
        return;
      }

      if (consoleAssetRoot && request.method === "GET" && !url.pathname.startsWith(CONSOLE_API_PREFIX)) {
        const served = await serveStaticAsset({ assetRoot: consoleAssetRoot, requestUrl: url, response });
        if (served) return;
      }

      throw httpError("Not found", 404);
    } catch (error) {
      const statusCode = normalizeStatusCode(error?.statusCode);
      if (statusCode >= 500) log.error?.(`mothership request failed: ${redactErrorText(error?.message)}`);
      sendJson(response, statusCode, {
        accepted: false,
        error: statusCode >= 500 ? "Mothership unavailable" : redactErrorText(error?.message),
        schema_version: "mothership-error/v1",
      });
    }
  });

  return { server };
}

async function routeConsoleApi({ request, url, response, store, consoleAuth, maxBodyBytes }) {
  if (!url.pathname.startsWith(CONSOLE_API_PREFIX)) return false;

  if (url.pathname === "/api/auth/status") {
    if (request.method !== "GET") throw httpError("Method not allowed", 405);
    sendJson(response, 200, consoleAuth ? consoleAuth.status(request) : { enabled: false, authenticated: true, authMode: "disabled", user: null });
    return true;
  }

  if (url.pathname === "/api/auth/login") {
    if (request.method !== "POST") throw httpError("Method not allowed", 405);
    if (!consoleAuth) {
      sendJson(response, 200, { enabled: false, authenticated: true, authMode: "disabled", user: { username: "operator", role: "operator" } });
      return true;
    }
    const body = await readJsonBody(request, { maxBodyBytes: Math.min(maxBodyBytes, 16 * 1024) });
    const result = consoleAuth.login(body, { request });
    sendAuthResult(response, result);
    return true;
  }

  if (url.pathname === "/api/auth/request-code") {
    if (request.method !== "POST") throw httpError("Method not allowed", 405);
    if (!consoleAuth) {
      sendJson(response, 200, { ok: true, message: "Console auth is disabled." });
      return true;
    }
    const body = await readJsonBody(request, { maxBodyBytes: Math.min(maxBodyBytes, 16 * 1024) });
    const result = await consoleAuth.requestCode(body, { request });
    sendJson(response, result.statusCode, result.payload);
    return true;
  }

  if (url.pathname === "/api/auth/verify-code") {
    if (request.method !== "POST") throw httpError("Method not allowed", 405);
    if (!consoleAuth) {
      sendJson(response, 200, { enabled: false, authenticated: true, authMode: "disabled", user: { username: "operator", role: "operator" } });
      return true;
    }
    const body = await readJsonBody(request, { maxBodyBytes: Math.min(maxBodyBytes, 16 * 1024) });
    const result = consoleAuth.verifyCode(body, { request });
    sendAuthResult(response, result);
    return true;
  }

  if (url.pathname === "/api/auth/logout") {
    if (request.method !== "POST") throw httpError("Method not allowed", 405);
    if (consoleAuth) {
      const result = consoleAuth.logout(request);
      const headers = { "Content-Type": "application/json; charset=utf-8" };
      if (result.setCookie) headers["set-cookie"] = result.setCookie;
      response.writeHead(result.statusCode, headers);
      response.end(`${JSON.stringify(result.payload)}\n`);
      return true;
    }
    sendJson(response, 200, { enabled: false, authenticated: false, user: null });
    return true;
  }

  requireConsoleAuth(consoleAuth, request);

  if (url.pathname === "/api/installations") {
    if (request.method !== "GET") throw httpError("Method not allowed", 405);
    const sinceDays = readSinceDays(url);
    sendJson(response, 200, await store.listInstallations({ sinceDays }));
    return true;
  }

  if (url.pathname === "/api/report") {
    if (request.method !== "GET") throw httpError("Method not allowed", 405);
    const sinceDays = readSinceDays(url);
    const dataset = await store.queryReport({ sinceDays });
    const report = applyReportFilters(buildMothershipReport(dataset, { includeResolvedSignals: readIncludeResolvedSignals(url) }), url);
    sendJson(response, 200, report);
    return true;
  }

  const installationReportMatch = INSTALLATION_REPORT_RE.exec(url.pathname);
  if (installationReportMatch) {
    if (request.method !== "GET") throw httpError("Method not allowed", 405);
    const installationId = decodeURIComponent(installationReportMatch[1] || "");
    const sinceDays = readSinceDays(url);
    const dataset = await store.queryReport({ sinceDays, installationId });
    const report = applyReportFilters(buildMothershipReport(dataset, { includeResolvedSignals: readIncludeResolvedSignals(url) }), url);
    sendJson(response, 200, report);
    return true;
  }

  const revokeMatch = INSTALLATION_REVOKE_RE.exec(url.pathname);
  if (revokeMatch) {
    if (request.method !== "POST") throw httpError("Method not allowed", 405);
    const installationId = decodeURIComponent(revokeMatch[1] || "");
    const revoked = await store.revokeInstallation({ installationId });
    sendJson(response, revoked ? 200 : 404, {
      schema_version: "mothership-console-action/v1",
      action: "revoke_installation",
      installationId,
      revoked,
    });
    return true;
  }

  const feedbackStatusMatch = FEEDBACK_STATUS_RE.exec(url.pathname);
  if (feedbackStatusMatch) {
    if (request.method !== "POST") throw httpError("Method not allowed", 405);
    const installationId = decodeURIComponent(feedbackStatusMatch[1] || "");
    const feedbackId = decodeURIComponent(feedbackStatusMatch[2] || "");
    const body = await readJsonBody(request, { maxBodyBytes: Math.min(maxBodyBytes, 16 * 1024) });
    const actor = consoleAuth?.sessionUser?.(request)?.username || "operator";
    const result = await store.updateFeedbackStatus({
      installationId,
      feedbackId,
      status: body.status,
      actor,
      note: String(body.note || ""),
    });
    sendJson(response, result.updated ? 200 : 404, {
      schema_version: "mothership-console-action/v1",
      action: "update_feedback_status",
      ...result,
    });
    return true;
  }

  const signalStatusMatch = SIGNAL_STATUS_RE.exec(url.pathname);
  if (signalStatusMatch) {
    if (request.method !== "POST") throw httpError("Method not allowed", 405);
    const installationId = decodeURIComponent(signalStatusMatch[1] || "");
    const signalId = decodeURIComponent(signalStatusMatch[2] || "");
    const body = await readJsonBody(request, { maxBodyBytes: Math.min(maxBodyBytes, 16 * 1024) });
    const actor = consoleAuth?.sessionUser?.(request)?.username || "operator";
    const result = await store.updateSignalStatus({
      installationId,
      signalId,
      status: body.status,
      actor,
      note: String(body.note || ""),
    });
    sendJson(response, result.updated ? 200 : 404, {
      schema_version: "mothership-console-action/v1",
      action: "update_signal_status",
      ...result,
    });
    return true;
  }

  if (url.pathname.startsWith(CONSOLE_API_PREFIX)) throw httpError("Not found", 404);
  return false;
}

function sendAuthResult(response, result) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (result.setCookie) headers["set-cookie"] = result.setCookie;
  response.writeHead(result.statusCode, headers);
  response.end(`${JSON.stringify(result.payload)}\n`);
}

function requireConsoleAuth(consoleAuth, request) {
  if (!consoleAuth) return;
  if (consoleAuth.isAuthenticated(request)) return;
  throw httpError("Console login required", 401);
}

function readSinceDays(url) {
  const raw = url.searchParams.get("sinceDays") || url.searchParams.get("since-days") || "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.trunc(parsed), 365) : 30;
}

function readIncludeResolvedSignals(url) {
  const raw = url.searchParams.get("includeResolved")
    || url.searchParams.get("include-resolved")
    || url.searchParams.get("includeResolvedSignals")
    || "";
  return ["1", "true", "yes", "all"].includes(String(raw).trim().toLowerCase());
}

function applyReportFilters(report, url) {
  const actionLane = url.searchParams.get("action-lane") || url.searchParams.get("actionLane") || "";
  const severity = url.searchParams.get("severity") || "";
  const status = url.searchParams.get("status") || "";
  const limitRaw = url.searchParams.get("limit") || "";
  const limitNum = Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0 ? Math.min(Math.trunc(Number(limitRaw)), 500) : 0;
  if (!actionLane && !severity && !status && !limitNum) return report;
  try {
    return filterMothershipReport(report, {
      actionLane,
      severity,
      status,
      ...(limitNum ? { limit: limitNum } : {}),
    });
  } catch (error) {
    throw httpError(error?.message || "Invalid report filter", 400);
  }
}

function validateSyncPayload(payload, kind) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw httpError("Payload must be an object", 400);
  const expectedSchema = kind === "feedback"
    ? FEEDBACK_SYNC_SCHEMA
    : kind === "signal"
      ? SIGNAL_SYNC_SCHEMA
      : kind === "metric"
        ? METRICS_SYNC_SCHEMA
        : HEARTBEAT_SYNC_SCHEMA;
  if (payload.schema_version !== expectedSchema) throw httpError(`Expected ${expectedSchema}`, 400);
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(String(payload.installId || ""))) throw httpError("installId is invalid", 400);
  const item = payload[kind];
  if (!item || typeof item !== "object" || Array.isArray(item)) throw httpError(`${kind} is required`, 400);
  const itemSchema = kind === "feedback"
    ? "private-beta-feedback/v1"
    : kind === "signal"
      ? "private-beta-signal/v1"
      : kind === "metric"
        ? "private-beta-metrics/v1"
        : "private-beta-heartbeat/v1";
  if (item.schema_version !== itemSchema) throw httpError(`Expected ${itemSchema}`, 400);
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(String(item.id || ""))) throw httpError(`${kind}.id is invalid`, 400);
}

function ingestPayload({ store, kind, payload }) {
  if (kind === "feedback") {
    return store.ingestFeedback({ installationId: payload.installId, feedback: payload.feedback });
  }
  if (kind === "signal") {
    return store.ingestSignal({ installationId: payload.installId, signal: payload.signal });
  }
  if (kind === "metric") {
    return store.ingestMetricSnapshot({ installationId: payload.installId, metric: payload.metric });
  }
  return store.ingestHeartbeat({ installationId: payload.installId, heartbeat: payload.heartbeat });
}

function normalizeStatusCode(value) {
  const statusCode = Number(value);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
}

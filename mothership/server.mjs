import { createServer } from "node:http";

import { httpError, readBearerToken, readJsonBody, redactErrorText, sendJson } from "./http.mjs";

const FEEDBACK_SYNC_SCHEMA = "private-beta-feedback-sync/v1";
const SIGNAL_SYNC_SCHEMA = "private-beta-signal-sync/v1";

export function createMothershipServer({
  store,
  maxBodyBytes = 256 * 1024,
  log = console,
} = {}) {
  if (!store) throw new Error("Mothership server requires a store.");

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
      if (url.pathname === "/health") {
        if (request.method !== "GET") throw httpError("Method not allowed", 405);
        const health = await store.health();
        sendJson(response, health.database === "ready" ? 200 : 503, {
          schema_version: "mothership-health/v1",
          status: health.database === "ready" ? "ready" : "unavailable",
          database: health.database,
        });
        return;
      }

      if (url.pathname !== "/v1/feedback" && url.pathname !== "/v1/signals") {
        throw httpError("Not found", 404);
      }
      if (request.method !== "POST") throw httpError("Method not allowed", 405);

      const rawToken = readBearerToken(request);
      const payload = await readJsonBody(request, { maxBodyBytes });
      const kind = url.pathname === "/v1/feedback" ? "feedback" : "signal";
      validateSyncPayload(payload, kind);
      await store.authorizeIngestion({ rawToken, installationId: payload.installId });
      const result = kind === "feedback"
        ? await store.ingestFeedback({ installationId: payload.installId, feedback: payload.feedback })
        : await store.ingestSignal({ installationId: payload.installId, signal: payload.signal });
      sendJson(response, 202, {
        accepted: true,
        duplicate: !result.inserted,
        schema_version: "mothership-ingestion-result/v1",
      });
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

function validateSyncPayload(payload, kind) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw httpError("Payload must be an object", 400);
  const expectedSchema = kind === "feedback" ? FEEDBACK_SYNC_SCHEMA : SIGNAL_SYNC_SCHEMA;
  if (payload.schema_version !== expectedSchema) throw httpError(`Expected ${expectedSchema}`, 400);
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(String(payload.installId || ""))) throw httpError("installId is invalid", 400);
  const item = payload[kind];
  if (!item || typeof item !== "object" || Array.isArray(item)) throw httpError(`${kind} is required`, 400);
  const itemSchema = kind === "feedback" ? "private-beta-feedback/v1" : "private-beta-signal/v1";
  if (item.schema_version !== itemSchema) throw httpError(`Expected ${itemSchema}`, 400);
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(String(item.id || ""))) throw httpError(`${kind}.id is invalid`, 400);
}

function normalizeStatusCode(value) {
  const statusCode = Number(value);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
}

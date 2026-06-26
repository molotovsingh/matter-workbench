import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { currentRequestContext } from "./request-context.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

export const MATTER_EVENT_SCHEMA_VERSION = "matter-event/v1";
export const MATTER_EVENTS_SCHEMA_VERSION = "matter-events/v1";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const EVENT_TYPE_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const SAFE_KEY_RE = /^[a-z][a-z0-9_]*$/;

export function createMatterEventsService({
  appDir = process.cwd(),
  eventsPath,
  now = () => new Date(),
  idFactory = () => randomUUID(),
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = eventsPath || path.join(root, ".local", "matter-events.jsonl");
  let appendQueue = Promise.resolve();

  async function appendEvent(input = {}) {
    return withAppendMutation(async () => {
      const event = normalizeMatterEvent(input, { now, idFactory });
      const existing = await findExistingEvent(event.idempotencyKey);
      if (existing) return existing;
      await mkdir(path.dirname(storePath), { recursive: true });
      await appendFile(storePath, `${JSON.stringify(event)}\n`, "utf8");
      return event;
    });
  }

  async function listEvents(filters = {}) {
    const limit = normalizeLimit(filters.limit);
    const matterName = normalizeText(filters.matterName || filters.matter);
    const eventType = normalizeText(filters.eventType || filters.type);
    const events = (await readAllEvents())
      .filter((event) => !matterName || event.matterName === matterName)
      .filter((event) => !eventType || event.eventType === eventType)
      .sort(compareNewestEventFirst)
      .slice(0, limit);
    return {
      schema_version: MATTER_EVENTS_SCHEMA_VERSION,
      events,
    };
  }

  async function findExistingEvent(idempotencyKey = "") {
    const key = normalizeText(idempotencyKey, 500);
    if (!key) return null;
    return (await readAllEvents()).find((event) => event.idempotencyKey === key) || null;
  }

  async function readAllEvents() {
    let raw = "";
    try {
      raw = await readFile(storePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw makeHttpError(`Matter event ledger could not be read: ${redactSensitiveText(error.message)}`, 500, "matter_events.read_failed");
    }
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseEventLine)
      .filter(Boolean);
  }

  function withAppendMutation(operation) {
    const run = appendQueue.then(operation);
    appendQueue = run.catch(() => {});
    return run;
  }

  return {
    appendEvent,
    listEvents,
    storePath,
  };
}

export function normalizeMatterEvent(input = {}, {
  now = () => new Date(),
  idFactory = () => randomUUID(),
} = {}) {
  const eventType = normalizeEventType(input.eventType || input.event_type);
  const idempotencyKey = normalizeText(input.idempotencyKey || input.idempotency_key, 500);
  if (!eventType) {
    throw makeHttpError("Matter event type is required.", 400, "matter_events.event_type_required");
  }
  if (!idempotencyKey) {
    throw makeHttpError("Matter event idempotency key is required.", 400, "matter_events.idempotency_key_required");
  }

  const requestContext = currentRequestContext();
  const source = normalizeSource(input.source, requestContext);
  const actor = normalizeActor(input.actor, requestContext);
  const object = normalizeObject(input.object || input.object_json || input.target);
  const occurredAt = normalizeIso(input.occurredAt || input.occurred_at) || isoNow(now);
  const eventId = normalizeText(input.eventId || input.event_id || input.id) || idFactory();

  return removeEmpty({
    schema_version: MATTER_EVENT_SCHEMA_VERSION,
    eventId,
    eventType,
    occurredAt,
    matterId: normalizeText(input.matterId || input.matter_id),
    matterName: normalizeText(input.matterName || input.matter_name),
    actor,
    source,
    summaryKey: normalizeSafeKey(input.summaryKey || input.summary_key),
    object,
    payload: normalizeJsonObject(input.payload || input.payload_json),
    idempotencyKey,
    createdAt: normalizeIso(input.createdAt || input.created_at) || occurredAt,
  });
}

export function normalizeMatterEvents(events = []) {
  return (Array.isArray(events) ? events : []).map((event) => normalizeMatterEventForRead(event)).filter(Boolean);
}

function normalizeMatterEventForRead(event = {}) {
  try {
    const normalized = normalizeMatterEvent({
      ...event,
      eventId: event.eventId || event.event_id || event.id,
      eventType: event.eventType || event.event_type,
      occurredAt: event.occurredAt || event.occurred_at,
      matterId: event.matterId || event.matter_id,
      matterName: event.matterName || event.matter_name,
      summaryKey: event.summaryKey || event.summary_key,
      idempotencyKey: event.idempotencyKey || event.idempotency_key,
      createdAt: event.createdAt || event.created_at,
      payload: event.payload || event.payload_json,
      object: event.object || event.object_json,
    }, {
      now: () => new Date(event.occurredAt || event.occurred_at || event.createdAt || event.created_at || Date.now()),
      idFactory: () => normalizeText(event.eventId || event.event_id || event.id),
    });
    return normalized;
  } catch {
    return null;
  }
}

function parseEventLine(line) {
  try {
    return normalizeMatterEventForRead(JSON.parse(line));
  } catch {
    return null;
  }
}

function normalizeSource(source = {}, requestContext = currentRequestContext()) {
  const raw = normalizeJsonObject(source);
  return removeEmpty({
    route: normalizeApiRoute(raw.route || requestContext.pathname),
    requestId: normalizeIdentifier(raw.requestId || raw.request_id || requestContext.requestId),
    traceId: normalizeIdentifier(raw.traceId || raw.trace_id || requestContext.traceId),
    method: normalizeText(raw.method || requestContext.method, 12).toUpperCase(),
  });
}

function normalizeActor(actor = {}, requestContext = currentRequestContext()) {
  const raw = normalizeJsonObject(actor);
  const user = requestContext.user || {};
  return removeEmpty({
    username: normalizeText(raw.username || user.username),
    displayName: normalizeText(raw.displayName || raw.display_name || user.displayName),
    role: normalizeText(raw.role || user.role),
    type: normalizeText(raw.type || (raw.username || user.username ? "user" : "system")),
  });
}

function normalizeObject(object = {}) {
  const raw = normalizeJsonObject(object);
  return removeEmpty({
    type: normalizeSafeKey(raw.type),
    id: normalizeText(raw.id, 240),
    label: normalizeText(raw.label, 240),
  });
}

function normalizeJsonObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeEventType(value) {
  const text = normalizeText(value, 160).toLowerCase();
  if (text === "source_file.deleted" || text === "source_document.deleted") return "";
  return EVENT_TYPE_RE.test(text) ? text : "";
}

function normalizeSafeKey(value) {
  const text = normalizeText(value, 120).toLowerCase();
  return text && SAFE_KEY_RE.test(text) ? text : "";
}

function normalizeApiRoute(value) {
  const text = normalizeText(value, 240);
  return /^\/api\/[a-z0-9/_:-]+$/i.test(text) ? text : "";
}

function normalizeIdentifier(value) {
  const text = normalizeText(value, 180);
  return /^[a-zA-Z0-9_-]{3,180}$/.test(text) ? text : "";
}

function normalizeIso(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString();
}

function isoNow(now) {
  const value = now();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return normalizeIso(value) || new Date().toISOString();
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(number), MAX_LIMIT);
}

function normalizeText(value, maxLength = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function compareNewestEventFirst(a, b) {
  const left = Date.parse(a.occurredAt || "") || 0;
  const right = Date.parse(b.occurredAt || "") || 0;
  if (right !== left) return right - left;
  return String(b.eventId || "").localeCompare(String(a.eventId || ""));
}

function removeEmpty(value = {}) {
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry === "string" && !entry) continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const nested = removeEmpty(entry);
      if (Object.keys(nested).length === 0) continue;
      output[key] = nested;
      continue;
    }
    output[key] = entry;
  }
  return output;
}

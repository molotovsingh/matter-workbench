import { randomUUID } from "node:crypto";

import { withDocumentIntakeExtractionTenant } from "./tenant-transaction.mjs";

const FORBIDDEN_DETAIL_KEY = /(?:file_?name|original_?name|relative_?path|document_?text|markdown|content|api_?key|token|secret|password)/i;

export class PostgresAuditStore {
  constructor({ pool, clock = () => new Date(), idFactory = () => randomUUID() } = {}) {
    if (!pool?.connect) throw new Error("PostgreSQL audit store requires a pool");
    this.pool = pool;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async append({ tenantId, eventType, resourceType, resourceId, actorType = "service", actorId = "document-intake-extraction", idempotencyKey, details = {}, occurredAt = this.clock() } = {}) {
    const normalizedDetails = sanitizeDetails(details);
    const normalizedEventType = dotted(eventType, "eventType", 120);
    const normalizedResourceType = dotted(resourceType, "resourceType", 80);
    const normalizedResourceId = cleanRequired(resourceId, "resourceId", 240);
    const normalizedIdempotencyKey = cleanRequired(idempotencyKey, "idempotencyKey", 300);
    const timestamp = iso(occurredAt, "occurredAt");
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "insert into document_intake_extraction.audit_events",
        "  (audit_event_id, tenant_id, event_type, resource_type, resource_id, actor_type, actor_id, idempotency_key, details_json, occurred_at)",
        "values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)",
        "on conflict (tenant_id, event_type, idempotency_key) do nothing",
        "returning *",
      ].join("\n"), [
        this.idFactory(), tenantId, normalizedEventType, normalizedResourceType,
        normalizedResourceId, normalizeActorType(actorType), cleanRequired(actorId, "actorId", 200),
        normalizedIdempotencyKey, JSON.stringify(normalizedDetails), timestamp,
      ]);
      if (result.rows[0]) return mapEvent(result.rows[0], false);
      const existing = await client.query([
        "select * from document_intake_extraction.audit_events",
        "where tenant_id = $1 and event_type = $2 and idempotency_key = $3",
      ].join("\n"), [tenantId, normalizedEventType, normalizedIdempotencyKey]);
      if (!existing.rows[0]) throw auditError("audit append conflicted during replay", "audit.append_conflict");
      const mapped = mapEvent(existing.rows[0], true);
      if (mapped.resourceType !== normalizedResourceType || mapped.resourceId !== normalizedResourceId || canonicalJson(mapped.details) !== canonicalJson(normalizedDetails)) {
        throw auditError("audit idempotency key was reused for different evidence", "audit.idempotency_conflict");
      }
      return mapped;
    });
  }

  async listForResource({ tenantId, resourceType, resourceId, limit = 100 } = {}) {
    const maximum = boundedInteger(limit, "limit", 1, 500);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "select * from document_intake_extraction.audit_events",
        "where tenant_id = $1 and resource_type = $2 and resource_id = $3",
        "order by occurred_at, audit_event_id limit $4::int",
      ].join("\n"), [tenantId, dotted(resourceType, "resourceType", 80), cleanRequired(resourceId, "resourceId", 240), maximum]);
      return result.rows.map((row) => mapEvent(row, false));
    });
  }
}

function sanitizeDetails(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("audit details must be an object");
  inspectKeys(input);
  let serialized;
  try { serialized = JSON.stringify(input); } catch { throw new Error("audit details must be JSON serializable"); }
  if (Buffer.byteLength(serialized) > 16_384) throw new Error("audit details exceed 16384 bytes");
  return JSON.parse(serialized);
}

function inspectKeys(value) {
  if (Array.isArray(value)) {
    for (const item of value) inspectKeys(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_DETAIL_KEY.test(key)) throw auditError(`audit detail key is forbidden: ${key}`, "audit.detail_forbidden");
    inspectKeys(child);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function mapEvent(row, idempotent) {
  return {
    auditEventId: String(row.audit_event_id), tenantId: row.tenant_id, eventType: row.event_type,
    resourceType: row.resource_type, resourceId: row.resource_id, actorType: row.actor_type, actorId: row.actor_id,
    idempotencyKey: row.idempotency_key, details: row.details_json || {}, occurredAt: new Date(row.occurred_at).toISOString(), idempotent,
  };
}

function normalizeActorType(value) { const type = String(value || "service"); if (!["service", "worker", "operator", "system"].includes(type)) throw new Error("actorType is invalid"); return type; }
function dotted(value, field, maximum) { const normalized = cleanRequired(value, field, maximum); if (!/^[a-z][a-z0-9_.]+$/.test(normalized)) throw new Error(`${field} must use dotted lowercase identifiers`); return normalized; }
function cleanRequired(value, field, maximum) { const normalized = String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maximum); if (!normalized) throw new Error(`${field} is required`); return normalized; }
function iso(value, field) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be a timestamp`); return date.toISOString(); }
function boundedInteger(value, field, minimum, maximum) { const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`); return number; }
function auditError(message, code) { const error = new Error(message); error.code = code; return error; }

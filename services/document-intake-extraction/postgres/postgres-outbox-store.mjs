import { randomUUID } from "node:crypto";

import { withDocumentIntakeExtractionTenant } from "./tenant-transaction.mjs";

export class PostgresOutboxStore {
  constructor({ pool, clock = () => new Date(), idFactory = () => randomUUID() } = {}) {
    if (!pool?.connect) throw new Error("PostgreSQL outbox store requires a pool");
    this.pool = pool;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async claim({ tenantId, workerId, maximumEvents = 20, leaseMs = 60_000 } = {}) {
    const limit = boundedInteger(maximumEvents, "maximumEvents", 1, 100);
    const milliseconds = boundedInteger(leaseMs, "leaseMs", 1_000, 15 * 60 * 1000);
    const owner = clean(workerId, 200);
    if (!owner) throw new Error("outbox workerId is required");
    const leaseToken = this.idFactory();
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      await client.query([
        "update document_intake_extraction.outbox_events",
        "set delivery_status = 'failed', locked_by = null, lease_token = null, lease_expires_at = null,",
        "    last_error_code = 'outbox.lease_expired', last_error_message = 'Delivery lease expired before checkpoint.',",
        "    next_attempt_at = now(), updated_at = now()",
        "where tenant_id = $1 and delivery_status = 'delivering' and lease_expires_at < now()",
      ].join("\n"), [tenantId]);
      const result = await client.query([
        "with candidate as (",
        "  select event_id",
        "  from document_intake_extraction.outbox_events",
        "  where tenant_id = $1",
        "    and delivery_status in ('pending', 'failed')",
        "    and next_attempt_at <= now()",
        "  order by created_at, event_id",
        "  limit $2::int",
        "  for update skip locked",
        ")",
        "update document_intake_extraction.outbox_events e",
        "set delivery_status = 'delivering',",
        "    attempt_count = e.attempt_count + 1,",
        "    locked_by = $3,",
        "    lease_token = $4::uuid,",
        "    lease_expires_at = now() + ($5::int || ' milliseconds')::interval,",
        "    updated_at = now()",
        "from candidate c",
        "where e.tenant_id = $1 and e.event_id = c.event_id",
        "returning e.event_id::text, e.tenant_id, e.matter_id, e.intake_id::text, e.result_id::text, e.event_type, e.schema_version, e.payload_json, e.attempt_count, e.lease_token::text, e.lease_expires_at, e.created_at",
      ].join("\n"), [tenantId, limit, owner, leaseToken, milliseconds]);
      return result.rows.map(normalizeEvent);
    });
  }

  async markDelivered({ tenantId, eventId, leaseToken } = {}) {
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "update document_intake_extraction.outbox_events",
        "set delivery_status = 'delivered', delivered_at = now(), locked_by = null, lease_token = null, lease_expires_at = null,",
        "    last_error_code = null, last_error_message = null, updated_at = now()",
        "where tenant_id = $1 and event_id = $2::uuid and delivery_status = 'delivering' and lease_token = $3::uuid",
        "returning event_id::text",
      ].join("\n"), [tenantId, eventId, leaseToken]);
      if (!result.rows[0]) throw leaseLost();
      return { eventId: result.rows[0].event_id, status: "delivered" };
    });
  }

  async markFailed({ tenantId, eventId, leaseToken, errorCode, errorMessage, retryAfterMs, terminal = false } = {}) {
    const delayMs = boundedInteger(retryAfterMs, "retryAfterMs", 1_000, 24 * 60 * 60 * 1000);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "update document_intake_extraction.outbox_events",
        "set delivery_status = case when $7::boolean then 'dead_letter' else 'failed' end,",
        "    next_attempt_at = case when $7::boolean then next_attempt_at else now() + ($4::int || ' milliseconds')::interval end,",
        "    locked_by = null, lease_token = null, lease_expires_at = null,",
        "    last_error_code = $5, last_error_message = $6, updated_at = now()",
        "where tenant_id = $1 and event_id = $2::uuid and delivery_status = 'delivering' and lease_token = $3::uuid",
        "returning event_id::text, next_attempt_at",
      ].join("\n"), [tenantId, eventId, leaseToken, delayMs, clean(errorCode, 120) || "outbox.delivery_failed", clean(errorMessage, 500) || "Event delivery failed", Boolean(terminal)]);
      if (!result.rows[0]) throw leaseLost();
      return { eventId: result.rows[0].event_id, status: terminal ? "dead_letter" : "failed", nextAttemptAt: terminal ? "" : iso(result.rows[0].next_attempt_at) };
    });
  }
}

function normalizeEvent(row) {
  return {
    eventId: String(row.event_id),
    tenantId: String(row.tenant_id),
    matterId: String(row.matter_id),
    intakeId: String(row.intake_id),
    resultId: String(row.result_id),
    type: String(row.event_type),
    schemaVersion: String(row.schema_version),
    payload: parseObject(row.payload_json),
    attemptCount: Number(row.attempt_count),
    leaseToken: String(row.lease_token),
    leaseExpiresAt: iso(row.lease_expires_at),
    createdAt: iso(row.created_at),
  };
}

function leaseLost() {
  const error = new Error("outbox lease ownership was lost before checkpoint");
  error.code = "outbox.lease_lost";
  return error;
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

function clean(value, maximum) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maximum);
}

function iso(value) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

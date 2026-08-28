import { createHash, randomUUID } from "node:crypto";

import { withDocumentIntakeExtractionTenant } from "./tenant-transaction.mjs";

export class PostgresWorkerCapacityStore {
  constructor({ pool, clock = () => new Date(), idFactory = () => randomUUID() } = {}) {
    if (!pool?.connect) throw new Error("PostgreSQL worker capacity store requires a pool");
    this.pool = pool;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async request({ tenantId, poolId, workloadClass = "default", desiredWorkers, minimumWorkers, maximumWorkers, action, reason = {}, notBefore, expiresAt } = {}) {
    const normalized = normalizeRequest({ poolId, workloadClass, desiredWorkers, minimumWorkers, maximumWorkers, action, reason, notBefore, expiresAt });
    const fingerprint = fingerprintRequest(normalized);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "insert into document_intake_extraction.worker_capacity_requests",
        "  (capacity_request_id, tenant_id, pool_id, workload_class, request_fingerprint, desired_workers, minimum_workers, maximum_workers,",
        "   generation, status, reason_json, not_before, expires_at)",
        "values ($1::uuid, $2, $3, $4, $5, $6::int, $7::int, $8::int, 1, 'scheduled', $9::jsonb, $10::timestamptz, $11::timestamptz)",
        "on conflict (tenant_id, pool_id) do update set",
        "  workload_class = excluded.workload_class, request_fingerprint = excluded.request_fingerprint,",
        "  desired_workers = excluded.desired_workers, minimum_workers = excluded.minimum_workers, maximum_workers = excluded.maximum_workers,",
        "  generation = document_intake_extraction.worker_capacity_requests.generation + 1, status = 'scheduled',",
        "  reason_json = excluded.reason_json, not_before = excluded.not_before, expires_at = excluded.expires_at,",
        "  attempt_count = 0, observed_workers = null, locked_by = null, lease_token = null, lease_expires_at = null,",
        "  last_error_code = null, last_error_message = null, applied_at = null",
        "where document_intake_extraction.worker_capacity_requests.request_fingerprint <> excluded.request_fingerprint",
        "returning *",
      ].join("\n"), [
        this.idFactory(), tenantId, normalized.poolId, normalized.workloadClass, fingerprint,
        normalized.desiredWorkers, normalized.minimumWorkers, normalized.maximumWorkers,
        JSON.stringify({ action: normalized.action, ...normalized.reason }), normalized.notBefore, normalized.expiresAt,
      ]);
      if (result.rows[0]) return mapRequest(result.rows[0], false);
      const existing = await client.query([
        "select * from document_intake_extraction.worker_capacity_requests",
        "where tenant_id = $1 and pool_id = $2 and request_fingerprint = $3",
      ].join("\n"), [tenantId, normalized.poolId, fingerprint]);
      if (!existing.rows[0]) throw capacityError("capacity request conflicted during idempotent replay", "capacity.request_conflict");
      return mapRequest(existing.rows[0], true);
    });
  }

  async claimDue({ tenantId, workerId, leaseMs = 60_000 } = {}) {
    const owner = clean(workerId, 200);
    if (!owner) throw new Error("capacity request claim requires workerId");
    const milliseconds = boundedInteger(leaseMs, "leaseMs", 1_000, 15 * 60 * 1000);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "with candidate as (",
        "  select capacity_request_id from document_intake_extraction.worker_capacity_requests",
        "  where tenant_id = $1 and expires_at > now() and not_before <= now()",
        "    and (status in ('scheduled', 'failed') or (status = 'applying' and lease_expires_at < now()))",
        "  order by generation desc, created_at",
        "  limit 1 for update skip locked",
        ")",
        "update document_intake_extraction.worker_capacity_requests request set",
        "  status = 'applying', attempt_count = request.attempt_count + 1, locked_by = $2,",
        "  lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => $3::double precision / 1000)",
        "from candidate where request.tenant_id = $1 and request.capacity_request_id = candidate.capacity_request_id",
        "returning request.*",
      ].join("\n"), [tenantId, owner, milliseconds]);
      return result.rows[0] ? mapRequest(result.rows[0], false) : null;
    });
  }

  async markApplied({ tenantId, capacityRequestId, generation, leaseToken, observedWorkers } = {}) {
    return this.checkpoint({ tenantId, capacityRequestId, generation, leaseToken, status: "applied", observedWorkers });
  }

  async markFailed({ tenantId, capacityRequestId, generation, leaseToken, errorCode, errorMessage, retryAfterMs = 5_000 } = {}) {
    const retry = boundedInteger(retryAfterMs, "retryAfterMs", 1_000, 60 * 60 * 1000);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "update document_intake_extraction.worker_capacity_requests set",
        "  status = 'failed', not_before = least(expires_at - interval '1 millisecond', now() + make_interval(secs => $5::double precision / 1000)),",
        "  last_error_code = $6, last_error_message = $7, locked_by = null, lease_token = null, lease_expires_at = null",
        "where tenant_id = $1 and capacity_request_id = $2::uuid and generation = $3::bigint and status = 'applying' and lease_token = $4::uuid",
        "returning *",
      ].join("\n"), [tenantId, capacityRequestId, generation, leaseToken, retry, safeCode(errorCode), clean(errorMessage, 500)]);
      if (!result.rows[0]) throw leaseLost();
      return mapRequest(result.rows[0], false);
    });
  }

  async read({ tenantId, poolId } = {}) {
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query("select * from document_intake_extraction.worker_capacity_requests where tenant_id = $1 and pool_id = $2", [tenantId, clean(poolId, 160)]);
      return result.rows[0] ? mapRequest(result.rows[0], false) : null;
    });
  }

  async checkpoint({ tenantId, capacityRequestId, generation, leaseToken, status, observedWorkers }) {
    const workers = boundedInteger(observedWorkers, "observedWorkers", 0, 100_000);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "update document_intake_extraction.worker_capacity_requests set",
        "  status = $5, observed_workers = $6::int, applied_at = now(),",
        "  locked_by = null, lease_token = null, lease_expires_at = null, last_error_code = null, last_error_message = null",
        "where tenant_id = $1 and capacity_request_id = $2::uuid and generation = $3::bigint and status = 'applying' and lease_token = $4::uuid",
        "returning *",
      ].join("\n"), [tenantId, capacityRequestId, generation, leaseToken, status, workers]);
      if (!result.rows[0]) throw leaseLost();
      return mapRequest(result.rows[0], false);
    });
  }
}

function normalizeRequest({ poolId, workloadClass, desiredWorkers, minimumWorkers, maximumWorkers, action, reason, notBefore, expiresAt }) {
  const minimum = boundedInteger(minimumWorkers, "minimumWorkers", 0, 100_000);
  const maximum = boundedInteger(maximumWorkers, "maximumWorkers", 1, 100_000);
  const desired = boundedInteger(desiredWorkers, "desiredWorkers", minimum, maximum);
  const start = iso(notBefore, "notBefore");
  const expiration = iso(expiresAt, "expiresAt");
  if (new Date(expiration) <= new Date(start)) throw new Error("expiresAt must follow notBefore");
  return {
    poolId: requiredClean(poolId, "poolId", 160),
    workloadClass: requiredClean(workloadClass, "workloadClass", 120),
    desiredWorkers: desired,
    minimumWorkers: minimum,
    maximumWorkers: maximum,
    action: requiredClean(action, "action", 80),
    reason: reason && typeof reason === "object" && !Array.isArray(reason) ? structuredClone(reason) : {},
    notBefore: start,
    expiresAt: expiration,
  };
}

function fingerprintRequest(request) {
  return createHash("sha256").update(JSON.stringify({
    poolId: request.poolId,
    workloadClass: request.workloadClass,
    desiredWorkers: request.desiredWorkers,
    minimumWorkers: request.minimumWorkers,
    maximumWorkers: request.maximumWorkers,
    action: request.action,
  })).digest("hex");
}

function mapRequest(row, idempotent) {
  return {
    capacityRequestId: String(row.capacity_request_id), tenantId: row.tenant_id, poolId: row.pool_id,
    workloadClass: row.workload_class, requestFingerprint: row.request_fingerprint,
    desiredWorkers: Number(row.desired_workers), minimumWorkers: Number(row.minimum_workers), maximumWorkers: Number(row.maximum_workers),
    generation: Number(row.generation), status: row.status, reason: row.reason_json || {}, notBefore: isoValue(row.not_before),
    expiresAt: isoValue(row.expires_at), attemptCount: Number(row.attempt_count), observedWorkers: row.observed_workers === null ? null : Number(row.observed_workers),
    leaseToken: row.lease_token ? String(row.lease_token) : "", leaseExpiresAt: isoValue(row.lease_expires_at),
    lastErrorCode: row.last_error_code || "", appliedAt: isoValue(row.applied_at), idempotent,
  };
}

function safeCode(value) {
  const code = String(value || "capacity.provision_failed");
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(code) ? code : "capacity.provision_failed";
}
function requiredClean(value, field, maximum) { const normalized = clean(value, maximum); if (!normalized) throw new Error(`${field} is required`); return normalized; }
function clean(value, maximum) { return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maximum); }
function iso(value, field) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be a timestamp`); return date.toISOString(); }
function isoValue(value) { return value ? new Date(value).toISOString() : ""; }
function boundedInteger(value, field, minimum, maximum) { const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`); return number; }
function leaseLost() { return capacityError("capacity request lease or generation was lost", "capacity.lease_lost"); }
function capacityError(message, code) { const error = new Error(message); error.code = code; return error; }

import { randomUUID } from "node:crypto";

import { withDocumentIntakeExtractionTenant } from "./tenant-transaction.mjs";

export class PostgresWorkRepository {
  constructor({ pool, clock = () => new Date(), idFactory = () => randomUUID() } = {}) {
    if (!pool?.connect) throw new Error("PostgreSQL work repository requires a pool");
    this.pool = pool;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async claim({ tenantId, workerId, leaseMs = 60_000 } = {}) {
    const owner = clean(workerId, 200);
    if (!owner) throw new Error("work claim requires workerId");
    const milliseconds = boundedInteger(leaseMs, "leaseMs", 1_000, 15 * 60 * 1000);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        "select * from document_intake_extraction.claim_page_work($1, $2::int)",
        [owner, milliseconds],
      );
      const row = result.rows[0];
      if (!row) return null;
      const attemptId = this.idFactory();
      const startedAt = this.clock().toISOString();
      await client.query([
        "insert into document_intake_extraction.provider_attempts",
        "  (attempt_id, tenant_id, computation_id, fingerprint, provider, model, adapter_version, attempt_number, status, cost_measurement_status, started_at)",
        "values ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::int, 'running', 'pending', $9::timestamptz)",
      ].join("\n"), [attemptId, tenantId, row.computation_id, row.fingerprint, row.provider, row.model, row.adapter_version, row.attempt_count, startedAt]);
      const activated = await client.query([
        "update document_intake_extraction.page_computations",
        "set active_attempt_id = $4::uuid",
        "where tenant_id = $1 and computation_id = $2::uuid and status = 'running' and lease_token = $3::uuid and active_attempt_id is null",
        "returning computation_id",
      ].join("\n"), [tenantId, row.computation_id, row.lease_token, attemptId]);
      if (!activated.rows[0]) throw leaseLost();
      const blob = await client.query("select object_key, bytes::text from document_intake_extraction.source_blobs where sha256 = $1", [row.source_sha256]);
      if (!blob.rows[0]) throw repositoryError("claimed work source blob was missing", "v4_postgres.source_blob_missing");
      return {
        workUnitId: String(row.computation_id),
        fingerprint: String(row.fingerprint),
        tenantId,
        sourceSha256: String(row.source_sha256),
        blobReference: { sha256: String(row.source_sha256), objectKey: blob.rows[0].object_key },
        sourceBytes: Number(blob.rows[0].bytes),
        pageNumber: Number(row.page_number),
        capability: { provider: row.provider, model: row.model, adapterVersion: row.adapter_version },
        routingPolicy: row.routing_policy,
        validatorVersion: row.validator_version,
        attemptCount: Number(row.attempt_count),
        maximumAttempts: Number(row.maximum_attempts),
        leaseToken: String(row.lease_token),
        leaseExpiresAt: iso(row.lease_expires_at),
        attemptId,
        startedAt,
      };
    });
  }

  async claimDocumentLocalBatch({ tenantId, workerId, maximumPages = 8, leaseMs = 60_000 } = {}) {
    const owner = clean(workerId, 200);
    if (!owner) throw new Error("work batch claim requires workerId");
    const pages = boundedInteger(maximumPages, "maximumPages", 1, 32);
    const milliseconds = boundedInteger(leaseMs, "leaseMs", 1_000, 15 * 60 * 1000);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        "select * from document_intake_extraction.claim_document_local_page_work($1, $2::int, $3::int)",
        [owner, pages, milliseconds],
      );
      const rows = result.rows.sort((left, right) => Number(left.page_number) - Number(right.page_number));
      if (!rows.length) return [];
      const sourceSha256 = String(rows[0].source_sha256);
      if (rows.some((row, index) => String(row.source_sha256) !== sourceSha256 || Number(row.page_number) !== Number(rows[0].page_number) + index)) {
        throw repositoryError("database returned a non-contiguous document-local claim", "v4_postgres.batch_claim_invalid");
      }
      const blob = await client.query("select object_key, bytes::text from document_intake_extraction.source_blobs where sha256 = $1", [sourceSha256]);
      if (!blob.rows[0]) throw repositoryError("claimed work source blob was missing", "v4_postgres.source_blob_missing");
      const claims = [];
      for (const row of rows) {
        const attemptId = this.idFactory();
        const startedAt = this.clock().toISOString();
        await client.query([
          "insert into document_intake_extraction.provider_attempts",
          "  (attempt_id, tenant_id, computation_id, fingerprint, provider, model, adapter_version, attempt_number, status, cost_measurement_status, started_at)",
          "values ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::int, 'running', 'pending', $9::timestamptz)",
        ].join("\n"), [attemptId, tenantId, row.computation_id, row.fingerprint, row.provider, row.model, row.adapter_version, row.attempt_count, startedAt]);
        const activated = await client.query([
          "update document_intake_extraction.page_computations set active_attempt_id = $4::uuid",
          "where tenant_id = $1 and computation_id = $2::uuid and status = 'running' and lease_token = $3::uuid and active_attempt_id is null",
          "returning computation_id",
        ].join("\n"), [tenantId, row.computation_id, row.lease_token, attemptId]);
        if (!activated.rows[0]) throw leaseLost();
        claims.push({
          workUnitId: String(row.computation_id),
          fingerprint: String(row.fingerprint),
          tenantId,
          sourceSha256,
          blobReference: { sha256: sourceSha256, objectKey: blob.rows[0].object_key },
          sourceBytes: Number(blob.rows[0].bytes),
          pageNumber: Number(row.page_number),
          capability: { provider: row.provider, model: row.model, adapterVersion: row.adapter_version },
          routingPolicy: row.routing_policy,
          validatorVersion: row.validator_version,
          attemptCount: Number(row.attempt_count),
          maximumAttempts: Number(row.maximum_attempts),
          leaseToken: String(row.lease_token),
          leaseExpiresAt: iso(row.lease_expires_at),
          attemptId,
          startedAt,
        });
      }
      return claims;
    });
  }

  async renew({ tenantId, workUnitId, leaseToken, leaseMs = 60_000 } = {}) {
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        "select document_intake_extraction.renew_page_lease($1::uuid, $2::uuid, $3::int) as renewed",
        [workUnitId, leaseToken, boundedInteger(leaseMs, "leaseMs", 1_000, 15 * 60 * 1000)],
      );
      if (!result.rows[0]?.renewed) throw leaseLost();
      return { workUnitId, renewed: true };
    });
  }

  async finishSuccess({ tenantId, claim, providerResult, validation } = {}) {
    if (!claim?.workUnitId || !claim?.attemptId) throw new Error("work claim is required");
    if (!["accepted", "review_required"].includes(validation?.outcome)) throw new Error("validation outcome is invalid");
    const finishedAt = this.clock().toISOString();
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const locked = await lockClaim(client, tenantId, claim);
      const usage = normalizeUsage(providerResult?.usage);
      const billedCostUsd = nonNegativeNumber(providerResult?.billedCostUsd, "providerResult.billedCostUsd", 0);
      await client.query([
        "update document_intake_extraction.provider_attempts",
        "set status = $4, provider_request_id = nullif($5, ''), input_units = $6, output_units = $7, billed_cost_usd = $8,",
        "    cost_measurement_status = 'measured', retryable = false, finished_at = $9::timestamptz,",
        "    latency_ms = greatest(0, floor(extract(epoch from ($9::timestamptz - started_at)) * 1000))::bigint",
        "where tenant_id = $1 and computation_id = $2::uuid and attempt_id = $3::uuid and status = 'running'",
      ].join("\n"), [tenantId, claim.workUnitId, claim.attemptId, validation.outcome, clean(providerResult?.requestId, 240), usage.inputUnits, usage.outputUnits, billedCostUsd, finishedAt]);
      await insertCostEvent(client, { idFactory: this.idFactory, tenantId, claim, status: validation.outcome, usage, billedCostUsd, measurementStatus: "measured", occurredAt: finishedAt });
      const output = {
        text: String(providerResult?.text || ""),
        finishReason: String(providerResult?.finishReason || "complete"),
        reviewReasons: Array.isArray(validation.reasons) ? validation.reasons : [],
        validatorVersion: validation.validatorVersion,
        attemptId: claim.attemptId,
        requestId: clean(providerResult?.requestId, 240),
      };
      await client.query([
        "update document_intake_extraction.page_computations",
        "set status = $4, output_json = $5::jsonb, active_attempt_id = null, lease_token = null, locked_by = null, locked_at = null, lease_expires_at = null",
        "where tenant_id = $1 and computation_id = $2::uuid and lease_token = $3::uuid and active_attempt_id = $6::uuid",
      ].join("\n"), [tenantId, claim.workUnitId, claim.leaseToken, validation.outcome, JSON.stringify(output), claim.attemptId]);
      await client.query([
        "update document_intake_extraction.computation_demands set fulfilled_at = coalesce(fulfilled_at, $3::timestamptz)",
        "where tenant_id = $1 and computation_id = $2::uuid",
      ].join("\n"), [tenantId, claim.workUnitId, finishedAt]);
      return { ...locked, status: validation.outcome, output };
    });
  }

  async finishFailure({ tenantId, claim, error, baseRetryMs = 1_000, maximumRetryMs = 60_000 } = {}) {
    if (!claim?.workUnitId || !claim?.attemptId) throw new Error("work claim is required");
    const finishedAt = this.clock().toISOString();
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const locked = await lockClaim(client, tenantId, claim);
      const retryable = error?.retryable !== false;
      const terminal = !retryable || locked.attemptCount >= locked.maximumAttempts;
      const billingKnown = error?.billingKnown === true || Number.isFinite(Number(error?.billedCostUsd));
      const usage = normalizeUsage(error?.usage, { nullable: true });
      const billedCostUsd = billingKnown ? nonNegativeNumber(error?.billedCostUsd, "error.billedCostUsd", 0) : null;
      const measurementStatus = billingKnown ? "measured" : "unknown_requires_reconciliation";
      const errorCode = safeCode(error?.code);
      const errorMessage = clean(error?.message || error || "Provider call failed", 500);
      await client.query([
        "update document_intake_extraction.provider_attempts",
        "set status = 'failed', input_units = $4, output_units = $5, billed_cost_usd = $6, cost_measurement_status = $7,",
        "    error_code = $8, error_message = $9, retryable = $10::boolean, finished_at = $11::timestamptz,",
        "    latency_ms = greatest(0, floor(extract(epoch from ($11::timestamptz - started_at)) * 1000))::bigint",
        "where tenant_id = $1 and computation_id = $2::uuid and attempt_id = $3::uuid and status = 'running'",
      ].join("\n"), [tenantId, claim.workUnitId, claim.attemptId, usage.inputUnits, usage.outputUnits, billedCostUsd, measurementStatus, errorCode, errorMessage, retryable, finishedAt]);
      await insertCostEvent(client, { idFactory: this.idFactory, tenantId, claim, status: "failed", usage, billedCostUsd, measurementStatus, occurredAt: finishedAt });
      const output = terminal ? {
        text: "",
        finishReason: "failed",
        reviewReasons: [retryable ? "provider_attempts_exhausted" : "provider_failure_not_retryable", errorCode],
        validatorVersion: locked.validatorVersion,
        attemptId: claim.attemptId,
        requestId: "",
      } : null;
      const retryMs = Math.min(maximumRetryMs, baseRetryMs * (2 ** Math.max(0, locked.attemptCount - 1)));
      await client.query([
        "update document_intake_extraction.page_computations",
        "set status = case when $4::boolean then 'review_required' else 'queued' end,",
        "    output_json = case when $4::boolean then $5::jsonb else output_json end,",
        "    run_after = case when $4::boolean then run_after else $6::timestamptz end,",
        "    active_attempt_id = null, lease_token = null, locked_by = null, locked_at = null, lease_expires_at = null",
        "where tenant_id = $1 and computation_id = $2::uuid and lease_token = $3::uuid and active_attempt_id = $7::uuid",
      ].join("\n"), [
        tenantId, claim.workUnitId, claim.leaseToken, terminal, JSON.stringify(output || {}),
        new Date(new Date(finishedAt).getTime() + retryMs).toISOString(), claim.attemptId,
      ]);
      if (terminal) {
        await client.query([
          "update document_intake_extraction.computation_demands set fulfilled_at = coalesce(fulfilled_at, $3::timestamptz)",
          "where tenant_id = $1 and computation_id = $2::uuid",
        ].join("\n"), [tenantId, claim.workUnitId, finishedAt]);
      }
      return { ...locked, status: terminal ? "review_required" : "queued", output, retryAfterMs: terminal ? null : retryMs };
    });
  }
}

async function lockClaim(client, tenantId, claim) {
  const result = await client.query([
    "select computation_id::text, fingerprint, provider, model, adapter_version, validator_version, attempt_count, maximum_attempts",
    "from document_intake_extraction.page_computations",
    "where tenant_id = $1 and computation_id = $2::uuid and status = 'running' and lease_token = $3::uuid and active_attempt_id = $4::uuid",
    "for update",
  ].join("\n"), [tenantId, claim.workUnitId, claim.leaseToken, claim.attemptId]);
  if (!result.rows[0]) throw leaseLost();
  const demands = await client.query([
    "select intake_id::text from document_intake_extraction.computation_demands",
    "where tenant_id = $1 and computation_id = $2::uuid and fulfilled_at is null",
    "order by created_at, intake_id",
  ].join("\n"), [tenantId, claim.workUnitId]);
  return {
    workUnitId: result.rows[0].computation_id,
    intakeIds: demands.rows.map((row) => row.intake_id),
    fingerprint: result.rows[0].fingerprint,
    capability: { provider: result.rows[0].provider, model: result.rows[0].model, adapterVersion: result.rows[0].adapter_version },
    validatorVersion: result.rows[0].validator_version,
    attemptCount: Number(result.rows[0].attempt_count),
    maximumAttempts: Number(result.rows[0].maximum_attempts),
  };
}

async function insertCostEvent(client, { idFactory, tenantId, claim, status, usage, billedCostUsd, measurementStatus, occurredAt }) {
  await client.query([
    "insert into document_intake_extraction.cost_events",
    "  (cost_event_id, tenant_id, attempt_id, computation_id, fingerprint, provider, model, adapter_version, attempt_status, input_units, output_units, billed_cost_usd, measurement_status, occurred_at)",
    "values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz)",
    "on conflict (tenant_id, attempt_id) do nothing",
  ].join("\n"), [
    idFactory(), tenantId, claim.attemptId, claim.workUnitId, claim.fingerprint,
    claim.capability.provider, claim.capability.model, claim.capability.adapterVersion,
    status, usage.inputUnits, usage.outputUnits, billedCostUsd, measurementStatus, occurredAt,
  ]);
}

function normalizeUsage(value = {}, { nullable = false } = {}) {
  return {
    inputUnits: nonNegativeNumber(value?.inputUnits, "usage.inputUnits", nullable ? null : 0),
    outputUnits: nonNegativeNumber(value?.outputUnits, "usage.outputUnits", nullable ? null : 0),
  };
}

function nonNegativeNumber(value, field, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be non-negative`);
  return number;
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

function safeCode(value) {
  const normalized = String(value || "provider.failed");
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(normalized) ? normalized : "provider.failed";
}

function clean(value, maximum) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maximum);
}

function iso(value) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function leaseLost() {
  return repositoryError("work lease ownership was lost before checkpoint", "worker.lease_lost");
}

function repositoryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

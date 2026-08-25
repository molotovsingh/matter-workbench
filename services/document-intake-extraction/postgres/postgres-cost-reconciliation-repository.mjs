import { withDocumentIntakeExtractionTenant } from "./tenant-transaction.mjs";

const SECRET_LIKE = /(?:api[_-]?key\s*[=:]|secret\s*[=:]|token\s*[=:]|bearer\s+|-----begin)/i;

export class PostgresCostReconciliationRepository {
  constructor({ pool, auditStore = null } = {}) {
    if (!pool?.connect) throw new Error("PostgreSQL cost reconciliation repository requires a pool");
    if (auditStore && !auditStore.append) throw new Error("auditStore.append is required");
    this.pool = pool;
    this.auditStore = auditStore;
  }

  async listPending({ tenantId, limit = 100 } = {}) {
    const maximum = boundedInteger(limit, "limit", 1, 500);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "select attempt_id::text, computation_id::text, fingerprint, provider, model, adapter_version, status, started_at, finished_at",
        "from document_intake_extraction.provider_attempts",
        "where tenant_id = $1 and cost_measurement_status = 'unknown_requires_reconciliation'",
        "order by finished_at nulls last, started_at, attempt_id limit $2::int",
      ].join("\n"), [tenantId, maximum]);
      return result.rows.map((row) => ({
        attemptId: row.attempt_id,
        computationId: row.computation_id,
        fingerprint: row.fingerprint,
        provider: row.provider,
        model: row.model,
        adapterVersion: row.adapter_version,
        status: row.status,
        startedAt: new Date(row.started_at).toISOString(),
        finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : "",
      }));
    });
  }

  async reconcile({ tenantId, attemptId, inputUnits = null, outputUnits = null, billedCostUsd, reconciliationReference, actorId = "cost-reconciliation-service" } = {}) {
    const reference = safeReference(reconciliationReference);
    const input = nullableNonNegative(inputUnits, "inputUnits");
    const output = nullableNonNegative(outputUnits, "outputUnits");
    const billed = nonNegativeNumber(billedCostUsd, "billedCostUsd");
    const reconciled = await withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "select document_intake_extraction.reconcile_attempt_cost($1::uuid, $2::numeric, $3::numeric, $4::numeric, $5) as reconciled",
      ].join("\n"), [attemptId, input, output, billed, reference]);
      return result.rows[0]?.reconciled === true;
    });
    if (!reconciled) throw reconciliationError("cost evidence was not pending or did not match its prior reconciliation", "cost.reconciliation_conflict");
    await this.auditStore?.append({
      tenantId,
      eventType: "cost.reconciled",
      resourceType: "provider_attempt",
      resourceId: attemptId,
      actorType: "operator",
      actorId,
      idempotencyKey: `${attemptId}:${reference}`,
      details: { inputUnits: input, outputUnits: output, billedCostUsd: billed, reconciliationReference: reference },
    });
    return { attemptId, inputUnits: input, outputUnits: output, billedCostUsd: billed, reconciliationReference: reference, measurementStatus: "measured" };
  }
}

function safeReference(value) {
  const normalized = String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
  if (!normalized) throw new Error("reconciliationReference is required");
  if (SECRET_LIKE.test(normalized)) throw new Error("reconciliationReference looks like secret material");
  return normalized;
}
function nullableNonNegative(value, field) { return value === null || value === undefined || value === "" ? null : nonNegativeNumber(value, field); }
function nonNegativeNumber(value, field) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be non-negative`); return number; }
function boundedInteger(value, field, minimum, maximum) { const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`); return number; }
function reconciliationError(message, code) { const error = new Error(message); error.code = code; return error; }

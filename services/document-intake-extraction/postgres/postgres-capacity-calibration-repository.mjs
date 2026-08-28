import { randomUUID } from "node:crypto";

import { assertPinnedProviderCapability } from "../../../packages/extraction-contracts/index.mjs";
import { RollingCapacityCalibration } from "../capacity/rolling-capacity-calibration.mjs";
import { withDocumentIntakeExtractionTenant } from "./tenant-transaction.mjs";

export class PostgresCapacityCalibrationRepository {
  constructor({ pool, clock = () => new Date(), idFactory = () => randomUUID() } = {}) {
    if (!pool?.connect) throw new Error("PostgreSQL capacity calibration repository requires a pool");
    this.pool = pool;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async recordCorpus({ tenantId, workloadClass = "default", bytes, pages, ocrPages = pages, repairPages = 0 } = {}) {
    const normalizedPages = positiveInteger(pages, "pages");
    const ocrShare = share(ocrPages, normalizedPages, "ocrPages");
    const repairShare = share(repairPages, normalizedPages, "repairPages");
    const observationId = this.idFactory();
    const observedAt = this.clock().toISOString();
    await withDocumentIntakeExtractionTenant(this.pool, tenantId, (client) => client.query([
      "insert into document_intake_extraction.capacity_observations",
      "  (observation_id, tenant_id, workload_class, bytes, pages, ocr_share, repair_share, outcome, observed_at)",
      "values ($1::uuid, $2, $3, $4::bigint, $5::int, $6::numeric, $7::numeric, 'success', $8::timestamptz)",
    ].join("\n"), [observationId, tenantId, cleanClass(workloadClass), positiveInteger(bytes, "bytes"), normalizedPages, ocrShare, repairShare, observedAt]));
    return { observationId, observedAt, workloadClass: cleanClass(workloadClass), bytes: Number(bytes), pages: normalizedPages, ocrShare, repairShare };
  }

  async recordProvider({ tenantId, workloadClass = "default", provider, model, adapterVersion, pageOperations, durationMs, outcome = "success" } = {}) {
    const normalizedOutcome = normalizeOutcome(outcome);
    const capability = assertPinnedProviderCapability({ provider, model, adapterVersion });
    const observationId = this.idFactory();
    const observedAt = this.clock().toISOString();
    await withDocumentIntakeExtractionTenant(this.pool, tenantId, (client) => client.query([
      "insert into document_intake_extraction.capacity_observations",
      "  (observation_id, tenant_id, workload_class, provider, model, adapter_version, page_operations, duration_ms, throttled, outcome, observed_at)",
      "values ($1::uuid, $2, $3, $4, $5, $6, $7::numeric, $8::bigint, $9::boolean, $10, $11::timestamptz)",
    ].join("\n"), [
      observationId, tenantId, cleanClass(workloadClass), capability.provider, capability.model, capability.adapterVersion,
      positiveNumber(pageOperations, "pageOperations"), positiveInteger(durationMs, "durationMs"), normalizedOutcome === "throttled", normalizedOutcome, observedAt,
    ]));
    return { observationId, observedAt, workloadClass: cleanClass(workloadClass), provider, model, adapterVersion, pageOperations: Number(pageOperations), durationMs: Number(durationMs), outcome: normalizedOutcome };
  }

  async loadCalibration({ tenantId, maximumSamplesPerKey = 200 } = {}) {
    const maximum = boundedInteger(maximumSamplesPerKey, "maximumSamplesPerKey", 10, 10_000);
    return withDocumentIntakeExtractionTenant(this.pool, tenantId, async (client) => {
      const result = await client.query([
        "select * from (",
        "  select co.*, row_number() over (",
        "    partition by co.workload_class, coalesce(co.provider, ''), coalesce(co.model, ''), coalesce(co.adapter_version, '')",
        "    order by co.observed_at desc, co.observation_id desc",
        "  ) as sample_rank",
        "  from document_intake_extraction.capacity_observations co",
        "  where co.tenant_id = $1",
        ") ranked",
        "where sample_rank <= $2::int",
        "order by observed_at, observation_id",
      ].join("\n"), [tenantId, maximum]);
      const calibration = new RollingCapacityCalibration({ maximumSamplesPerKey: maximum });
      for (const row of result.rows) {
        if (row.provider) {
          calibration.recordProvider({
            provider: row.provider,
            model: row.model,
            adapterVersion: row.adapter_version,
            pageOperations: Number(row.page_operations),
            durationMs: Number(row.duration_ms),
            outcome: row.outcome || (row.throttled ? "throttled" : "success"),
          });
        } else if (row.bytes && row.pages) {
          const pages = Number(row.pages);
          calibration.recordCorpus({
            workloadClass: row.workload_class,
            bytes: Number(row.bytes),
            pages,
            ocrPages: Number(row.ocr_share) * pages,
            repairPages: Number(row.repair_share) * pages,
          });
        }
      }
      return calibration;
    });
  }
}

export class TenantCapacityCalibrationRegistry {
  constructor({ repository, maximumSamplesPerKey = 200 } = {}) {
    if (!repository?.loadCalibration || !repository?.recordCorpus || !repository?.recordProvider) {
      throw new Error("tenant calibration registry requires a durable repository");
    }
    this.repository = repository;
    this.maximumSamplesPerKey = maximumSamplesPerKey;
    this.models = new Map();
  }

  async forTenant(tenantId) {
    const key = required(tenantId, "tenantId");
    let pending = this.models.get(key);
    if (!pending) {
      pending = this.repository.loadCalibration({ tenantId: key, maximumSamplesPerKey: this.maximumSamplesPerKey });
      this.models.set(key, pending);
      pending.catch(() => this.models.delete(key));
    }
    return pending;
  }

  async refresh(tenantId) {
    this.models.delete(required(tenantId, "tenantId"));
    return this.forTenant(tenantId);
  }

  async recordCorpus(input = {}) {
    const key = required(input.tenantId, "tenantId");
    const existing = this.models.get(key);
    const persisted = await this.repository.recordCorpus(input);
    if (existing) (await existing).recordCorpus(input);
    else await this.forTenant(key);
    return persisted;
  }

  async recordProvider(input = {}) {
    const key = required(input.tenantId, "tenantId");
    const existing = this.models.get(key);
    const persisted = await this.repository.recordProvider(input);
    if (existing) (await existing).recordProvider(input);
    else await this.forTenant(key);
    return persisted;
  }
}

function cleanClass(value) {
  const normalized = String(value || "default").replace(/[\r\n\t]+/g, " ").trim().slice(0, 120);
  if (!normalized) throw new Error("workloadClass is required");
  return normalized;
}

function required(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizeOutcome(value) {
  const outcome = String(value || "success");
  if (!["success", "failed", "throttled"].includes(outcome)) throw new Error("provider capacity outcome is invalid");
  return outcome;
}

function share(value, pages, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > pages) throw new Error(`${field} must be from 0 to pages`);
  return number / pages;
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

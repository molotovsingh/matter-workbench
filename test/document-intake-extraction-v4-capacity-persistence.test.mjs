import assert from "node:assert/strict";
import test from "node:test";

import { RollingCapacityCalibration } from "../services/document-intake-extraction/capacity/rolling-capacity-calibration.mjs";
import { TenantCapacityCalibrationRegistry } from "../services/document-intake-extraction/postgres/postgres-capacity-calibration-repository.mjs";

// V4-ETA-001 durable, tenant-scoped calibration evidence
test("tenant calibration survives reload without duplicating the first persisted observation", async () => {
  const persisted = new Map();
  const repository = {
    async recordCorpus(input) { rows(input.tenantId).push({ type: "corpus", input: structuredClone(input) }); return { observationId: `corpus-${rows(input.tenantId).length}` }; },
    async recordProvider(input) { rows(input.tenantId).push({ type: "provider", input: structuredClone(input) }); return { observationId: `provider-${rows(input.tenantId).length}` }; },
    async loadCalibration({ tenantId, maximumSamplesPerKey }) {
      const model = new RollingCapacityCalibration({ maximumSamplesPerKey });
      for (const row of rows(tenantId)) {
        if (row.type === "corpus") model.recordCorpus(row.input);
        else model.recordProvider(row.input);
      }
      return model;
    },
  };
  function rows(tenantId) {
    if (!persisted.has(tenantId)) persisted.set(tenantId, []);
    return persisted.get(tenantId);
  }

  const registry = new TenantCapacityCalibrationRegistry({ repository });
  await registry.recordCorpus({ tenantId: "tenant-1", workloadClass: "mixed", bytes: 1000, pages: 10, ocrPages: 8, repairPages: 1 });
  assert.equal((await registry.forTenant("tenant-1")).estimateCorpus("mixed").sampleCount, 1);
  await registry.recordCorpus({ tenantId: "tenant-1", workloadClass: "mixed", bytes: 2000, pages: 20, ocrPages: 16, repairPages: 2 });
  assert.equal((await registry.forTenant("tenant-1")).estimateCorpus("mixed").sampleCount, 2);
  assert.equal((await registry.forTenant("tenant-2")).estimateCorpus("mixed").sampleCount, 0);
  await registry.refresh("tenant-1");
  assert.equal((await registry.forTenant("tenant-1")).estimateCorpus("mixed").sampleCount, 2);
});

test("provider calibration excludes failed and throttled attempts from throughput while retaining reliability rates", () => {
  const model = new RollingCapacityCalibration();
  const capability = { provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "range/v1" };
  model.recordProvider({ ...capability, pageOperations: 100, durationMs: 1000, outcome: "success" });
  model.recordProvider({ ...capability, pageOperations: 100, durationMs: 10, outcome: "throttled" });
  model.recordProvider({ ...capability, pageOperations: 100, durationMs: 20, outcome: "failed" });
  const estimate = model.estimateProvider(capability);
  assert.equal(estimate.sampleCount, 3);
  assert.equal(estimate.successfulSampleCount, 1);
  assert.equal(estimate.pageOperationsPerSecond.median, 100);
  assert.equal(estimate.throttleRate, 1 / 3);
  assert.equal(estimate.failureRate, 1 / 3);
});

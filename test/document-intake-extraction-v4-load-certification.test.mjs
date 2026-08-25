import assert from "node:assert/strict";
import test from "node:test";

import { evaluateLoadCertification } from "../services/document-intake-extraction/capacity/load-certification.mjs";

// V4-LOAD-001 tooling evidence only; production-shaped load evidence remains pending.
test("load certification accepts repeated full-envelope runs only after approved concurrency coverage and hard integrity checks", () => {
  const certification = evaluateLoadCertification({
    distributionApprovalId: "capacity-review-2026-08-24",
    runs: loadRuns(),
  });
  assert.equal(certification.certified, true);
  assert.equal(certification.evidence.fullEnvelopeRuns, 30);
  assert.deepEqual(certification.evidence.concurrencyStrata, [1, 2, 4]);
  assert.ok(certification.evidence.p95Seconds <= 60);
  assert.ok(certification.evidence.p99Seconds <= 120);
});

test("load certification fails closed on unapproved distribution, non-production shape, unreconciled evidence, and P99 breach", () => {
  const runs = loadRuns();
  runs[0] = {
    ...runs[0],
    readyAt: new Date(Date.parse(runs[0].custodyCommittedAt) + 130_000).toISOString(),
    productionShapedStorage: false,
    providerQuotaCertificateId: "",
    omittedPages: 1,
    duplicateReadyEvents: 1,
    unreconciledCostEvents: 1,
  };
  const certification = evaluateLoadCertification({ distributionApprovalId: "TBD", runs });
  assert.equal(certification.certified, false);
  for (const reason of [
    "concurrent_distribution_not_approved",
    "omitted_pages_present",
    "duplicate_publication_present",
    "unreconciled_cost_present",
    "production_shape_missing",
    "provider_quota_certificate_missing",
    "p99_objective_missed",
  ]) assert.ok(certification.reasons.includes(reason), reason);
});

function loadRuns() {
  const custodyBase = Date.parse("2026-08-24T12:00:00.000Z");
  const strata = [1, 2, 4];
  return Array.from({ length: 30 }, (_, index) => {
    const custodyAt = custodyBase + index * 300_000;
    const durationSeconds = 40 + (index % 16);
    return {
      runId: `envelope-${index + 1}`,
      files: 500,
      pages: 10_000,
      bytes: 2 * 1024 * 1024 * 1024,
      concurrentIntakes: strata[index % strata.length],
      custodyCommittedAt: new Date(custodyAt).toISOString(),
      readyAt: new Date(custodyAt + durationSeconds * 1000).toISOString(),
      status: index % 7 === 0 ? "ready_with_review" : "ready",
      omittedPages: 0,
      duplicateReadyEvents: 0,
      unreconciledCostEvents: 0,
      productionShapedStorage: true,
      productionShapedPostgres: true,
      statelessBurstWorkers: true,
      providerQuotaCertificateId: "quota-certificate-2026-08-24",
    };
  });
}

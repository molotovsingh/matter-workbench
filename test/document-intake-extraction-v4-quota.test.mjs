import assert from "node:assert/strict";
import test from "node:test";

import { evaluateProviderQuotaCertification } from "../services/document-intake-extraction/capacity/provider-quota-certification.mjs";

// V4-QUOTA-001 tooling evidence only; production quota evidence remains pending.
test("quota certification counts only identified pinned lanes with sustained throughput and an outage drill", () => {
  const certification = evaluateProviderQuotaCertification({
    lanes: [
      certifiedLane({ provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "range/v1", required: 225, throughput: 230 }),
      certifiedLane({ provider: "google", model: "gemini-3.7-flash", adapterVersion: "repair/v1", required: 25, throughput: 30 }),
    ],
  });
  assert.equal(certification.certified, true);
  assert.equal(certification.requiredAggregatePageOperationsPerSecond, 250);
  assert.equal(certification.certifiedPageOperationsPerSecond, 260);
  assert.ok(certification.lanes.every((lane) => lane.evidence.sustainedWindows === 30));
});

test("quota certification fails closed on unidentified administration, thin samples, throttle, or absent recovery evidence", () => {
  const lane = certifiedLane({ provider: "google", model: "gemini-3.7-flash", adapterVersion: "repair/v1", required: 250, throughput: 300 });
  lane.administrativeScopeId = "TBD";
  lane.productionIdentityId = "api_key=super-secret-value";
  lane.sustainedWindows = lane.sustainedWindows.slice(0, 2).map((window) => ({ ...window, throttles: 20 }));
  lane.outageRecovery = { tested: false };
  const certification = evaluateProviderQuotaCertification({ lanes: [lane] });
  assert.equal(certification.certified, false);
  assert.equal(certification.certifiedPageOperationsPerSecond, 0);
  assert.ok(certification.reasons.includes("certified_capacity_below_target"));
  assert.ok(certification.lanes[0].reasons.includes("administrative_scope_missing"));
  assert.ok(certification.lanes[0].reasons.includes("production_identity_looks_secret"));
  assert.ok(certification.lanes[0].reasons.includes("insufficient_sustained_windows"));
  assert.ok(certification.lanes[0].reasons.includes("throttle_rate_above_limit"));
  assert.ok(certification.lanes[0].reasons.includes("outage_recovery_not_tested"));
  assert.doesNotMatch(JSON.stringify(certification), /super-secret-value/);
});

function certifiedLane({ provider, model, adapterVersion, required, throughput }) {
  return {
    provider,
    model,
    adapterVersion,
    administrativeScopeId: `${provider}-production-scope`,
    productionIdentityId: `${provider}-workload-identity`,
    region: "ap-southeast-2",
    regionalEndpoint: `https://${provider}.ap-southeast-2.example.invalid`,
    requiredPageOperationsPerSecond: required,
    quotaLimitPageOperationsPerSecond: throughput + 20,
    sustainedWindows: Array.from({ length: 30 }, (_, index) => ({
      startedAt: new Date(Date.UTC(2026, 7, 24, 10, index)).toISOString(),
      durationSeconds: 60,
      pageOperations: throughput * 60,
      requests: 1000,
      throttles: 0,
      failures: 0,
    })),
    outageRecovery: { tested: true, recoverySeconds: 45, dataLossOrDuplicatePublication: false },
  };
}

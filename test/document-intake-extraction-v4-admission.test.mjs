import assert from "node:assert/strict";
import test from "node:test";

import {
  AdaptiveProviderAdmissionController,
  createCertifiedProviderAdmissionController,
} from "../services/document-intake-extraction/capacity/adaptive-provider-admission.mjs";

const CAPABILITY = { provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "range/v1" };

// V4-SCHEDULE-001 live provider-admission evidence
test("live admission cannot be built from pending or uncertified provider evidence", () => {
  assert.throws(() => createCertifiedProviderAdmissionController({ certification: { certified: false } }), {
    code: "provider_admission.certification_required",
  });
  const controller = createCertifiedProviderAdmissionController({
    certification: {
      schemaVersion: "document-intake-extraction.provider-quota-certification/v1",
      certified: true,
      lanes: [{ capability: CAPABILITY, certified: true, certifiedPageOperationsPerSecond: 225 }],
    },
    concurrencyByCapability: { mistral: { minimumConcurrent: 2, maximumConcurrent: 20, burstPageOperations: 450 } },
  });
  assert.equal(controller.snapshot(CAPABILITY).pageOperationsPerSecond, 225);
});

test("adaptive admission enforces page rate and concurrency before provider work", () => {
  let nowMs = Date.parse("2026-08-24T12:00:00.000Z");
  let permit = 0;
  const controller = new AdaptiveProviderAdmissionController({
    capabilities: [{
      capability: CAPABILITY,
      maximumConcurrent: 4,
      minimumConcurrent: 1,
      pageOperationsPerSecond: 10,
      burstPageOperations: 10,
    }],
    clock: () => new Date(nowMs),
    permitFactory: () => `permit-${++permit}`,
    additiveIncreaseEvery: 2,
  });
  const first = controller.acquire(CAPABILITY, { weight: 8 });
  assert.equal(first.admitted, true);
  const rateLimited = controller.acquire(CAPABILITY, { weight: 3 });
  assert.deepEqual({ admitted: rateLimited.admitted, reason: rateLimited.reason, retryAfterMs: rateLimited.retryAfterMs }, {
    admitted: false, reason: "provider_rate_exhausted", retryAfterMs: 100,
  });
  nowMs += 100;
  const second = controller.acquire(CAPABILITY, { weight: 3 });
  assert.equal(second.admitted, true);
  assert.equal(controller.snapshot(CAPABILITY).inflight, 2);
  controller.cancel(second.permit);
  assert.equal(controller.snapshot(CAPABILITY).inflight, 1);
  assert.throws(() => controller.cancel(second.permit), { code: "provider_admission.permit_invalid" });
  controller.complete(first.permit, { outcome: "success" });
  assert.equal(controller.snapshot(CAPABILITY).inflight, 0);
});

test("429 feedback halves concurrency, enforces cooldown, then recovers additively", () => {
  let nowMs = Date.parse("2026-08-24T12:00:00.000Z");
  let permit = 0;
  const controller = new AdaptiveProviderAdmissionController({
    capabilities: [{ capability: CAPABILITY, maximumConcurrent: 4, minimumConcurrent: 1, pageOperationsPerSecond: 100, burstPageOperations: 100 }],
    clock: () => new Date(nowMs),
    permitFactory: () => `permit-${++permit}`,
    additiveIncreaseEvery: 2,
  });
  const throttled = controller.acquire(CAPABILITY).permit;
  const afterThrottle = controller.complete(throttled, { outcome: "throttled", retryAfterMs: 5_000 });
  assert.equal(afterThrottle.concurrencyLimit, 2);
  assert.equal(afterThrottle.throttles, 1);
  assert.deepEqual(controller.acquire(CAPABILITY), {
    admitted: false, reason: "provider_cooldown", retryAfterMs: 5_000,
  });
  nowMs += 5_000;
  for (let index = 0; index < 2; index += 1) {
    const admitted = controller.acquire(CAPABILITY);
    assert.equal(admitted.admitted, true);
    controller.complete(admitted.permit, { outcome: "success" });
  }
  assert.equal(controller.snapshot(CAPABILITY).concurrencyLimit, 3);
  assert.throws(() => controller.acquire({ provider: "other", model: "pinned-v1", adapterVersion: "v1" }), {
    code: "provider_admission.capability_unknown",
  });
});

// Dynamic lanes: discovered concurrency instead of configured concurrency.
test("slow start begins at the floor, doubles on sustained health, and yields to AIMD after the first throttle", () => {
  const controller = new AdaptiveProviderAdmissionController({
    capabilities: [{
      capability: CAPABILITY,
      minimumConcurrent: 2,
      startConcurrent: 2,
      maximumConcurrent: 16,
      pageOperationsPerSecond: 1000,
      burstPageOperations: 10000,
    }],
    slowStartEvery: 2,
    additiveIncreaseEvery: 3,
  });
  const succeed = () => {
    const admission = controller.acquire(CAPABILITY, { weight: 1 });
    assert.equal(admission.admitted, true);
    controller.complete(admission.permit, { outcome: "success" });
  };
  assert.equal(controller.snapshot(CAPABILITY).concurrencyLimit, 2);
  assert.equal(controller.snapshot(CAPABILITY).slowStart, true);
  succeed(); succeed();
  assert.equal(controller.snapshot(CAPABILITY).concurrencyLimit, 4);
  succeed(); succeed();
  assert.equal(controller.snapshot(CAPABILITY).concurrencyLimit, 8);
  succeed(); succeed();
  assert.equal(controller.snapshot(CAPABILITY).concurrencyLimit, 16, "slow start must reach but never exceed the ceiling");
  const throttledAdmission = controller.acquire(CAPABILITY, { weight: 1 });
  controller.complete(throttledAdmission.permit, { outcome: "throttled", retryAfterMs: 1 });
  const afterThrottle = controller.snapshot(CAPABILITY);
  assert.equal(afterThrottle.concurrencyLimit, 8, "throttle must halve the discovered limit");
  assert.equal(afterThrottle.slowStart, false, "first throttle ends slow start permanently");
});

// Demand ceiling: never grow lanes past what the work graph can feed.
test("demand ceiling caps slow-start growth and clamps an already-grown limit", () => {
  const controller = new AdaptiveProviderAdmissionController({
    capabilities: [{
      capability: CAPABILITY,
      minimumConcurrent: 2,
      startConcurrent: 2,
      maximumConcurrent: 64,
      pageOperationsPerSecond: 1000,
      burstPageOperations: 10000,
    }],
    slowStartEvery: 1,
  });
  const succeed = () => {
    const admission = controller.acquire(CAPABILITY, { weight: 1 });
    controller.complete(admission.permit, { outcome: "success" });
  };
  controller.setDemandCeiling(CAPABILITY, 6);
  succeed(); succeed(); succeed(); succeed();
  assert.equal(controller.snapshot(CAPABILITY).concurrencyLimit, 6, "growth stops at the demand ceiling, not the resource maximum");
  controller.setDemandCeiling(CAPABILITY, 3);
  assert.equal(controller.snapshot(CAPABILITY).concurrencyLimit, 3, "a lowered ceiling clamps the live limit");
  controller.setDemandCeiling(CAPABILITY, null);
  succeed(); succeed();
  assert.ok(controller.snapshot(CAPABILITY).concurrencyLimit > 3, "clearing the ceiling resumes growth");
});

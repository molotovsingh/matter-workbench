import assert from "node:assert/strict";
import test from "node:test";

import { PredictiveBurstCapacityManager } from "../services/document-intake-extraction/capacity/predictive-burst-capacity-manager.mjs";

// V4-ETA-001 predictive burst execution evidence
test("capacity manager durably schedules burst workers inside the remaining upload window", async () => {
  const calls = [];
  const store = fakeStore(calls);
  const manager = new PredictiveBurstCapacityManager({
    store,
    provisioner: { async setDesiredCapacity() { throw new Error("not called"); } },
    clock: () => new Date("2026-08-24T12:00:00.000Z"),
  });
  const request = await manager.requestFromPlan({
    tenantId: "tenant-1",
    poolId: "ocr-ap-southeast-2",
    workloadClass: "mixed-legal",
    plan: capacityPlan({ action: "schedule_during_upload", remainingUploadSeconds: 100, scaleLeadSeconds: 20 }),
  });
  assert.equal(request.status, "scheduled");
  assert.equal(calls[0].desiredWorkers, 8);
  assert.equal(calls[0].minimumWorkers, 2);
  assert.equal(calls[0].maximumWorkers, 20);
  assert.equal(calls[0].notBefore.toISOString(), "2026-08-24T12:01:20.000Z");
  assert.equal(calls[0].reason.predictedPageOperationsHigh, 10_000);
});

test("capacity manager applies stable idempotent targets and checkpoints observed capacity", async () => {
  const calls = [];
  const store = fakeStore(calls, claimedRequest());
  const provisioned = [];
  const manager = new PredictiveBurstCapacityManager({
    store,
    provisioner: {
      async setDesiredCapacity(input) { provisioned.push(input); return { observedWorkers: 7 }; },
    },
  });
  const outcome = await manager.applyOnce({ tenantId: "tenant-1", workerId: "capacity-1" });
  assert.equal(outcome.status, "applied");
  assert.equal(provisioned[0].idempotencyKey, "11111111-1111-4111-8111-111111111111:3");
  assert.equal(calls.find((call) => call.kind === "applied").observedWorkers, 7);
});

test("capacity manager persists sanitized retry evidence and does not hot-loop failures", async () => {
  const calls = [];
  const store = fakeStore(calls, claimedRequest());
  const manager = new PredictiveBurstCapacityManager({
    store,
    provisioner: {
      async setDesiredCapacity() {
        const error = new Error("token=provider-secret Bearer another-secret temporarily unavailable");
        error.code = "capacity.http_503";
        error.retryAfterMs = 12_000;
        throw error;
      },
    },
    baseRetryMs: 5_000,
  });
  const outcomes = await manager.drainTenant({ tenantId: "tenant-1" });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, "failed");
  const failed = calls.find((call) => call.kind === "failed");
  assert.equal(failed.retryAfterMs, 12_000);
  assert.doesNotMatch(failed.errorMessage, /provider-secret|another-secret/);
  assert.match(failed.errorMessage, /REDACTED/);
});

function capacityPlan({ action, remainingUploadSeconds, scaleLeadSeconds }) {
  return {
    schemaVersion: "document-intake-extraction.capacity-plan/v1",
    workers: { targetWorkers: 8, warmWorkers: 2, maximumWorkers: 20 },
    workload: { remainingPageOperations: { high: 10_000 } },
    uploadScaleWindow: { action, remainingUploadSeconds, scaleLeadSeconds, additionalWorkers: 6 },
    exception: { reasons: [] },
  };
}

function claimedRequest() {
  return {
    capacityRequestId: "11111111-1111-4111-8111-111111111111",
    generation: 3,
    poolId: "ocr-ap-southeast-2",
    workloadClass: "mixed-legal",
    desiredWorkers: 8,
    minimumWorkers: 2,
    maximumWorkers: 20,
    leaseToken: "22222222-2222-4222-8222-222222222222",
    attemptCount: 2,
  };
}

function fakeStore(calls, initialClaim = null) {
  let claim = initialClaim;
  return {
    async request(input) { calls.push(input); return { ...input, capacityRequestId: "request-1", generation: 1, status: "scheduled" }; },
    async claimDue(input) { calls.push({ kind: "claim", ...input }); const value = claim; claim = null; return value; },
    async markApplied(input) { calls.push({ kind: "applied", ...input }); return { ...input, status: "applied" }; },
    async markFailed(input) { calls.push({ kind: "failed", ...input }); return { ...input, status: "failed" }; },
  };
}

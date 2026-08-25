import assert from "node:assert/strict";
import test from "node:test";

import { RollingCapacityCalibration } from "../services/document-intake-extraction/capacity/rolling-capacity-calibration.mjs";
import { planWorkloadCapacity } from "../services/document-intake-extraction/capacity/workload-capacity-planner.mjs";

const MiB = 1024 * 1024;

// V4-ETA-001
test("V4-ETA-001 continuously recalibrates corpus-sensitive ETA ranges and starts burst workers during upload", () => {
  const calibration = new RollingCapacityCalibration();
  for (let index = 0; index < 25; index += 1) {
    calibration.recordCorpus({
      workloadClass: "archival",
      bytes: 10 * MiB,
      pages: 400 + (index % 5) * 5,
      ocrPages: 360,
      repairPages: 24,
    });
    calibration.recordProvider({
      provider: "mistral",
      model: "mistral-ocr-4-1",
      adapterVersion: "mistral-adapter/1.0.0",
      pageOperations: 400,
      durationMs: 1_700 + (index % 4) * 100,
      throttled: index === 24,
    });
  }
  for (let index = 0; index < 10; index += 1) {
    calibration.recordCorpus({
      workloadClass: "born-digital",
      bytes: 10 * MiB,
      pages: 80 + index,
      ocrPages: 8,
      repairPages: 1,
    });
  }
  const archival = calibration.estimateCorpus("archival");
  const bornDigital = calibration.estimateCorpus("born-digital");
  assert.ok(archival.pagesPerByte.median > bornDigital.pagesPerByte.median * 4);
  assert.ok(archival.ocrShare > bornDigital.ocrShare);

  const primary = calibration.estimateProvider({
    provider: "mistral",
    model: "mistral-ocr-4-1",
    adapterVersion: "mistral-adapter/1.0.0",
  });
  const plan = planWorkloadCapacity({
    workload: {
      expectedFiles: 500,
      expectedBytes: 2 * 1024 * MiB,
      committedFiles: 250,
      committedBytes: 1024 * MiB,
      observedPages: 5_000,
      uploadBytesPerSecond: 50 * MiB,
    },
    corpusEstimate: archival,
    providerStages: [{
      stage: "primary_ocr",
      provider: "mistral",
      model: "mistral-ocr-4-1",
      adapterVersion: "mistral-adapter/1.0.0",
      workShare: archival.ocrShare,
      pageOperationsPerSecond: primary.pageOperationsPerSecond.median,
      conservativePageOperationsPerSecond: primary.pageOperationsPerSecond.conservative,
      optimisticPageOperationsPerSecond: primary.pageOperationsPerSecond.optimistic,
      quotaPageOperationsPerSecond: 250,
      throttleRate: primary.throttleRate,
      sampleCount: primary.sampleCount,
      targetSeconds: 55,
    }, {
      stage: "selective_repair",
      provider: "gemini",
      model: "gemini-3.7-flash",
      adapterVersion: "gemini-adapter/1.0.0",
      workShare: archival.repairShare,
      pageOperationsPerSecond: 100,
      conservativePageOperationsPerSecond: 80,
      quotaPageOperationsPerSecond: 120,
      sampleCount: 25,
      targetSeconds: 55,
    }],
    queue: { weightedPageOperations: 0 },
    workers: {
      activeWorkers: 2,
      warmWorkers: 2,
      maximumWorkers: 32,
      pageOperationsPerSecondPerWorker: 15,
      bootP95Seconds: 20,
      scaleSafetySeconds: 5,
      scratchBytesPerWorker: 1024 * MiB,
      availableScratchBytes: 32 * 1024 * MiB,
    },
  });
  assert.equal(plan.schemaVersion, "document-intake-extraction.capacity-plan/v1");
  assert.ok(plan.workload.predictedPages.high <= 10_000);
  assert.ok(plan.workers.targetWorkers > plan.workers.activeWorkers);
  assert.equal(plan.uploadScaleWindow.action, "scale_now");
  assert.equal(plan.processingEta.confidence, "medium");
  assert.ok(plan.processingEta.lowerSeconds < plan.processingEta.upperSeconds);
  assert.ok(!plan.exception.reasons.includes("local_worker_capacity"));

  const restored = RollingCapacityCalibration.fromSnapshot(calibration.snapshot());
  assert.deepEqual(restored.estimateCorpus("archival"), archival);
});

test("capacity planning reports provider and queue exceptions instead of presenting a false precise countdown", () => {
  const base = {
    workload: { expectedFiles: 100, expectedBytes: 100 * MiB, committedFiles: 0, committedBytes: 0, observedPages: 0 },
    corpusEstimate: {
      sampleCount: 20,
      pagesPerByte: { low: 1 / (200 * 1024), median: 1 / (100 * 1024), high: 1 / (50 * 1024) },
      ocrShare: 0.9,
      repairShare: 0.05,
    },
    workers: { activeWorkers: 4, warmWorkers: 4, maximumWorkers: 8, pageOperationsPerSecondPerWorker: 20 },
  };
  const unavailable = planWorkloadCapacity({ ...base, providerStages: [] });
  assert.equal(unavailable.processingEta.sloState, "exception_predicted");
  assert.equal(unavailable.processingEta.upperSeconds, null);
  assert.ok(unavailable.exception.reasons.includes("provider_capacity_unavailable"));

  const queued = planWorkloadCapacity({
    ...base,
    providerStages: [{
      stage: "primary_ocr",
      provider: "mistral",
      model: "mistral-ocr-4-1",
      adapterVersion: "adapter/v1",
      workShare: 0.95,
      pageOperationsPerSecond: 50,
      conservativePageOperationsPerSecond: 40,
      quotaPageOperationsPerSecond: 50,
      sampleCount: 20,
    }],
    queue: { weightedPageOperations: 10_000 },
  });
  assert.ok(queued.providers.queueSeconds > 55);
  assert.ok(queued.exception.reasons.includes("queue_depth"));
  assert.equal(queued.processingEta.sloState, "exception_predicted");
});

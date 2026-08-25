import assert from "node:assert/strict";
import test from "node:test";

import { RollingCapacityCalibration } from "../services/document-intake-extraction/capacity/rolling-capacity-calibration.mjs";
import { IntakeProgressService } from "../services/document-intake-extraction/progress/intake-progress-service.mjs";

// V4-ETA-001 durable progress projection evidence
test("progress projection separates upload ETA, weighted processing ETA, live capacity, and post-120-second exceptions", async () => {
  const calibration = calibratedModel();
  const snapshot = progressSnapshot({ status: "processing", custodyCommittedAt: "2026-08-24T11:57:00.000Z" });
  const service = new IntakeProgressService({
    intakeRepository: { readProgressSnapshot: async () => snapshot },
    calibration,
    providerStages: [{
      stage: "primary_ocr",
      provider: "mistral",
      model: "mistral-ocr-4-1",
      adapterVersion: "adapter/v1",
      quotaPageOperationsPerSecond: 200,
      safetyFactor: 0.8,
      fallback: { pageOperationsPerSecond: 100 },
    }],
    workerCapacity: {
      activeWorkers: 2,
      warmWorkers: 2,
      maximumWorkers: 16,
      pageOperationsPerSecondPerWorker: 20,
      bootP95Seconds: 15,
    },
    clock: () => new Date("2026-08-24T12:00:00.000Z"),
  });
  const progress = await service.getProgress({
    tenantId: "tenant-1",
    intakeId: "intake-1",
    workloadClass: "mixed-legal",
    uploadBytesPerSecond: 100,
  });
  assert.equal(progress.schemaVersion, "document-intake-extraction.progress/v1");
  assert.equal(progress.upload.etaSeconds, 5);
  assert.equal(progress.processing.completionRatio, 0.4);
  assert.equal(progress.processing.custodyElapsedSeconds, 180);
  assert.ok(progress.processing.eta.lowerSeconds <= progress.processing.eta.upperSeconds);
  assert.ok(progress.capacity.providers.totalEffectivePageOperationsPerSecond > 0);
  assert.ok(progress.exception.reasons.includes("processing_objective_breached"));
  assert.doesNotMatch(JSON.stringify(progress), /provider-secret|filename/i);
});

test("ready progress freezes ETA at zero and clears stale capacity exceptions", async () => {
  const snapshot = progressSnapshot({ status: "ready_with_review", custodyCommittedAt: "2026-08-24T11:50:00.000Z" });
  snapshot.intake.committedFiles = undefined;
  snapshot.intake.committedFileCount = 2;
  snapshot.intake.committedBytes = 1000;
  snapshot.work = snapshot.work.map((row) => ({ ...row, status: "review_required" }));
  const service = new IntakeProgressService({
    intakeRepository: { readProgressSnapshot: async () => snapshot },
    calibration: calibratedModel(),
    providerStages: [],
    workerCapacity: { activeWorkers: 1, warmWorkers: 1, maximumWorkers: 1, pageOperationsPerSecondPerWorker: 1 },
    clock: () => new Date("2026-08-24T12:00:00.000Z"),
  });
  snapshot.intake.workloadClass = "archival_legal";
  const progress = await service.getProgress({ tenantId: "tenant-1", intakeId: "intake-1" });
  assert.equal(progress.workloadClass, "archival_legal");
  assert.equal(progress.processing.eta.lowerSeconds, 0);
  assert.equal(progress.processing.eta.upperSeconds, 0);
  assert.equal(progress.processing.eta.sloState, "complete");
  assert.equal(progress.exception.active, false);
  assert.equal(progress.processing.completionRatio, 1);
});

function calibratedModel() {
  const calibration = new RollingCapacityCalibration();
  for (let index = 0; index < 10; index += 1) {
    calibration.recordCorpus({ workloadClass: "mixed-legal", bytes: 1000, pages: 10, ocrPages: 8, repairPages: 1 });
    calibration.recordProvider({
      provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "adapter/v1",
      pageOperations: 100, durationMs: 1000 + index * 10,
    });
  }
  return calibration;
}

function progressSnapshot({ status, custodyCommittedAt }) {
  return {
    intake: {
      intakeId: "intake-1",
      tenantId: "tenant-1",
      status,
      expectedFileCount: 2,
      expectedBytes: 1000,
      committedFileCount: 1,
      committedBytes: 500,
      observedPageCount: 5,
      custodyCommittedAt,
    },
    work: [
      { status: "accepted", provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "adapter/v1", computations: 2, weight: 2 },
      { status: "queued", provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "adapter/v1", computations: 3, weight: 3 },
    ],
    queueWeightedPageOperations: 4,
  };
}

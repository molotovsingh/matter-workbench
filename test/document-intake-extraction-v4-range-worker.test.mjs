import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPageValidator } from "../services/document-intake-extraction/page-validator.mjs";
import { GEMINI37_REPAIR_CAPABILITY } from "../services/document-intake-extraction/providers/gemini37-repair-adapter.mjs";
import { MISTRAL_OCR41_RANGE_CAPABILITY } from "../services/document-intake-extraction/providers/mistral-ocr41-range-adapter.mjs";
import { createSelectiveRepairRouter } from "../services/document-intake-extraction/routing/selective-repair-router.mjs";
import { PostgresDocumentRangeWorker } from "../workers/document-processing/postgres-document-range-worker.mjs";
import { WorkerScratchSpace } from "../workers/document-processing/worker-scratch-space.mjs";

// V4-WORK-001 and V4-SCHEDULE-001 document-local execution evidence
test("range worker turns contiguous same-document claims into one provider call and three fenced checkpoints", async () => {
  const fixture = await rangeFixture();
  let providerCalls = 0;
  const publications = [];
  const worker = new PostgresDocumentRangeWorker({
    ...fixture.dependencies,
    providers: [{
      capability: MISTRAL_OCR41_RANGE_CAPABILITY,
      async extractPages({ pageNumbers, source }) {
        providerCalls += 1;
        assert.deepEqual(pageNumbers, [4, 5, 6]);
        assert.match((await source.readBytes()).toString(), /range 4-6/);
        return pageNumbers.map((pageNumber) => providerResult(pageNumber));
      },
    }],
    resultRepository: {
      async publishReadyIntake(input) { publications.push(input); return { published: true, result: { resultId: "result-1" } }; },
    },
  });
  try {
    const outcome = await worker.runOnce({ tenantId: "tenant-1", workerId: "range-worker-1" });
    assert.equal(providerCalls, 1);
    assert.deepEqual(outcome.statuses, ["accepted", "accepted", "accepted"]);
    assert.equal(fixture.repository.successes.length, 3);
    assert.equal(fixture.repository.failures.length, 0);
    assert.deepEqual(publications, [{ tenantId: "tenant-1", intakeId: "intake-1" }]);
    assert.deepEqual(await readdir(fixture.root), []);
  } finally {
    await fixture.cleanup();
  }
});

test("range worker atomically requests selective page repair without repairing accepted neighbors", async () => {
  const fixture = await rangeFixture();
  const worker = new PostgresDocumentRangeWorker({
    ...fixture.dependencies,
    repairRouter: createSelectiveRepairRouter({ repairProvider: GEMINI37_REPAIR_CAPABILITY }),
    providers: [{
      capability: MISTRAL_OCR41_RANGE_CAPABILITY,
      async extractPages({ pageNumbers }) {
        return pageNumbers.map((pageNumber) => pageNumber === 5 ? { ...providerResult(pageNumber), text: "" } : providerResult(pageNumber));
      },
    }],
  });
  try {
    const outcome = await worker.runOnce({ tenantId: "tenant-1" });
    assert.deepEqual(outcome.statuses, ["accepted", "repair_queued", "accepted"]);
    const repaired = fixture.repository.successes.filter((checkpoint) => checkpoint.repair);
    assert.equal(repaired.length, 1);
    assert.equal(repaired[0].claim.pageNumber, 5);
    assert.deepEqual(repaired[0].repair.capability, GEMINI37_REPAIR_CAPABILITY);
    assert.match(repaired[0].repair.fingerprint, /^[a-f0-9]{64}$/);
  } finally {
    await fixture.cleanup();
  }
});

test("range worker allocates known failed-call cost across every claimed page", async () => {
  const fixture = await rangeFixture();
  const worker = new PostgresDocumentRangeWorker({
    ...fixture.dependencies,
    providers: [{
      capability: MISTRAL_OCR41_RANGE_CAPABILITY,
      async extractPages() {
        const error = new Error("provider returned an incomplete range");
        error.code = "provider.invalid_response";
        error.retryable = false;
        error.billingKnown = true;
        error.billedCostUsd = 0.012;
        error.usage = { inputUnits: 3, outputUnits: 0 };
        throw error;
      },
    }],
  });
  try {
    const outcome = await worker.runOnce({ tenantId: "tenant-1" });
    assert.deepEqual(outcome.statuses, ["review_required", "review_required", "review_required"]);
    assert.equal(fixture.repository.failures.length, 3);
    assert.ok(fixture.repository.failures.every(({ error }) => Math.abs(error.billedCostUsd - 0.004) < 1e-12));
    assert.deepEqual(fixture.repository.failures.map(({ error }) => error.usage.inputUnits), [1, 1, 1]);
    assert.deepEqual(await readdir(fixture.root), []);
  } finally {
    await fixture.cleanup();
  }
});

async function rangeFixture() {
  const root = await mkdtemp(`${os.tmpdir()}/mwb-v4-range-worker-`);
  const payload = Buffer.from("%PDF complete source");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const claims = [4, 5, 6].map((pageNumber) => ({
    workUnitId: randomUUID(),
    attemptId: randomUUID(),
    leaseToken: randomUUID(),
    fingerprint: createHash("sha256").update(`page-${pageNumber}`).digest("hex"),
    tenantId: "tenant-1",
    sourceSha256: sha256,
    sourceBytes: payload.length,
    blobReference: { sha256, objectKey: `blobs/${sha256}` },
    pageNumber,
    capability: MISTRAL_OCR41_RANGE_CAPABILITY,
    validatorVersion: "page-validator/v1",
  }));
  const repository = {
    claims,
    successes: [], failures: [], renewals: [],
    async claimDocumentLocalBatch() { const result = this.claims; this.claims = []; return result; },
    async renew(input) { this.renewals.push(input); return { renewed: true }; },
    async finishSuccess(input) { this.successes.push(input); return { status: input.repair ? "repair_queued" : input.validation.outcome, intakeIds: ["intake-1"] }; },
    async finishFailure(input) { this.failures.push(input); return { status: "review_required", intakeIds: ["intake-1"] }; },
  };
  const scratchSpace = new WorkerScratchSpace({
    root,
    maximumTaskBytes: 1024,
    minimumFreeBytes: 0,
    statfsImpl: async () => ({ bavail: 1_000_000, bsize: 1 }),
  });
  return {
    root,
    repository,
    dependencies: {
      workRepository: repository,
      objectStore: { openBlobStream: async () => ({ contentLength: payload.length, body: payload }) },
      scratchSpace,
      pageMaterializer: {
        maximumRangeBytes: 0,
        async materializePageRange({ firstPage, lastPage, allocation }) {
          const filePath = allocation.pathFor("pages/range.pdf");
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, `%PDF range ${firstPage}-${lastPage}`);
          return { filePath, bytes: 20, firstPage, lastPage };
        },
      },
      validator: createPageValidator(),
      maximumPages: 8,
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function providerResult(pageNumber) {
  return {
    schemaVersion: "document-intake-extraction.provider-page-result/v1",
    pageNumber,
    text: `Legal page ${pageNumber} with sufficient extracted content for validation.`,
    finishReason: "complete",
    requestId: "range-request-1",
    usage: { inputUnits: 1, outputUnits: 0 },
    billedCostUsd: 0.004,
    diagnostics: [],
  };
}

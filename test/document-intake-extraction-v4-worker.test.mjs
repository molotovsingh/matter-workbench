import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPageValidator } from "../services/document-intake-extraction/page-validator.mjs";
import { createSelectiveRepairRouter } from "../services/document-intake-extraction/routing/selective-repair-router.mjs";
import { PdfPageMaterializer } from "../workers/document-processing/pdf-page-materializer.mjs";
import { PdfInfoDocumentInspector } from "../workers/document-processing/pdfinfo-document-inspector.mjs";
import { PostgresDocumentProcessingWorker } from "../workers/document-processing/postgres-document-processing-worker.mjs";
import { WorkerScratchSpace } from "../workers/document-processing/worker-scratch-space.mjs";

const CAPABILITY = { provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "adapter/v1" };
const REPAIR_CAPABILITY = { provider: "google", model: "gemini-3.7-flash", adapterVersion: "repair/v1" };

// Provider-terminal failover evidence: pages the primary provider rejects
// outright must route to the repair capability, not straight to review.
test("PostgreSQL worker routes terminal provider failures to the repair capability", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-pg-worker-failover-"));
  const payload = Buffer.from("%PDF-1.4 source document");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const repository = fakeWorkRepository(claim({ sha256, sourceBytes: payload.length }));
  const worker = new PostgresDocumentProcessingWorker({
    workRepository: repository,
    objectStore: { openBlobStream: async () => ({ contentLength: payload.length, body: payload }) },
    scratchSpace: new WorkerScratchSpace({
      root, maximumTaskBytes: 1024, minimumFreeBytes: 0,
      statfsImpl: async () => ({ bavail: 1_000_000, bsize: 1 }),
    }),
    pageMaterializer: {
      async materializePage({ sourceFilePath, allocation, pageNumber }) {
        const target = allocation.pathFor(`page-${pageNumber}.pdf`);
        await copyFile(sourceFilePath, target);
        return { filePath: target, bytes: payload.length, pageNumber };
      },
    },
    providers: [{
      capability: CAPABILITY,
      async extractPage() {
        throw Object.assign(new Error("document parser rejected the page"), {
          code: "provider.http_400", retryable: false, billingKnown: true, billedCostUsd: 0, usage: { inputUnits: 0, outputUnits: 0 },
        });
      },
    }],
    validator: createPageValidator(),
    repairRouter: createSelectiveRepairRouter({ repairProvider: REPAIR_CAPABILITY }),
  });
  try {
    await worker.runOnce({ tenantId: "tenant-1", workerId: "worker-1" });
    assert.equal(repository.failures.length, 1);
    assert.deepEqual(repository.failures[0].repair?.capability, REPAIR_CAPABILITY);
    assert.match(repository.failures[0].repair.fingerprint, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// V4-WORK-001 PostgreSQL worker evidence
test("PostgreSQL worker streams verified source through bounded scratch and checkpoints accepted provider work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-pg-worker-"));
  const payload = Buffer.from("%PDF-1.4 source document");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const repository = fakeWorkRepository(claim({ sha256, sourceBytes: payload.length }));
  const scratch = new WorkerScratchSpace({
    root,
    maximumTaskBytes: 1024,
    minimumFreeBytes: 0,
    statfsImpl: async () => ({ bavail: 1_000_000, bsize: 1 }),
  });
  let providerBytes;
  const published = [];
  const capacityRecords = [];
  let clockTick = 0;
  const worker = new PostgresDocumentProcessingWorker({
    workRepository: repository,
    resultRepository: {
      async publishReadyIntake(input) {
        published.push(input);
        return { published: true, result: { resultId: "result-1" } };
      },
    },
    objectStore: { openBlobStream: async () => ({ contentLength: payload.length, body: payload }) },
    scratchSpace: scratch,
    pageMaterializer: {
      async materializePage({ sourceFilePath, allocation, pageNumber }) {
        const target = allocation.pathFor(`page-${pageNumber}.pdf`);
        await copyFile(sourceFilePath, target);
        return { filePath: target, bytes: payload.length, pageNumber };
      },
    },
    providers: [{
      capability: CAPABILITY,
      async extractPage({ pageNumber, source }) {
        providerBytes = await source.readBytes();
        return {
          pageNumber,
          text: "Accepted Section 42 legal page.",
          finishReason: "complete",
          requestId: "provider-request",
          usage: { inputUnits: 1, outputUnits: 4 },
          billedCostUsd: 0.004,
          diagnostics: [],
        };
      },
    }],
    validator: createPageValidator(),
    capacityCalibration: { async recordProvider(input) { capacityRecords.push(input); } },
    clock: () => new Date(Date.parse("2026-08-24T12:00:00.000Z") + (clockTick += 10)),
  });
  try {
    const outcome = await worker.runOnce({ tenantId: "tenant-1", workerId: "worker-1" });
    assert.equal(outcome.status, "accepted");
    assert.deepEqual(repository.claimInputs[0].capabilities, [CAPABILITY], "worker must claim only pages routed to its own provider capabilities");
    assert.equal(providerBytes.toString(), payload.toString());
    assert.equal(repository.successes.length, 1);
    assert.equal(repository.successes[0].providerResult.billedCostUsd, 0.004);
    assert.deepEqual(capacityRecords.map((record) => ({ pageOperations: record.pageOperations, outcome: record.outcome })), [{ pageOperations: 1, outcome: "success" }]);
    assert.deepEqual(published, [{ tenantId: "tenant-1", intakeId: "intake-1" }]);
    assert.deepEqual(outcome.publications, [{ intakeId: "intake-1", published: true, resultId: "result-1" }]);
    assert.deepEqual(await readdir(root), [], "worker task scratch must be gone before checkpoint returns");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PostgreSQL worker records pre-provider materialization failures as measured zero-cost terminal evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-pg-worker-failure-"));
  const payload = Buffer.from("%PDF-1.4 source document");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const repository = fakeWorkRepository(claim({ sha256, sourceBytes: payload.length }));
  const worker = new PostgresDocumentProcessingWorker({
    workRepository: repository,
    objectStore: { openBlobStream: async () => ({ contentLength: payload.length, body: payload }) },
    scratchSpace: new WorkerScratchSpace({
      root, maximumTaskBytes: 1024, minimumFreeBytes: 0,
      statfsImpl: async () => ({ bavail: 1_000_000, bsize: 1 }),
    }),
    pageMaterializer: {
      async materializePage() {
        const error = new Error("pdfseparate rejected page");
        error.code = "worker.page_materialization_failed";
        throw error;
      },
    },
    providers: [{ capability: CAPABILITY, extractPage: async () => { throw new Error("must not run"); } }],
    validator: createPageValidator(),
  });
  try {
    const outcome = await worker.runOnce({ tenantId: "tenant-1", workerId: "worker-1" });
    assert.equal(outcome.status, "review_required");
    assert.equal(repository.failures.length, 1);
    const error = repository.failures[0].error;
    assert.equal(error.code, "worker.page_materialization_failed");
    assert.equal(error.billingKnown, true);
    assert.equal(error.billedCostUsd, 0);
    assert.equal(error.retryable, false);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("streaming PDF info preflight counts pages without retaining source bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-pdfinfo-"));
  const payload = Buffer.from("%PDF source");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const scratch = new WorkerScratchSpace({
    root, maximumTaskBytes: 1024, minimumFreeBytes: 0,
    statfsImpl: async () => ({ bavail: 1_000_000, bsize: 1 }),
  });
  const inspector = new PdfInfoDocumentInspector({
    objectStore: { openBlobStream: async () => ({ contentLength: payload.length, body: payload }) },
    scratchSpace: scratch,
    execFileImpl: async () => ({ stdout: "Title: Legal bundle\nPages:          3\n", stderr: "" }),
  });
  try {
    const inspection = await inspector.inspect({ blobReference: { sha256 }, sourceBytes: payload.length });
    assert.equal(inspection.pageCount, 3);
    assert.deepEqual(inspection.pages.map((page) => page.pageNumber), [1, 2, 3]);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PDF page materializer invokes a bounded exact-page split and rejects oversized outputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-page-split-"));
  const source = path.join(root, "source.pdf");
  await writeFile(source, "%PDF source");
  const allocation = {
    pathFor(name) { return path.join(root, name); },
  };
  const calls = [];
  const materializer = new PdfPageMaterializer({
    maximumPageBytes: 100,
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      await writeFile(args.at(-1).replace("%d", args[1]), "%PDF split page");
    },
  });
  try {
    const page = await materializer.materializePage({ sourceFilePath: source, pageNumber: 7, allocation });
    assert.deepEqual(calls[0].args.slice(0, 4), ["-f", "7", "-l", "7"]);
    assert.equal(await readFile(page.filePath, "utf8"), "%PDF split page");
    const oversized = new PdfPageMaterializer({
      maximumPageBytes: 4,
      execFileImpl: async (_command, args) => writeFile(args.at(-1).replace("%d", args[1]), "oversized"),
    });
    await assert.rejects(() => oversized.materializePage({ sourceFilePath: source, pageNumber: 1, allocation }), { code: "worker.page_size_invalid" });

    const rangeCalls = [];
    const rangeMaterializer = new PdfPageMaterializer({
      execFileImpl: async (command, args) => {
        rangeCalls.push({ command, args });
        if (command === "pdfseparate") {
          for (let pageNumber = Number(args[1]); pageNumber <= Number(args[3]); pageNumber += 1) {
            await writeFile(args.at(-1).replace("%d", String(pageNumber)), `%PDF page ${pageNumber}`);
          }
        } else {
          await writeFile(args.at(-1), "%PDF joined range");
        }
      },
    });
    const range = await rangeMaterializer.materializePageRange({ sourceFilePath: source, firstPage: 3, lastPage: 5, allocation });
    assert.deepEqual({ firstPage: range.firstPage, lastPage: range.lastPage, pageCount: range.pageCount }, { firstPage: 3, lastPage: 5, pageCount: 3 });
    assert.equal(rangeCalls[1].command, "pdfunite");
    assert.equal(await readFile(range.filePath, "utf8"), "%PDF joined range");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function claim({ sha256, sourceBytes }) {
  return {
    tenantId: "tenant-1",
    validatorVersion: "page-validator/v1",
    workUnitId: "11111111-1111-4111-8111-111111111111",
    attemptId: "22222222-2222-4222-8222-222222222222",
    leaseToken: "33333333-3333-4333-8333-333333333333",
    fingerprint: "a".repeat(64),
    sourceSha256: sha256,
    sourceBytes,
    blobReference: { sha256, objectKey: `blobs/${sha256}` },
    pageNumber: 1,
    capability: CAPABILITY,
  };
}

function fakeWorkRepository(initialClaim) {
  let available = initialClaim;
  return {
    successes: [],
    failures: [],
    renewals: [],
    claimInputs: [],
    async claim(input) {
      this.claimInputs.push(input);
      const value = available;
      available = null;
      return value;
    },
    async renew(input) { this.renewals.push(input); return { renewed: true }; },
    async finishSuccess(input) { this.successes.push(input); return { status: input.validation.outcome, intakeIds: ["intake-1"] }; },
    async finishFailure(input) { this.failures.push(input); return { status: "review_required" }; },
  };
}

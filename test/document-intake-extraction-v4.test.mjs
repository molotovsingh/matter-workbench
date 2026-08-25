import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CONTRACT_VERSIONS } from "../packages/extraction-contracts/index.mjs";
import { FilesystemControlPlane } from "../services/document-intake-extraction/adapters/filesystem-control-plane.mjs";
import { FilesystemObjectStore } from "../services/document-intake-extraction/adapters/filesystem-object-store.mjs";
import { PdfjsDocumentInspector } from "../services/document-intake-extraction/adapters/pdfjs-document-inspector.mjs";
import { DocumentIntakeExtractionService } from "../services/document-intake-extraction/document-intake-extraction-service.mjs";
import { createPageValidator } from "../services/document-intake-extraction/page-validator.mjs";
import { createPinnedProviderAdapter, createStaticCapabilityRouter } from "../services/document-intake-extraction/providers/pinned-provider-adapter.mjs";
import { DocumentProcessingWorker } from "../workers/document-processing/document-processing-worker.mjs";

// V4-CUSTODY-001 V4-DEDUP-001 V4-WORK-001 V4-ASSEMBLY-001 V4-EVENT-001
test("the isolated V4 slice uses direct immutable custody, single-flight dedup, durable work, complete assembly, and post-commit publication", async () => {
  const fixture = await createFixture({
    providerImplementation: async ({ pageNumber, source }) => {
      const bytes = await source.readBytes();
      fixture.providerCalls.push({ pageNumber, bytes: bytes.length });
      return {
        pageNumber,
        text: "Agreement under Section 42 records Rs. 1,00,000 on 20/04/2026.",
        finishReason: "complete",
        requestId: "provider-request-1",
        usage: { inputUnits: 10, outputUnits: 20 },
        billedCostUsd: 0.012,
      };
    },
  });
  try {
    const pdf = makePdf("Hello legal PDF");
    const command = createCommand([
      { originalName: "agreement.pdf", relativePath: "Bundle/agreement.pdf", expectedBytes: pdf.length },
      { originalName: "agreement-copy.pdf", relativePath: "Copy/agreement-copy.pdf", expectedBytes: pdf.length },
    ]);
    const intake = await fixture.service.createIntake(command);
    const idempotent = await fixture.service.createIntake(command);
    assert.equal(idempotent.intakeId, intake.intakeId);
    assert.equal(idempotent.idempotent, true);

    const [first, second] = intake.files;
    await fixture.objectStore.putAuthorizedUpload({ token: first.uploadAuthorization.token, bytes: pdf });
    const firstReceipt = await fixture.service.commitFileCustody({
      intakeId: intake.intakeId,
      fileId: first.fileId,
      uploadToken: first.uploadAuthorization.token,
    });
    assert.equal(firstReceipt.sha256, sha256(pdf));
    assert.equal(firstReceipt.objectReused, false);
    assert.equal(firstReceipt.pageCount, 1);

    // Per-file work may finish while the rest of the batch is still uploading.
    assert.equal((await fixture.worker.runOnce({ workerId: "worker-a" })).status, "accepted");
    let evidence = await fixture.service.getEvidence({ intakeId: intake.intakeId });
    assert.equal(evidence.result, null);
    assert.equal(evidence.events.length, 0);

    await fixture.objectStore.putAuthorizedUpload({ token: second.uploadAuthorization.token, bytes: pdf });
    const secondReceipt = await fixture.service.commitFileCustody({
      intakeId: intake.intakeId,
      fileId: second.fileId,
      uploadToken: second.uploadAuthorization.token,
    });
    assert.equal(secondReceipt.objectReused, true);
    assert.equal(secondReceipt.duplicateComputationReused, true);
    assert.equal(secondReceipt.duplicateOfDocumentId, first.documentId);

    const committed = await fixture.service.commitBatchCustody({ intakeId: intake.intakeId });
    assert.equal(committed.status, "ready");
    evidence = await fixture.service.getEvidence({ intakeId: intake.intakeId });
    assert.equal(evidence.documents.length, 2);
    assert.equal(evidence.workUnits.length, 1);
    assert.equal(evidence.attempts.length, 1);
    assert.equal(evidence.costEvents.length, 1);
    assert.equal(evidence.events.length, 1);
    assert.equal(evidence.result.documents.length, 2);
    assert.deepEqual(evidence.result.documents.map((document) => document.pages.length), [1, 1]);
    assert.deepEqual(evidence.result.documents.flatMap((document) => document.pages.map((page) => page.outcome)), ["accepted", "accepted"]);
    assert.equal(evidence.events[0].type, "extraction.result.ready");
    assert.ok(new Date(evidence.events[0].occurredAt) >= new Date(committed.custodyCommittedAt));
    assert.equal(fixture.providerCalls.length, 1, "duplicate logical files must not consume a second provider call");

    // Reconstruct every service-side component from disk and prove completed work is not repeated.
    const restarted = await fixture.restart();
    assert.equal(await restarted.worker.runOnce({ workerId: "worker-after-restart" }), null);
    assert.equal(fixture.providerCalls.length, 1);
    const restartedIntake = await restarted.service.getIntake(intake.intakeId);
    assert.equal(restartedIntake.resultId, evidence.result.resultId);
  } finally {
    await fixture.cleanup();
  }
});

// V4-VALIDATE-001
test("V4-VALIDATE-001 publishes suspicious output only as an explicit review_required page", async () => {
  const fixture = await createFixture({
    providerImplementation: async ({ pageNumber }) => ({
      pageNumber,
      text: "",
      finishReason: "max_tokens",
      requestId: "truncated-request",
      usage: { inputUnits: 5, outputUnits: 0 },
      billedCostUsd: 0.004,
    }),
  });
  try {
    const pdf = makePdf("Review this page");
    const intake = await fixture.service.createIntake(createCommand([{ originalName: "review.pdf", expectedBytes: pdf.length }]));
    await uploadAndCommitAll(fixture, intake, [pdf]);
    await fixture.service.commitBatchCustody({ intakeId: intake.intakeId });
    await fixture.worker.drain({ workerId: "review-worker" });
    const evidence = await fixture.service.getEvidence({ intakeId: intake.intakeId });
    assert.equal(evidence.result.status, "ready_with_review");
    assert.equal(evidence.result.pageCount, 1);
    assert.equal(evidence.result.reviewPageCount, 1);
    assert.equal(evidence.result.documents[0].pages[0].outcome, "review_required");
    assert.deepEqual(evidence.result.documents[0].pages[0].reviewReasons.sort(), ["empty_or_too_short", "provider_output_incomplete"]);
  } finally {
    await fixture.cleanup();
  }
});

// V4-EVIDENCE-001
test("V4-EVIDENCE-001 attributes billed cost and usage for failed attempts and successful retries", async () => {
  let calls = 0;
  const fixture = await createFixture({
    providerImplementation: async ({ pageNumber }) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("provider returned 503 after accepting the request");
        error.code = "provider.http_503";
        error.billingKnown = true;
        error.billedCostUsd = 0.002;
        error.usage = { inputUnits: 4, outputUnits: 0 };
        throw error;
      }
      return {
        pageNumber,
        text: "Complete legal page after retry.",
        finishReason: "complete",
        requestId: "retry-success",
        usage: { inputUnits: 4, outputUnits: 6 },
        billedCostUsd: 0.006,
      };
    },
  });
  try {
    const pdf = makePdf("Retry evidence");
    const intake = await fixture.service.createIntake(createCommand([{ originalName: "retry.pdf", expectedBytes: pdf.length }]));
    await uploadAndCommitAll(fixture, intake, [pdf]);
    await fixture.service.commitBatchCustody({ intakeId: intake.intakeId });
    const runs = await fixture.worker.drain({ workerId: "retry-worker" });
    assert.equal(runs.length, 2);
    const evidence = await fixture.service.getEvidence({ intakeId: intake.intakeId });
    assert.deepEqual(evidence.attempts.map((attempt) => attempt.status), ["failed", "accepted"]);
    assert.deepEqual(evidence.costEvents.map((event) => event.billedCostUsd), [0.002, 0.006]);
    assert.ok(evidence.costEvents.every((event) => event.measurementStatus === "measured"));
    assert.equal(evidence.result.status, "ready");
  } finally {
    await fixture.cleanup();
  }
});

test("page work rejects a stale worker checkpoint after lease ownership moves", async () => {
  const fixture = await createFixture({
    leaseMs: 1_000,
    providerImplementation: async ({ pageNumber }) => ({
      pageNumber,
      text: "Lease fencing page.",
      finishReason: "complete",
      usage: {},
      billedCostUsd: 0,
    }),
  });
  try {
    const pdf = makePdf("Fence this work");
    const intake = await fixture.service.createIntake(createCommand([{ originalName: "fence.pdf", expectedBytes: pdf.length }]));
    await uploadAndCommitAll(fixture, intake, [pdf]);
    const staleClaim = await fixture.worker.claimNext({ workerId: "stale-worker" });
    fixture.advance(800);
    await fixture.worker.renewLease(staleClaim);
    fixture.advance(800);
    assert.equal(await fixture.worker.claimNext({ workerId: "too-early-worker" }), null, "heartbeat must keep the lease alive");
    fixture.advance(300);
    const replacement = await fixture.worker.claimNext({ workerId: "replacement-worker" });
    assert.equal(replacement.workUnitId, staleClaim.workUnitId);
    await assert.rejects(() => fixture.worker.finishSuccess(staleClaim, {
      pageNumber: 1,
      text: "Too late",
      finishReason: "complete",
      requestId: "stale",
      usage: { inputUnits: 0, outputUnits: 0 },
      billedCostUsd: 0,
    }, fixture.validator.validate({ text: "Too late", finishReason: "complete" })), { code: "worker.lease_lost" });
  } finally {
    await fixture.cleanup();
  }
});

async function createFixture({ providerImplementation, leaseMs = 60_000 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-slice-"));
  let currentMs = Date.UTC(2026, 7, 24, 12, 0, 0);
  let sequence = 0;
  const clock = () => new Date(currentMs);
  const idFactory = (kind) => `${kind}-${String(++sequence).padStart(4, "0")}`;
  const providerCalls = [];
  const provider = createPinnedProviderAdapter({
    provider: "mistral",
    model: "mistral-ocr-4-1",
    adapterVersion: "mistral-adapter/1.0.0",
    extractPage: providerImplementation,
  });
  const validator = createPageValidator();

  const build = async () => {
    const controlPlane = new FilesystemControlPlane({ root: path.join(root, "control"), clock });
    const objectStore = new FilesystemObjectStore({ root: path.join(root, "objects"), clock, idFactory });
    const inspector = new PdfjsDocumentInspector({ objectStore });
    const router = createStaticCapabilityRouter(provider, { version: "document-routing/2026-08-24.1" });
    const service = new DocumentIntakeExtractionService({
      controlPlane,
      objectStore,
      documentInspector: inspector,
      capabilityRouter: router,
      clock,
      idFactory,
    });
    const worker = new DocumentProcessingWorker({
      controlPlane,
      objectStore,
      providers: [provider],
      validator,
      clock,
      idFactory,
      leaseMs,
    });
    await service.initialize();
    return { controlPlane, objectStore, service, worker };
  };
  const components = await build();
  return {
    root,
    ...components,
    providerCalls,
    validator,
    advance(ms) { currentMs += ms; },
    restart: build,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function createCommand(files) {
  return {
    schemaVersion: CONTRACT_VERSIONS.createIntakeCommand,
    tenantId: "tenant-1",
    matterId: "matter-1",
    idempotencyKey: `request-${sha256(Buffer.from(files.map((file) => file.originalName).join("|"))).slice(0, 12)}`,
    files,
  };
}

async function uploadAndCommitAll(fixture, intake, payloads) {
  for (let index = 0; index < intake.files.length; index += 1) {
    const file = intake.files[index];
    await fixture.objectStore.putAuthorizedUpload({ token: file.uploadAuthorization.token, bytes: payloads[index] });
    await fixture.service.commitFileCustody({
      intakeId: intake.intakeId,
      fileId: file.fileId,
      uploadToken: file.uploadAuthorization.token,
    });
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function makePdf(text) {
  const safeText = String(text).replace(/[\\()]/g, (character) => `\\${character}`);
  const stream = `BT /F1 18 Tf 72 720 Td (${safeText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf);
}

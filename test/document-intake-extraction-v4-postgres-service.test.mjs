import assert from "node:assert/strict";
import test from "node:test";

import { PostgresDocumentIntakeExtractionService } from "../services/document-intake-extraction/postgres/postgres-document-intake-extraction-service.mjs";

// V4-API-001 PostgreSQL composition evidence
test("PostgreSQL service composes durable intake, direct custody, routed work, batch commit, and result publication behind the same API", async () => {
  const calls = { authorization: [], custody: [], inspected: [], publish: [], audit: [] };
  const intake = {
    intakeId: "11111111-1111-4111-8111-111111111111",
    tenantId: "tenant-1",
    matterId: "matter-1",
    idempotent: false,
    status: "awaiting_upload",
    files: [{
      fileId: "22222222-2222-4222-8222-222222222222",
      documentId: "33333333-3333-4333-8333-333333333333",
      originalName: "agreement.pdf",
      relativePath: "agreement.pdf",
      mimeType: "application/pdf",
      expectedBytes: 100,
      status: "awaiting_upload",
    }],
  };
  let published = false;
  const intakeRepository = {
    async createIntake() { return structuredClone(intake); },
    async readIntake() { return { ...structuredClone(intake), status: published ? "ready" : "processing", resultId: published ? "result-1" : "" }; },
    async recordInspectedDocument(input) { calls.inspected.push(input); return { documentId: intake.files[0].documentId }; },
    async commitBatchCustody() { return { ...structuredClone(intake), status: "processing" }; },
  };
  const resultRepository = {
    async publishReadyIntake(input) { calls.publish.push(input); return published ? { published: false, result: { resultId: "result-1" } } : null; },
    async readResult({ tenantId, resultId }) { return { tenantId, resultId, status: "ready" }; },
  };
  const objectStore = {
    async initialize() {},
    async createUploadAuthorization(input) {
      calls.authorization.push(input);
      return { token: "secret-upload-token", method: "PUT", url: "https://upload.invalid", requiredHeaders: {} };
    },
    async commitAuthorizedUpload(input) {
      calls.custody.push(input);
      return {
        sha256: "a".repeat(64), bytes: 100,
        blobReference: { sha256: "a".repeat(64), objectKey: `blobs/${"a".repeat(64)}` },
      };
    },
  };
  const service = new PostgresDocumentIntakeExtractionService({
    intakeRepository,
    resultRepository,
    objectStore,
    documentInspector: { inspect: async () => ({ pageCount: 2, inspectorVersion: "pdfinfo/v1" }) },
    capabilityRouter: {
      version: "route/v1",
      select: async () => ({ provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "adapter/v1" }),
    },
    progressService: {
      async getProgress(input) { return { schemaVersion: "document-intake-extraction.progress/v1", ...input, status: "processing" }; },
    },
    auditStore: { async append(input) { calls.audit.push(input); return input; } },
    clock: () => new Date("2026-08-24T12:00:00.000Z"),
  });

  const created = await service.createIntake({});
  assert.equal(created.files[0].uploadAuthorization.token, "secret-upload-token");
  assert.equal(calls.authorization[0].tenantId, "tenant-1");
  const receipt = await service.commitFileCustody({
    tenantId: "tenant-1",
    intakeId: intake.intakeId,
    fileId: intake.files[0].fileId,
    uploadToken: "secret-upload-token",
  });
  assert.equal(receipt.pageCount, 2);
  assert.equal(calls.custody[0].tenantId, "tenant-1");
  assert.equal(calls.inspected[0].pages.length, 2);
  assert.match(calls.inspected[0].pages[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(calls.inspected[0].pages[0].capability.model, "mistral-ocr-4-1");

  assert.equal((await service.commitBatchCustody({ tenantId: "tenant-1", intakeId: intake.intakeId })).status, "processing");
  assert.equal((await service.getProgress({ tenantId: "tenant-1", intakeId: intake.intakeId })).status, "processing");
  published = true;
  assert.equal((await service.commitBatchCustody({ tenantId: "tenant-1", intakeId: intake.intakeId })).status, "ready");
  assert.equal((await service.getResult({ tenantId: "tenant-1", resultId: "result-1" })).resultId, "result-1");
  assert.deepEqual(calls.audit.map((event) => event.eventType), ["intake.created", "custody.file_committed", "custody.batch_committed", "custody.batch_committed"]);
  assert.doesNotMatch(JSON.stringify(calls.audit), /agreement\.pdf|document text/i);
});

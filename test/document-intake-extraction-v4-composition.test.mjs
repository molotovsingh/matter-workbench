import assert from "node:assert/strict";
import test from "node:test";

import { PIPELINE_VERSIONS } from "../packages/extraction-contracts/index.mjs";
import { createDocumentIntakeExtractionV4Composition } from "../services/document-intake-extraction/composition/create-v4-composition.mjs";
import { PostgresDocumentIntakeExtractionService } from "../services/document-intake-extraction/postgres/postgres-document-intake-extraction-service.mjs";
import { PostgresDocumentProcessingWorker } from "../workers/document-processing/postgres-document-processing-worker.mjs";
import { PostgresDocumentRangeWorker } from "../workers/document-processing/postgres-document-range-worker.mjs";

// V4-ISO-001 independently instantiable, still-unmounted composition evidence
test("isolated composition joins PostgreSQL, direct custody, primary ranges, selective repair, progress, HTTP, and outbox boundaries", () => {
  let authorizationStore;
  const objectStore = {
    createUploadAuthorization: async () => {},
    commitAuthorizedUpload: async () => {},
    openBlobStream: async () => {},
    checkHealth: async () => ({ available: true }),
  };
  const primaryProvider = {
    capability: { provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "range/v1" },
    extractPages: async () => [],
  };
  const repairProvider = {
    capability: { provider: "google", model: "gemini-3.7-flash", adapterVersion: "repair/v1" },
    extractPage: async () => ({}),
  };
  const composition = createDocumentIntakeExtractionV4Composition({
    pool: { connect: async () => { throw new Error("not called during composition"); } },
    objectStoreFactory(input) { authorizationStore = input.authorizationStore; return objectStore; },
    documentInspectorFactory: ({ objectStore: received }) => ({ inspect: async () => ({ pageCount: 1 }), received }),
    primaryProvider,
    repairProvider,
    providerStages: [{
      stage: "primary_ocr", ...primaryProvider.capability,
      quotaPageOperationsPerSecond: 225, fallback: { pageOperationsPerSecond: 1 },
    }],
    workerCapacity: { activeWorkers: 1, warmWorkers: 1, maximumWorkers: 2, pageOperationsPerSecondPerWorker: 1 },
  });
  assert.ok(composition.service instanceof PostgresDocumentIntakeExtractionService);
  assert.ok(authorizationStore?.create);
  assert.equal(composition.objectStore, objectStore);
  assert.deepEqual(composition.capabilityRouter.select(), primaryProvider.capability);
  assert.deepEqual(composition.repairRouter.capability, repairProvider.capability);

  const scratchSpace = { withTaskScratch: async () => {}, materializeBlob: async () => {} };
  const rangeWorker = composition.createRangeWorker({
    scratchSpace,
    pageMaterializer: { materializePageRange: async () => {} },
  });
  const repairWorker = composition.createRepairWorker({
    scratchSpace,
    pageMaterializer: { materializePage: async () => {} },
  });
  assert.ok(rangeWorker instanceof PostgresDocumentRangeWorker);
  assert.ok(repairWorker instanceof PostgresDocumentProcessingWorker);
  const httpOptions = {
    authenticate: async () => ({ tenantId: "tenant-1" }),
    authorizeMatter: async () => true,
  };
  assert.equal(typeof composition.createHttpHandler(httpOptions), "function");
  assert.equal(typeof composition.createReadinessCheck({ providerCertification: { certified: true } }), "function");
  assert.ok(composition.createHttpServer({ ...httpOptions, readinessCheck: async () => ({ ready: true }) }));
  assert.ok(composition.createWorkerLoop({ worker: repairWorker, tenantId: "tenant-1", concurrency: 1 }));
  assert.ok(composition.createCapacityManager({ provisioner: { setDesiredCapacity: async () => ({ observedWorkers: 1 }) } }));
  assert.ok(composition.createOutboxDispatcher({ deliver: async () => {} }));
});

test("composition fails before runtime on non-streaming custody or mutable provider models", () => {
  const base = {
    pool: { connect: async () => {} },
    documentInspectorFactory: () => ({ inspect: async () => ({}) }),
    primaryProvider: {
      capability: { provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "range/v1" },
      extractPages: async () => [],
    },
    repairProvider: {
      capability: { provider: "google", model: "gemini-3.7-flash", adapterVersion: "repair/v1" },
      extractPage: async () => ({}),
    },
  };
  assert.throws(() => createDocumentIntakeExtractionV4Composition({
    ...base,
    objectStoreFactory: () => ({ createUploadAuthorization: async () => {}, commitAuthorizedUpload: async () => {} }),
  }), /streaming methods/);
  assert.throws(() => createDocumentIntakeExtractionV4Composition({
    ...base,
    repairProvider: {
      capability: { provider: "google", model: "gemini-latest", adapterVersion: "repair/v1" },
      extractPage: async () => ({}),
    },
    objectStoreFactory: () => ({
      createUploadAuthorization: async () => {}, commitAuthorizedUpload: async () => {}, openBlobStream: async () => {},
    }),
  }), /mutable alias/);
});

test("composition routes trusted native-text pages to the free local lane and everything else to the primary", () => {
  const nativeProvider = {
    capability: { provider: "native", model: "poppler-pdftotext", adapterVersion: "native/v1" },
    extractPage: async () => ({}),
  };
  const composition = createDocumentIntakeExtractionV4Composition({
    pool: { connect: async () => {} },
    objectStoreFactory: () => ({ createUploadAuthorization: async () => {}, commitAuthorizedUpload: async () => {}, openBlobStream: async () => {} }),
    documentInspectorFactory: () => ({ inspect: async () => ({ pageCount: 1 }) }),
    primaryProvider: { capability: { provider: "gemini", model: "gemini-3.7-flash", adapterVersion: "range/v1" }, extractPages: async () => [] },
    repairProvider: { capability: { provider: "google", model: "gemini-3.7-flash", adapterVersion: "repair/v1" }, extractPage: async () => ({}) },
    nativeProvider,
  });
  assert.deepEqual(composition.capabilityRouter.select({ page: { nativeText: { trusted: true } } }), nativeProvider.capability);
  assert.equal(composition.capabilityRouter.select({ page: { nativeText: { trusted: false } } }).provider, "gemini");
  assert.equal(composition.capabilityRouter.select({}).provider, "gemini", "unknown classification must fall to OCR");

  // The policy version is stamped into every page fingerprint, so it must not
  // vary with deployment configuration — otherwise toggling the native lane
  // fragments the dedup space and re-bills already-extracted corpora.
  const withoutNative = createDocumentIntakeExtractionV4Composition({
    pool: { connect: async () => {} },
    objectStoreFactory: () => ({ createUploadAuthorization: async () => {}, commitAuthorizedUpload: async () => {}, openBlobStream: async () => {} }),
    documentInspectorFactory: () => ({ inspect: async () => ({ pageCount: 1 }) }),
    primaryProvider: { capability: { provider: "gemini", model: "gemini-3.7-flash", adapterVersion: "range/v1" }, extractPages: async () => [] },
    repairProvider: { capability: { provider: "google", model: "gemini-3.7-flash", adapterVersion: "repair/v1" }, extractPage: async () => ({}) },
  });
  assert.equal(composition.capabilityRouter.version, PIPELINE_VERSIONS.routingPolicy);
  assert.equal(withoutNative.capabilityRouter.version, composition.capabilityRouter.version, "the routing policy version must not depend on the native lane being configured");
});

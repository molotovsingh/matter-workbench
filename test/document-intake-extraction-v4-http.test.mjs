import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CONTRACT_VERSIONS } from "../packages/extraction-contracts/index.mjs";
import { FilesystemControlPlane } from "../services/document-intake-extraction/adapters/filesystem-control-plane.mjs";
import { FilesystemObjectStore } from "../services/document-intake-extraction/adapters/filesystem-object-store.mjs";
import { DocumentIntakeExtractionService } from "../services/document-intake-extraction/document-intake-extraction-service.mjs";
import { createDocumentIntakeExtractionHttpHandler } from "../services/document-intake-extraction/http/document-intake-extraction-http.mjs";
import { createPageValidator } from "../services/document-intake-extraction/page-validator.mjs";
import { createPinnedProviderAdapter, createStaticCapabilityRouter } from "../services/document-intake-extraction/providers/pinned-provider-adapter.mjs";
import { DocumentProcessingWorker } from "../workers/document-processing/document-processing-worker.mjs";

// V4-API-001
test("V4-API-001 exposes an authenticated versioned API without proxying upload bytes or crossing tenant boundaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-http-"));
  let sequence = 0;
  const idFactory = (kind) => `${kind}-${++sequence}`;
  const clock = () => new Date("2026-08-24T12:00:00.000Z");
  const controlPlane = new FilesystemControlPlane({ root: path.join(root, "control"), clock });
  const objectStore = new FilesystemObjectStore({ root: path.join(root, "objects"), clock, idFactory });
  const provider = createPinnedProviderAdapter({
    provider: "mistral",
    model: "mistral-ocr-4-1",
    adapterVersion: "mistral-adapter/1.0.0",
    extractPage: async ({ pageNumber }) => ({
      pageNumber,
      text: "Versioned extraction result.",
      finishReason: "complete",
      requestId: "http-test-request",
      usage: { inputUnits: 2, outputUnits: 3 },
      billedCostUsd: 0.001,
    }),
  });
  const service = new DocumentIntakeExtractionService({
    controlPlane,
    objectStore,
    documentInspector: { inspect: async () => ({ pageCount: 1, inspectorVersion: "test-inspector/v1" }) },
    capabilityRouter: createStaticCapabilityRouter(provider, { version: "document-routing/2026-08-24.1" }),
    clock,
    idFactory,
  });
  const worker = new DocumentProcessingWorker({
    controlPlane,
    objectStore,
    providers: [provider],
    validator: createPageValidator(),
    clock,
    idFactory,
  });
  await service.initialize();
  const handler = createDocumentIntakeExtractionHttpHandler({
    service,
    authenticate: async (request) => {
      const match = String(request.headers.authorization || "").match(/^Bearer tenant-(\d)$/);
      return match ? { subject: `user-${match[1]}`, tenantId: `tenant-${match[1]}` } : null;
    },
    authorizeMatter: ({ matterId }) => matterId === "matter-1",
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const noIdempotency = await api(baseUrl, "/v1/intakes", { method: "POST", token: "tenant-1", body: { matterId: "matter-1", files: [] } });
    assert.equal(noIdempotency.response.status, 400);
    assert.equal(noIdempotency.body.error.code, "api.idempotency_key_required");

    const payload = Buffer.from("direct object storage payload");
    const created = await api(baseUrl, "/v1/intakes", {
      method: "POST",
      token: "tenant-1",
      headers: { "Idempotency-Key": "http-intake-1" },
      body: { matterId: "matter-1", files: [{ originalName: "api.pdf", expectedBytes: payload.length }] },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.schemaVersion, CONTRACT_VERSIONS.apiResponse);
    const intake = created.body.intake;
    const file = intake.files[0];
    assert.ok(file.uploadAuthorization.token);

    const rejectedProxy = await api(baseUrl, `/v1/intakes/${intake.intakeId}/files/${file.fileId}`, {
      method: "PUT",
      token: "tenant-1",
      rawBody: payload,
    });
    assert.equal(rejectedProxy.response.status, 404, "the service API must not accept document-byte uploads");

    await objectStore.putAuthorizedUpload({ token: file.uploadAuthorization.token, bytes: payload });
    const fileCommit = await api(baseUrl, `/v1/intakes/${intake.intakeId}/files/${file.fileId}/custody-commit`, {
      method: "POST",
      token: "tenant-1",
      body: { uploadToken: file.uploadAuthorization.token },
    });
    assert.equal(fileCommit.response.status, 200);
    assert.equal(fileCommit.body.receipt.bytes, payload.length);

    const batchCommit = await api(baseUrl, `/v1/intakes/${intake.intakeId}/custody-commit`, { method: "POST", token: "tenant-1", body: {} });
    assert.equal(batchCommit.response.status, 200);
    assert.equal(batchCommit.body.intake.status, "processing");
    assert.equal("uploadAuthorization" in batchCommit.body.intake.files[0], false, "read-side intake responses must not retain upload credentials");

    await worker.drain({ workerId: "http-worker" });
    const readIntake = await api(baseUrl, `/v1/intakes/${intake.intakeId}`, { token: "tenant-1" });
    assert.equal(readIntake.body.intake.status, "ready");
    const result = await api(baseUrl, `/v1/results/${readIntake.body.intake.resultId}`, { token: "tenant-1" });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.result.documents[0].pages[0].text, "Versioned extraction result.");

    const otherTenant = await api(baseUrl, `/v1/results/${readIntake.body.intake.resultId}`, { token: "tenant-2" });
    assert.equal(otherTenant.response.status, 404);
    assert.equal(otherTenant.body.error.code, "api.not_found");
    assert.equal(otherTenant.response.headers.get("cache-control"), "no-store");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

// An upload token is a bearer secret, not an identifier: the store mints
// base64url tokens, and ~1 in 32 begins with "-" or "_", which the identifier
// rule rejects. The commit route must accept those under the token's own
// contract and still refuse tokens outside the base64url alphabet.
test("custody commit accepts leading URL-safe base64url tokens and rejects foreign charsets", async () => {
  const passedTokens = [];
  const service = {
    createIntake: async () => ({}),
    commitBatchCustody: async () => ({}),
    getIntake: async () => ({ intakeId: "intake-1", tenantId: "tenant-1", matterId: "matter-1" }),
    commitFileCustody: async ({ uploadToken }) => {
      passedTokens.push(uploadToken);
      return { sha256: "a".repeat(64), bytes: 1 };
    },
  };
  const handler = createDocumentIntakeExtractionHttpHandler({
    service,
    authenticate: async () => ({ subject: "user-1", tenantId: "tenant-1" }),
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const token of [`-${"a".repeat(42)}`, `_${"b".repeat(42)}`]) {
      const commit = await api(baseUrl, "/v1/intakes/intake-1/files/file-1/custody-commit", {
        method: "POST",
        body: { uploadToken: token },
      });
      assert.equal(commit.response.status, 200, `token ${token.slice(0, 2)}… must be accepted`);
    }
    assert.deepEqual(passedTokens, [`-${"a".repeat(42)}`, `_${"b".repeat(42)}`], "tokens reach the service verbatim");
    const foreign = await api(baseUrl, "/v1/intakes/intake-1/files/file-1/custody-commit", {
      method: "POST",
      body: { uploadToken: `bad!token${"a".repeat(40)}` },
    });
    assert.equal(foreign.response.status, 400);
    assert.equal(foreign.body.error.code, "api.upload_token_invalid");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function api(baseUrl, pathname, { method = "GET", token = "", headers = {}, body, rawBody } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  let payload = rawBody;
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${pathname}`, { method, headers: requestHeaders, body: payload });
  return { response, body: JSON.parse(await response.text()) };
}

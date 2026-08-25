import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_VERSIONS,
  PIPELINE_VERSIONS,
  SERVICE_LIMITS,
  assertExtractionResultContract,
  assertPinnedProviderCapability,
  assertReadyEventContract,
  createPipelineFingerprint,
  validateCreateIntakeCommand,
} from "../packages/extraction-contracts/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "a".repeat(64);

// V4-CONTRACT-001
test("V4-CONTRACT-001 validates the versioned intake, result, and ready-event contracts", () => {
  const command = validateCreateIntakeCommand({
    schemaVersion: CONTRACT_VERSIONS.createIntakeCommand,
    tenantId: "tenant-1",
    matterId: "matter-1",
    idempotencyKey: "request-1",
    files: [{ originalName: "agreement.pdf", relativePath: "Bundle/agreement.pdf", expectedBytes: 12 }],
  });
  assert.equal(command.expectedBytes, 12);
  assert.equal(command.files[0].mimeType, "application/pdf");
  assert.throws(() => validateCreateIntakeCommand({
    ...command,
    files: Array.from({ length: SERVICE_LIMITS.maximumFiles + 1 }, (_, index) => ({ originalName: `${index}.pdf`, expectedBytes: 1 })),
  }), { code: "contract.file_limit_exceeded" });

  const result = {
    schemaVersion: CONTRACT_VERSIONS.extractionResult,
    resultId: "result-1",
    intakeId: "intake-1",
    version: 1,
    documents: [{
      documentId: "document-1",
      sourceSha256: SHA,
      pageCount: 1,
      pages: [{ pageNumber: 1, outcome: "accepted", provenance: { fingerprint: SHA } }],
    }],
  };
  assert.equal(assertExtractionResultContract(result).version, 1);
  assert.throws(() => assertExtractionResultContract({
    ...result,
    documents: [{ ...result.documents[0], pageCount: 2 }],
  }), { code: "contract.incomplete_page_outcomes" });

  assert.equal(assertReadyEventContract({
    schemaVersion: CONTRACT_VERSIONS.event,
    type: "extraction.result.ready",
    eventId: "event-1",
    tenantId: "tenant-1",
    matterId: "matter-1",
    intakeId: "intake-1",
    resultId: "result-1",
    occurredAt: new Date(0).toISOString(),
  }).type, "extraction.result.ready");
});

// V4-PROVIDER-001
test("V4-PROVIDER-001 rejects mutable models and fingerprints every pinned provider-policy version", () => {
  assert.throws(() => assertPinnedProviderCapability({
    provider: "mistral",
    model: "mistral-ocr-latest",
    adapterVersion: "adapter/v1",
  }), { code: "contract.mutable_model_alias" });
  const first = createPipelineFingerprint({
    sourceSha256: SHA,
    pageNumber: 1,
    dedupScope: "tenant-1",
    provider: "mistral",
    model: "mistral-ocr-4-1",
    adapterVersion: "mistral-adapter/1.0.0",
    routingPolicy: PIPELINE_VERSIONS.routingPolicy,
    validator: PIPELINE_VERSIONS.validator,
  });
  const second = createPipelineFingerprint({
    sourceSha256: SHA,
    pageNumber: 1,
    dedupScope: "tenant-1",
    provider: "mistral",
    model: "mistral-ocr-4-1",
    adapterVersion: "mistral-adapter/1.0.1",
    routingPolicy: PIPELINE_VERSIONS.routingPolicy,
    validator: PIPELINE_VERSIONS.validator,
  });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test("the V4 acceptance matrix distinguishes executable claims from unresolved cutover blockers", async () => {
  const matrixPath = path.join(ROOT, "docs/acceptance/document-intake-extraction-v4.matrix.json");
  const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
  assert.equal(matrix.schemaVersion, "document-intake-extraction.acceptance-matrix/v1");
  const ids = new Set();
  for (const gate of matrix.gates) {
    assert.match(gate.id, /^V4-[A-Z]+-[0-9]{3}$/);
    assert.equal(ids.has(gate.id), false, `duplicate gate ${gate.id}`);
    ids.add(gate.id);
    if (gate.status === "automated") {
      assert.ok(gate.evidence?.length, `${gate.id} needs executable evidence`);
      const evidenceText = (await Promise.all(gate.evidence.map((entry) => readFile(path.join(ROOT, entry), "utf8")))).join("\n");
      assert.match(evidenceText, new RegExp(`\\b${gate.id}\\b`), `${gate.id} must be named by its evidence test`);
    } else {
      assert.equal(gate.status, "pending_evidence");
      assert.ok(gate.owner && gate.blocker, `${gate.id} needs an owner and blocker`);
    }
  }
  assert.ok(matrix.gates.some((gate) => gate.status === "automated"));
  assert.ok(matrix.gates.some((gate) => gate.status === "pending_evidence"));
});

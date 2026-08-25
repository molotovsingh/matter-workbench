import { createHash } from "node:crypto";

export const CONTRACT_VERSIONS = Object.freeze({
  createIntakeCommand: "document-intake-extraction.create-intake-command/v1",
  intake: "document-intake-extraction.intake/v1",
  uploadAuthorization: "document-intake-extraction.upload-authorization/v1",
  custodyReceipt: "document-intake-extraction.custody-receipt/v1",
  pageWorkUnit: "document-intake-extraction.page-work-unit/v1",
  providerResult: "document-intake-extraction.provider-result/v1",
  providerAttempt: "document-intake-extraction.provider-attempt/v1",
  extractionResult: "document-intake-extraction.extraction-result/v1",
  event: "document-intake-extraction.event/v1",
  costEvent: "document-intake-extraction.cost-event/v1",
});

export const SERVICE_LIMITS = Object.freeze({
  maximumFiles: 500,
  maximumPages: 10_000,
  maximumBytes: 2 * 1024 * 1024 * 1024,
  maximumFileBytes: 2 * 1024 * 1024 * 1024,
});

export const PIPELINE_VERSIONS = Object.freeze({
  routingPolicy: "document-routing/2026-08-24.1",
  validator: "legal-page-validator/2026-08-24.1",
  assembler: "document-assembler/2026-08-24.1",
});

const MUTABLE_MODEL_ALIAS = /(?:^|[-_.\/])(latest|current|auto)(?:$|[-_.\/])/i;
const SHA256 = /^[a-f0-9]{64}$/;

export function validateCreateIntakeCommand(input = {}) {
  assertSchemaVersion(input, CONTRACT_VERSIONS.createIntakeCommand);
  const tenantId = requiredText(input.tenantId, "tenantId", 200);
  const matterId = requiredText(input.matterId, "matterId", 200);
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 240);
  const files = Array.isArray(input.files) ? input.files.map(normalizeFileManifestEntry) : [];
  if (!files.length) throw contractError("files must contain at least one document", "contract.files_required");
  if (files.length > SERVICE_LIMITS.maximumFiles) {
    throw contractError(`files exceeds the ${SERVICE_LIMITS.maximumFiles}-file service envelope`, "contract.file_limit_exceeded");
  }
  const expectedBytes = files.reduce((sum, file) => sum + file.expectedBytes, 0);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > SERVICE_LIMITS.maximumBytes) {
    throw contractError(`intake exceeds the ${SERVICE_LIMITS.maximumBytes}-byte service envelope`, "contract.byte_limit_exceeded");
  }
  const clientRequestId = optionalText(input.clientRequestId, 200);
  return {
    schemaVersion: CONTRACT_VERSIONS.createIntakeCommand,
    tenantId,
    matterId,
    idempotencyKey,
    clientRequestId,
    files,
    expectedBytes,
  };
}

export function assertPinnedProviderCapability(capability = {}) {
  const provider = requiredText(capability.provider, "provider", 100);
  const model = requiredText(capability.model, "model", 160);
  const adapterVersion = requiredText(capability.adapterVersion, "adapterVersion", 160);
  if (MUTABLE_MODEL_ALIAS.test(model)) {
    throw contractError(`provider model must be pinned, received mutable alias: ${model}`, "contract.mutable_model_alias");
  }
  return Object.freeze({ provider, model, adapterVersion });
}

export function normalizeProviderResult(input = {}, expected = {}) {
  assertSchemaVersion(input, CONTRACT_VERSIONS.providerResult);
  const pageNumber = positiveInteger(input.pageNumber, "pageNumber");
  if (expected.pageNumber && pageNumber !== expected.pageNumber) {
    throw contractError(`provider returned page ${pageNumber} for page ${expected.pageNumber}`, "contract.provider_page_mismatch");
  }
  const text = typeof input.text === "string" ? input.text : "";
  const finishReason = optionalText(input.finishReason, 120) || "complete";
  const requestId = optionalText(input.requestId, 240);
  const inputUnits = nonNegativeNumber(input.usage?.inputUnits, "usage.inputUnits", 0);
  const outputUnits = nonNegativeNumber(input.usage?.outputUnits, "usage.outputUnits", 0);
  const billedCostUsd = nonNegativeNumber(input.billedCostUsd, "billedCostUsd", 0);
  return {
    schemaVersion: CONTRACT_VERSIONS.providerResult,
    pageNumber,
    text,
    finishReason,
    requestId,
    usage: { inputUnits, outputUnits },
    billedCostUsd,
    diagnostics: normalizeStringArray(input.diagnostics, 50, 300),
  };
}

export function createPipelineFingerprint({ sourceSha256, pageNumber, dedupScope, provider, model, adapterVersion, routingPolicy, validator }) {
  assertSha256(sourceSha256, "sourceSha256");
  positiveInteger(pageNumber, "pageNumber");
  const capability = assertPinnedProviderCapability({ provider, model, adapterVersion });
  const payload = {
    sourceSha256,
    pageNumber,
    dedupScope: requiredText(dedupScope, "dedupScope", 200),
    provider: capability.provider,
    model: capability.model,
    adapterVersion: capability.adapterVersion,
    routingPolicy: requiredText(routingPolicy, "routingPolicy", 160),
    validator: requiredText(validator, "validator", 160),
  };
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function assertExtractionResultContract(result = {}) {
  assertSchemaVersion(result, CONTRACT_VERSIONS.extractionResult);
  requiredText(result.resultId, "resultId", 200);
  requiredText(result.intakeId, "intakeId", 200);
  const version = positiveInteger(result.version, "version");
  if (!Array.isArray(result.documents) || !result.documents.length) {
    throw contractError("extraction result must contain documents", "contract.documents_required");
  }
  for (const document of result.documents) {
    requiredText(document.documentId, "document.documentId", 200);
    assertSha256(document.sourceSha256, "document.sourceSha256");
    if (!Array.isArray(document.pages) || document.pages.length !== document.pageCount) {
      throw contractError("every document page must have an explicit outcome", "contract.incomplete_page_outcomes");
    }
    const seen = new Set();
    for (const page of document.pages) {
      const pageNumber = positiveInteger(page.pageNumber, "document.page.pageNumber");
      if (seen.has(pageNumber)) throw contractError("duplicate page outcome", "contract.duplicate_page_outcome");
      seen.add(pageNumber);
      if (!["accepted", "review_required"].includes(page.outcome)) {
        throw contractError(`unsupported page outcome: ${page.outcome}`, "contract.page_outcome_invalid");
      }
      assertSha256(page.provenance?.fingerprint, "document.page.provenance.fingerprint");
    }
  }
  return { ...result, version };
}

export function assertReadyEventContract(event = {}) {
  assertSchemaVersion(event, CONTRACT_VERSIONS.event);
  if (event.type !== "extraction.result.ready") {
    throw contractError(`unsupported event type: ${event.type}`, "contract.event_type_invalid");
  }
  requiredText(event.eventId, "eventId", 200);
  requiredText(event.tenantId, "tenantId", 200);
  requiredText(event.matterId, "matterId", 200);
  requiredText(event.intakeId, "intakeId", 200);
  requiredText(event.resultId, "resultId", 200);
  requiredText(event.occurredAt, "occurredAt", 100);
  return event;
}

export function assertSha256(value, field = "sha256") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256.test(normalized)) throw contractError(`${field} must be a lowercase SHA-256 digest`, "contract.sha256_invalid");
  return normalized;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contractError(message, code = "contract.invalid") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeFileManifestEntry(file = {}, index) {
  const expectedBytes = positiveInteger(file.expectedBytes, `files[${index}].expectedBytes`);
  if (expectedBytes > SERVICE_LIMITS.maximumFileBytes) {
    throw contractError(`files[${index}] exceeds the per-file byte limit`, "contract.file_byte_limit_exceeded");
  }
  const originalName = requiredText(file.originalName, `files[${index}].originalName`, 500);
  const relativePath = optionalText(file.relativePath, 1000) || originalName;
  if (relativePath.startsWith("/") || relativePath.split(/[\\/]+/).includes("..")) {
    throw contractError(`files[${index}].relativePath must be relative and traversal-free`, "contract.relative_path_invalid");
  }
  return {
    clientFileId: optionalText(file.clientFileId, 200),
    originalName,
    relativePath: relativePath.replace(/\\/g, "/"),
    mimeType: optionalText(file.mimeType, 200) || "application/pdf",
    expectedBytes,
    lastModifiedMs: nonNegativeNumber(file.lastModifiedMs, `files[${index}].lastModifiedMs`, 0),
  };
}

function assertSchemaVersion(input, expected) {
  if (input?.schemaVersion !== expected) {
    throw contractError(`schemaVersion must be ${expected}`, "contract.schema_version_invalid");
  }
}

function requiredText(value, field, maxLength) {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!normalized) throw contractError(`${field} is required`, "contract.required");
  if (normalized.length > maxLength) throw contractError(`${field} exceeds ${maxLength} characters`, "contract.text_too_long");
  return normalized;
}

function optionalText(value, maxLength) {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (normalized.length > maxLength) throw contractError(`text exceeds ${maxLength} characters`, "contract.text_too_long");
  return normalized;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw contractError(`${field} must be a positive integer`, "contract.integer_invalid");
  return number;
}

function nonNegativeNumber(value, field, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw contractError(`${field} must be a non-negative number`, "contract.number_invalid");
  return number;
}

function normalizeStringArray(value, maximumItems, maximumLength) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximumItems).map((item) => optionalText(item, maximumLength)).filter(Boolean);
}

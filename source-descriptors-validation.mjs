import { sourceLabelContainsFileId } from "./shared/source-labels.mjs";

const DOCUMENT_TYPES = new Set([
  "email",
  "letter",
  "legal_notice",
  "court_order",
  "pleading",
  "application",
  "reply",
  "affidavit",
  "agreement",
  "invoice",
  "receipt",
  "bank_record",
  "government_record",
  "photo",
  "screenshot",
  "whatsapp_chat",
  "unknown",
]);

const DATE_BASES = new Set([
  "email_header",
  "document_heading",
  "signature_block",
  "court_order_date",
  "file_name",
  "body_text",
  "inferred",
  "unknown",
]);

const SOURCE_REQUIRED_FIELDS = [
  "file_id",
  "sha256",
  "source_path",
  "display_label",
  "short_label",
  "document_type",
  "document_date",
  "date_basis",
  "parties",
  "confidence",
  "needs_review",
  "evidence",
  "warnings",
];

const LABEL_STATUS = {
  SUGGESTED: "suggested",
  NEEDS_REVIEW: "needs_review",
};

const LABEL_SOURCE = {
  MODEL: "model",
};

const PARTY_REQUIRED_FIELDS = [
  "from",
  "to",
  "cc",
  "author",
  "court",
  "judge",
  "issuing_party",
  "recipient_party",
  "deponent",
  "signatory",
];

export const SOURCE_INDEX_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sources"],
  properties: {
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: SOURCE_REQUIRED_FIELDS,
        properties: {
          file_id: { type: "string", pattern: "^FILE-\\d{4,}$" },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          source_path: { type: "string" },
          display_label: { type: "string" },
          short_label: { type: "string" },
          document_type: { type: "string", enum: [...DOCUMENT_TYPES] },
          document_date: {
            anyOf: [
              { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              { type: "null" },
            ],
          },
          date_basis: { type: "string", enum: [...DATE_BASES] },
          parties: {
            type: "object",
            additionalProperties: false,
            required: PARTY_REQUIRED_FIELDS,
            properties: {
              from: { type: "string" },
              to: { type: "array", items: { type: "string" } },
              cc: { type: "array", items: { type: "string" } },
              author: { type: "string" },
              court: { type: "string" },
              judge: { type: "string" },
              issuing_party: { type: "string" },
              recipient_party: { type: "string" },
              deponent: { type: "string" },
              signatory: { type: "string" },
            },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needs_review: { type: "boolean" },
          evidence: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["citation", "reason"],
              properties: {
                citation: { type: "string", pattern: "^FILE-\\d{4,} p\\d+\\.b\\d+$" },
                reason: { type: "string" },
              },
            },
          },
          warnings: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export function validateAndSortDescriptors(providerResponse, sourcePackets) {
  if (!providerResponse || !Array.isArray(providerResponse.sources)) {
    const error = new Error("Source descriptor provider returned an invalid payload: expected sources[]");
    error.statusCode = 502;
    throw error;
  }
  if (providerResponse.sources.length !== sourcePackets.length) {
    const error = new Error(`Expected ${sourcePackets.length} source descriptors, got ${providerResponse.sources.length}`);
    error.statusCode = 502;
    throw error;
  }

  const packetByFileId = new Map(sourcePackets.map((packet) => [packet.file_id, packet]));
  const seen = new Set();
  const descriptors = [];
  for (const descriptor of providerResponse.sources) {
    validateDescriptorShape(descriptor);
    const packet = packetByFileId.get(descriptor.file_id);
    if (!packet) throwProviderError(`Unexpected source descriptor file_id: ${descriptor.file_id}`);
    if (seen.has(descriptor.file_id)) throwProviderError(`Duplicate source descriptor for ${descriptor.file_id}`);
    seen.add(descriptor.file_id);
    if (descriptor.sha256 !== packet.sha256) throwProviderError(`sha256 mismatch for ${descriptor.file_id}`);
    if (descriptor.source_path !== packet.source_path) throwProviderError(`source_path mismatch for ${descriptor.file_id}`);
    validateDescriptorEvidence(descriptor, packet);
    descriptors.push(normalizeDescriptor(descriptor));
  }

  return descriptors.sort((a, b) => a.file_id.localeCompare(b.file_id));
}

function validateDescriptorShape(descriptor) {
  assertObject(descriptor, "source descriptor");
  for (const field of SOURCE_REQUIRED_FIELDS) {
    if (!(field in descriptor)) throwProviderError(`Missing required source field ${field}`);
  }
  assertNonEmptyString(descriptor.file_id, "file_id");
  if (!/^FILE-\d{4,}$/.test(descriptor.file_id)) throwProviderError(`Invalid file_id: ${descriptor.file_id}`);
  assertNonEmptyString(descriptor.sha256, `sha256 for ${descriptor.file_id}`);
  if (!/^[0-9a-f]{64}$/.test(descriptor.sha256)) throwProviderError(`Invalid sha256 for ${descriptor.file_id}`);
  assertNonEmptyString(descriptor.source_path, `source_path for ${descriptor.file_id}`);
  assertNonEmptyString(descriptor.display_label, `display_label for ${descriptor.file_id}`);
  assertNonEmptyString(descriptor.short_label, `short_label for ${descriptor.file_id}`);
  validateHumanLabel(descriptor.display_label, `display_label for ${descriptor.file_id}`);
  validateHumanLabel(descriptor.short_label, `short_label for ${descriptor.file_id}`);
  if (!DOCUMENT_TYPES.has(descriptor.document_type)) throwProviderError(`Invalid document_type for ${descriptor.file_id}`);
  if (descriptor.document_date !== null && !isValidIsoDate(descriptor.document_date)) {
    throwProviderError(`Invalid document_date for ${descriptor.file_id}`);
  }
  if (!DATE_BASES.has(descriptor.date_basis)) throwProviderError(`Invalid date_basis for ${descriptor.file_id}`);
  if (typeof descriptor.confidence !== "number" || !Number.isFinite(descriptor.confidence)
    || descriptor.confidence < 0 || descriptor.confidence > 1) {
    throwProviderError(`Invalid confidence for ${descriptor.file_id}`);
  }
  if (typeof descriptor.needs_review !== "boolean") throwProviderError(`Invalid needs_review for ${descriptor.file_id}`);
  validateParties(descriptor.parties, descriptor.file_id);
  validateWarnings(descriptor.warnings, descriptor.file_id);
}

function validateParties(parties, fileId) {
  assertObject(parties, `parties for ${fileId}`);
  const allowed = new Set(PARTY_REQUIRED_FIELDS);
  for (const field of PARTY_REQUIRED_FIELDS) {
    if (!(field in parties)) throwProviderError(`Missing parties.${field} for ${fileId}`);
  }
  for (const field of Object.keys(parties)) {
    if (!allowed.has(field)) throwProviderError(`Unexpected parties.${field} for ${fileId}`);
  }
  for (const field of PARTY_REQUIRED_FIELDS) {
    if (field === "to" || field === "cc") {
      if (!Array.isArray(parties[field]) || !parties[field].every((value) => typeof value === "string")) {
        throwProviderError(`parties.${field} must be an array of strings for ${fileId}`);
      }
    } else if (typeof parties[field] !== "string") {
      throwProviderError(`parties.${field} must be a string for ${fileId}`);
    } else if (/^(none|unknown|n\/a)$/i.test(parties[field].trim())) {
      throwProviderError(`parties.${field} should be empty instead of ${parties[field]} for ${fileId}`);
    }
  }
}

function validateWarnings(warnings, fileId) {
  if (!Array.isArray(warnings) || !warnings.every((warning) => typeof warning === "string")) {
    throwProviderError(`warnings must be an array of strings for ${fileId}`);
  }
}

function validateHumanLabel(label, fieldLabel) {
  if (sourceLabelContainsFileId(label)) {
    throwProviderError(`${fieldLabel} must not include FILE-NNNN identifiers`);
  }
}

function validateDescriptorEvidence(descriptor, packet) {
  if (!Array.isArray(descriptor.evidence) || !descriptor.evidence.length) {
    throwProviderError(`Missing evidence for ${descriptor.file_id}`);
  }
  const validCitations = new Set(packet.blocks.map((block) => block.citation));
  for (const evidence of descriptor.evidence) {
    assertObject(evidence, `evidence for ${descriptor.file_id}`);
    assertNonEmptyString(evidence.citation, `evidence.citation for ${descriptor.file_id}`);
    assertNonEmptyString(evidence.reason, `evidence.reason for ${descriptor.file_id}`);
    if (!/^FILE-\d{4,} p\d+\.b\d+$/.test(evidence.citation)) {
      throwProviderError(`Invalid evidence citation for ${descriptor.file_id}: ${evidence.citation}`);
    }
    if (!validCitations.has(evidence.citation)) {
      throwProviderError(`Evidence citation ${evidence.citation} does not belong to ${descriptor.file_id}`);
    }
  }
}

function normalizeDescriptor(descriptor) {
  const displayLabel = descriptor.display_label.trim();
  const shortLabel = descriptor.short_label.trim();
  const labelReason = descriptor.evidence
    .map((evidence) => evidence.reason)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    source_id: descriptor.file_id,
    content_hash: descriptor.sha256,
    file_id: descriptor.file_id,
    sha256: descriptor.sha256,
    source_path: descriptor.source_path,
    display_label: displayLabel,
    short_label: shortLabel,
    suggested_label: displayLabel,
    confirmed_label: "",
    label_status: descriptor.needs_review ? LABEL_STATUS.NEEDS_REVIEW : LABEL_STATUS.SUGGESTED,
    label_source: LABEL_SOURCE.MODEL,
    label_reason: labelReason,
    label_revision: 1,
    confirmed_by: "",
    confirmed_at: "",
    document_type: descriptor.document_type,
    document_date: descriptor.document_date,
    date_basis: descriptor.date_basis,
    parties: {
      from: descriptor.parties.from,
      to: [...descriptor.parties.to],
      cc: [...descriptor.parties.cc],
      author: descriptor.parties.author,
      court: descriptor.parties.court,
      judge: descriptor.parties.judge,
      issuing_party: descriptor.parties.issuing_party,
      recipient_party: descriptor.parties.recipient_party,
      deponent: descriptor.parties.deponent,
      signatory: descriptor.parties.signatory,
    },
    confidence: descriptor.confidence,
    needs_review: descriptor.needs_review,
    evidence: descriptor.evidence.map((evidence) => ({
      citation: evidence.citation,
      reason: evidence.reason.trim(),
    })),
    warnings: [...descriptor.warnings],
  };
}

function isValidIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throwProviderError(`${label} must be an object`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throwProviderError(`${label} must be a non-empty string`);
}

function throwProviderError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  throw error;
}

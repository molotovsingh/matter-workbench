import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const LEGAL_SOURCE_METADATA_KEYS = Object.freeze([
  "provider",
  "slug",
  "section",
  "requested_section",
  "act",
  "act_number",
  "heading",
  "corpus_fingerprint",
  "built_at",
  "last_refreshed",
  "published_at",
]);

const PROVENANCE_SOURCE_KEYS = Object.freeze(["name", "tier", "url", "retrieved_at"]);
const PROVENANCE_AUTHENTICITY_KEYS = Object.freeze(["status", "archive_url"]);

export function normalizeLegalSourceMetadata(metadata = {}, {
  textLimit = 500,
  corpusFingerprintLimit = 200,
  nestedLimit = 1000,
} = {}) {
  if (!isPlainObject(metadata)) return {};
  const normalized = {};
  for (const key of LEGAL_SOURCE_METADATA_KEYS) {
    const value = boundedMetadataText(metadata[key], key === "corpus_fingerprint" ? corpusFingerprintLimit : textLimit);
    if (value) normalized[key] = value;
  }
  const provenance = normalizeLegalSourceProvenance(metadata.provenance, { nestedLimit });
  if (Object.keys(provenance).length) normalized.provenance = provenance;
  return normalized;
}

export function extractCorpusFingerprintsFromSources(sources = []) {
  return [...new Set((Array.isArray(sources) ? sources : [])
    .map((source) => source?.metadata?.corpus_fingerprint)
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean))];
}

function normalizeLegalSourceProvenance(provenance = {}, { nestedLimit } = {}) {
  if (!isPlainObject(provenance)) return {};
  const normalized = {};
  const source = normalizePlainMetadataObject(provenance.source, PROVENANCE_SOURCE_KEYS, { nestedLimit });
  if (Object.keys(source).length) normalized.source = source;
  const authenticityAnchor = normalizePlainMetadataObject(provenance.authenticity_anchor, PROVENANCE_AUTHENTICITY_KEYS, { nestedLimit });
  if (Object.keys(authenticityAnchor).length) normalized.authenticity_anchor = authenticityAnchor;
  return normalized;
}

function normalizePlainMetadataObject(value = {}, keys = [], { nestedLimit } = {}) {
  if (!isPlainObject(value)) return {};
  const normalized = {};
  for (const key of keys) {
    const text = boundedMetadataText(value[key], nestedLimit);
    if (text) normalized[key] = text;
  }
  return normalized;
}

function boundedMetadataText(value = "", limit = 500) {
  return truncateText(redactSensitiveText(normalizeWhitespace(value)), limit);
}

function truncateText(value = "", limit = 500) {
  const text = normalizeWhitespace(value);
  const max = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 500;
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

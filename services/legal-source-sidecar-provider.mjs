import { makeHttpError } from "../shared/safe-paths.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

export const LEGAL_SOURCE_SEARCH_SCHEMA_VERSION = "legal-source-search-request/v1";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MAX_RESULT_CHARS = 9000;
const MAX_QUESTION_LENGTH = 1200;
const MAX_WARNING_LENGTH = 500;
const MAX_TITLE_LENGTH = 500;
const MAX_URL_LENGTH = 2000;
const VALID_LEGAL_SOURCE_ID = /^(?:WEB|STATUTE)-\d{4}$/;

export function createLegalSourceSidecarProvider({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResults = DEFAULT_MAX_RESULTS,
  maxResultChars = DEFAULT_MAX_RESULT_CHARS,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const bearerToken = String(token || "").trim();

  return async function legalSourceSidecarProvider({ question, query, queries, config } = {}) {
    if (!normalizedBaseUrl) {
      throw makeHttpError("Research is temporarily unavailable.", 409, "copilot_research.provider_not_configured");
    }
    const searchQuestion = normalizeQuestion(question || query || firstQuery(queries));
    if (!searchQuestion) {
      throw makeHttpError("Research question is required.", 400, "copilot_research.question_required");
    }
    const effectiveMaxResults = clampInteger(config?.maxResults ?? maxResults, 1, 12, DEFAULT_MAX_RESULTS);
    const effectiveMaxResultChars = clampInteger(config?.maxResultChars ?? maxResultChars, 500, 50_000, DEFAULT_MAX_RESULT_CHARS);
    const endpoint = `${normalizedBaseUrl}/v1/legal-sources/search`;
    const payload = await postLegalSourceSearch({
      endpoint,
      token: bearerToken,
      fetchImpl,
      timeoutMs: config?.timeoutMs ?? timeoutMs,
      body: {
        schema_version: LEGAL_SOURCE_SEARCH_SCHEMA_VERSION,
        question: searchQuestion,
        mode: "auto",
        limit: effectiveMaxResults,
      },
    });
    const normalized = normalizeLegalSourceResponse(payload, {
      fallbackQuery: searchQuestion,
      maxResults: effectiveMaxResults,
      maxResultChars: effectiveMaxResultChars,
    });
    return {
      query: normalized.query,
      sources: normalized.sources,
      warnings: normalized.warnings,
      raw: payload,
    };
  };
}

async function postLegalSourceSearch({ endpoint, token, fetchImpl, timeoutMs, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clampInteger(timeoutMs, 1, 120_000, DEFAULT_TIMEOUT_MS));
  let response;
  let payload;
  try {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    payload = await response.json().catch((error) => {
      if (controller.signal.aborted || error?.name === "AbortError") throw error;
      return null;
    });
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw makeHttpError("Public research took too long. Try again or use Ask.", 504, "copilot_research.provider_timeout");
    }
    throw makeHttpError("Research is temporarily unavailable.", 503, "copilot_research.provider_error");
  } finally {
    clearTimeout(timer);
  }

  if (!response?.ok) {
    throw mapSidecarHttpError(response, payload);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw makeHttpError("Research is temporarily unavailable.", 503, "copilot_research.provider_error");
  }
  return payload;
}

function mapSidecarHttpError(response, payload) {
  const status = Number(response?.status) || 503;
  const code = String(payload?.code || "").trim();
  if (status === 504 || code === "legal_source.provider_timeout") {
    return makeHttpError("Public research took too long. Try again or use Ask.", 504, "copilot_research.provider_timeout");
  }
  if (status === 401 || code === "legal_source.unauthorized" || code === "legal_source.provider_not_configured") {
    return makeHttpError("Research is temporarily unavailable.", 409, "copilot_research.provider_not_configured");
  }
  return makeHttpError(redactSensitiveText("Research is temporarily unavailable."), status >= 400 && status < 500 ? 502 : 503, "copilot_research.provider_error");
}

export function normalizeLegalSourceResponse(payload = {}, {
  fallbackQuery = "",
  maxResults = DEFAULT_MAX_RESULTS,
  maxResultChars = DEFAULT_MAX_RESULT_CHARS,
} = {}) {
  const warnings = normalizeWarnings(payload?.warnings);
  const sources = [];
  const seen = new Set();
  for (const source of Array.isArray(payload?.sources) ? payload.sources : []) {
    const normalized = normalizeLegalSource(source, { maxResultChars });
    if (!normalized.source) {
      if (normalized.warning) warnings.push(normalized.warning);
      continue;
    }
    if (seen.has(normalized.source.id)) continue;
    seen.add(normalized.source.id);
    sources.push(normalized.source);
    if (sources.length >= clampInteger(maxResults, 1, 12, DEFAULT_MAX_RESULTS)) break;
  }
  return {
    query: normalizeWhitespace(payload?.query || fallbackQuery),
    sources,
    warnings,
  };
}

function normalizeLegalSource(source = {}, { maxResultChars }) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { source: null, warning: "Dropped malformed legal source from sidecar." };
  }
  const id = String(source.id || "").trim().toUpperCase();
  if (!VALID_LEGAL_SOURCE_ID.test(id)) {
    return { source: null, warning: "Dropped legal source with malformed source ID." };
  }
  const metadata = normalizeLegalSourceMetadata(source.metadata);
  const normalizedSource = {
    id,
    title: truncateText(normalizeWhitespace(source.title || source.citation || "Untitled legal source"), MAX_TITLE_LENGTH),
    url: truncateText(normalizeWhitespace(source.url || ""), MAX_URL_LENGTH),
    publishedAt: normalizeWhitespace(source.published_at || source.publishedAt || ""),
    sourceType: normalizeSourceType(source.source_type || source.sourceType),
    snippet: truncateText(source.snippet || "", maxResultChars),
  };
  if (Object.keys(metadata).length) normalizedSource.metadata = metadata;
  return { source: normalizedSource };
}

function normalizeLegalSourceMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const normalized = {};
  for (const key of [
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
  ]) {
    const value = truncateText(redactSensitiveText(normalizeWhitespace(metadata[key] || "")), key === "corpus_fingerprint" ? 200 : 500);
    if (value) normalized[key] = value;
  }
  const provenance = normalizeProvenanceMetadata(metadata.provenance);
  if (Object.keys(provenance).length) normalized.provenance = provenance;
  return normalized;
}

function normalizeProvenanceMetadata(provenance = {}) {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return {};
  const normalized = {};
  const source = normalizePlainMetadataObject(provenance.source, ["name", "tier", "url", "retrieved_at"]);
  if (Object.keys(source).length) normalized.source = source;
  const authenticityAnchor = normalizePlainMetadataObject(provenance.authenticity_anchor, ["status", "archive_url"]);
  if (Object.keys(authenticityAnchor).length) normalized.authenticity_anchor = authenticityAnchor;
  return normalized;
}

function normalizePlainMetadataObject(value = {}, keys = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  for (const key of keys) {
    const text = truncateText(redactSensitiveText(normalizeWhitespace(value[key] || "")), 1000);
    if (text) normalized[key] = text;
  }
  return normalized;
}

function normalizeWarnings(values) {
  const warnings = [];
  for (const value of Array.isArray(values) ? values : []) {
    const warning = truncateText(redactSensitiveText(normalizeWhitespace(value)), MAX_WARNING_LENGTH);
    if (warning && !warnings.includes(warning)) warnings.push(warning);
  }
  return warnings;
}

function normalizeSourceType(value) {
  const sourceType = normalizeWhitespace(value).toLowerCase();
  return ["official_statute", "official", "court", "legal_report", "other"].includes(sourceType) ? sourceType : "other";
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) return "";
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname}`;
  } catch {
    return "";
  }
}

function firstQuery(queries) {
  return Array.isArray(queries) ? queries.find((query) => normalizeWhitespace(query)) : "";
}

function normalizeQuestion(value = "") {
  return normalizeWhitespace(value).slice(0, MAX_QUESTION_LENGTH);
}

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value = "", limit = DEFAULT_MAX_RESULT_CHARS) {
  const text = normalizeWhitespace(value);
  const max = clampInteger(limit, 1, 100_000, DEFAULT_MAX_RESULT_CHARS);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

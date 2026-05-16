export const MATTER_CONTEXT_SEARCH_SCHEMA_VERSION = "matter-context-search/v1";

const DEFAULT_SEARCH_LIMITS = {
  maxResults: 25,
  snippetChars: 220,
};

export function searchMatterContextPacket(packet, query, options = {}) {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    const error = new Error("Search query is required");
    error.statusCode = 400;
    throw error;
  }
  const terms = tokenizeSearchQuery(normalizedQuery);
  if (!terms.length) {
    const error = new Error("Search query must include at least one searchable term");
    error.statusCode = 400;
    throw error;
  }

  const evidenceBlocks = Array.isArray(packet?.evidence_blocks) ? packet.evidence_blocks : [];
  const sourceMap = new Map((Array.isArray(packet?.sources) ? packet.sources : [])
    .map((source) => [source.file_id, source]));
  const maxResults = parseLimit(options.maxResults, DEFAULT_SEARCH_LIMITS.maxResults);
  const snippetChars = parseLimit(options.snippetChars, DEFAULT_SEARCH_LIMITS.snippetChars);
  const allMatches = [];

  for (const block of evidenceBlocks) {
    const source = sourceMap.get(block.file_id) || {};
    const searchable = [
      block.text,
      block.citation,
      block.source_label,
      block.source_short_label,
      block.source_path,
      source.source_label,
      source.source_short_label,
      source.document_type,
      source.original_name,
    ].filter(Boolean).join(" ");
    const matchingTerms = terms.filter((term) => textIncludesTerm(searchable, term));
    if (matchingTerms.length !== terms.length) continue;
    allMatches.push({
      citation: block.citation || "",
      file_id: block.file_id || "",
      page: block.page ?? null,
      block_id: block.block_id || "",
      source_label: block.source_label || source.source_label || "",
      source_short_label: block.source_short_label || source.source_short_label || "",
      document_type: source.document_type || "",
      source_path: block.source_path || source.source_path || "",
      snippet: buildSearchSnippet(block.text || "", terms, snippetChars),
      match_terms: matchingTerms,
    });
  }

  const results = allMatches.slice(0, maxResults);
  return {
    schema_version: MATTER_CONTEXT_SEARCH_SCHEMA_VERSION,
    packet_schema_version: packet?.schema_version || "",
    generated_at: packet?.generated_at || "",
    searched_at: options.searchedAt || new Date().toISOString(),
    query: normalizedQuery,
    matter: packet?.matter || {},
    counts: {
      searched_blocks: evidenceBlocks.length,
      matches: results.length,
      omitted_matches: Math.max(0, allMatches.length - results.length),
      sources: new Set(results.map((result) => result.file_id).filter(Boolean)).size,
    },
    limits: {
      max_results: maxResults,
      snippet_chars: snippetChars,
    },
    warnings: Array.isArray(packet?.warnings) ? [...packet.warnings] : [],
    results,
  };
}

function parseLimit(value, fallback) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0) return number;
  return fallback;
}

function normalizeSearchQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function tokenizeSearchQuery(value) {
  return normalizeSearchQuery(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter(Boolean);
}

function textIncludesTerm(value, term) {
  return String(value || "").toLowerCase().includes(term);
}

function buildSearchSnippet(text, terms, maxChars) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized || !Number.isInteger(maxChars) || maxChars <= 0) return "";
  if (normalized.length <= maxChars) return normalized;

  const lowered = normalized.toLowerCase();
  const firstMatch = terms
    .map((term) => lowered.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstMatch - Math.floor(maxChars / 3));
  const end = Math.min(normalized.length, start + maxChars);
  const snippet = normalized.slice(start, end).trim();
  return `${start > 0 ? "... " : ""}${snippet}${end < normalized.length ? " ..." : ""}`;
}

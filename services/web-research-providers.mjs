import { makeHttpError } from "../shared/safe-paths.mjs";

export const DEFAULT_EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";

const SOURCE_TYPE_RANK = Object.freeze({
  official: 0,
  court: 1,
  legal_report: 2,
  other: 3,
});

const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESULT_CHARS = 9000;

export function createExaWebResearchProvider({
  apiKey,
  endpoint = DEFAULT_EXA_SEARCH_ENDPOINT,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResults = DEFAULT_MAX_RESULTS,
  maxResultChars = DEFAULT_MAX_RESULT_CHARS,
} = {}) {
  return async function exaWebResearchProvider({ query, question } = {}) {
    const searchQuery = normalizeSearchQuery(query || buildCopilotWebSearchQueries(question)[0]);
    if (!apiKey) {
      throw makeHttpError("Research is temporarily unavailable.", 409, "copilot_research.provider_not_configured");
    }
    if (!searchQuery) {
      throw makeHttpError("Research question is required.", 400, "copilot_research.question_required");
    }

    const payload = await fetchExaSearch({
      apiKey,
      endpoint,
      fetchImpl,
      query: searchQuery,
      timeoutMs,
      maxResults,
      maxResultChars,
    });
    const sources = normalizeExaSearchResults(payload, {
      query: searchQuery,
      maxResults,
      maxResultChars,
    });
    if (!sources.length) {
      throw makeHttpError("I could not find useful public sources. I can still answer from the matter record.", 404, "copilot_research.no_results");
    }
    return {
      query: searchQuery,
      sources,
      raw: payload,
    };
  };
}

export function buildCopilotWebSearchQueries(question = "") {
  const normalized = normalizeSearchQuery(question);
  if (!normalized) return [];
  const terms = [];
  const lower = normalized.toLowerCase();
  const add = (term) => {
    if (!terms.includes(term)) terms.push(term);
  };

  if (/\bnclt\b/i.test(normalized)) add("NCLT");
  if (/\bnclat\b/i.test(normalized)) add("NCLAT");
  if (/\bibc\b|insolvency|bankruptcy/i.test(normalized)) add("IBC");
  if (/\birp\b/i.test(normalized)) add("IRP");
  if (/\brp\b|resolution professional/i.test(normalized)) add("RP resolution professional");
  if (/liquidat/i.test(normalized)) add("liquidator");
  if (/sale deed/i.test(normalized)) add("sale deed");
  if (/section|sections|provision|provisions/i.test(normalized)) add("sections");

  const domainQuery = terms.length
    ? `${terms.join(" ")} India case law legal options`.trim()
    : `${normalized} India legal options`.trim();
  const queries = [domainQuery];

  if (lower.includes("sale deed") && /\b(nclt|irp|rp|resolution professional|ibc)\b/i.test(normalized)) {
    queries.push("NCLT IBC section 60(5) IRP RP execute sale deed");
    queries.push("IBC resolution professional execute sale deed NCLT directions");
  }

  return [...new Set(queries.map(normalizeSearchQuery).filter(Boolean))].slice(0, 3);
}

export function normalizeExaSearchResults(payload = {}, {
  maxResults = DEFAULT_MAX_RESULTS,
  maxResultChars = DEFAULT_MAX_RESULT_CHARS,
} = {}) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const normalized = results
    .map((result, index) => normalizePublicSource(result, index, { maxResultChars }))
    .filter((source) => source.url || source.title || source.snippet);
  normalized.sort((left, right) => SOURCE_TYPE_RANK[left.sourceType] - SOURCE_TYPE_RANK[right.sourceType] || left.inputIndex - right.inputIndex);
  return normalized.slice(0, maxResults).map((source, index) => ({
    id: `WEB-${String(index + 1).padStart(4, "0")}`,
    title: source.title,
    url: source.url,
    publishedAt: source.publishedAt,
    sourceType: source.sourceType,
    snippet: source.snippet,
  }));
}

async function fetchExaSearch({ apiKey, endpoint, fetchImpl, query, timeoutMs, maxResults, maxResultChars }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: maxResults,
        contents: {
          highlights: {
            query,
            maxCharacters: Math.max(500, Math.min(2000, Math.floor(maxResultChars / Math.max(1, maxResults)))),
          },
        },
      }),
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
    const status = response?.status || 503;
    const message = providerErrorMessage(payload) || "Research is temporarily unavailable.";
    throw makeHttpError(message, status >= 400 && status < 500 ? 502 : 503, "copilot_research.provider_error");
  }
  return payload || {};
}

function normalizePublicSource(result = {}, inputIndex, { maxResultChars }) {
  const title = normalizeWhitespace(result.title || result.name || "Untitled public source");
  const url = normalizeWhitespace(result.url || "");
  const publishedAt = normalizeWhitespace(result.publishedDate || result.published_at || result.date || "");
  const snippet = truncateText(extractSnippet(result), maxResultChars);
  return {
    inputIndex,
    title,
    url,
    publishedAt,
    sourceType: classifyPublicSource(url),
    snippet,
  };
}

function extractSnippet(result = {}) {
  if (Array.isArray(result.highlights) && result.highlights.length) {
    return result.highlights.map((item) => normalizeWhitespace(typeof item === "string" ? item : item?.text || "")).filter(Boolean).join("\n");
  }
  if (typeof result.summary === "string" && result.summary.trim()) return result.summary;
  if (typeof result.text === "string" && result.text.trim()) return result.text;
  return "";
}

function classifyPublicSource(url = "") {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "other";
  }
  if (/(^|\.)(nclt\.gov\.in|nclat\.nic\.in|sci\.gov\.in|main\.sci\.gov\.in|delhihighcourt\.nic\.in)$/i.test(hostname)
    || /highcourt|districtcourt|courts?\./i.test(hostname)) {
    return "court";
  }
  if (/(^|\.)(gov\.in|nic\.in)$/i.test(hostname)
    || ["ibbi.gov.in", "mca.gov.in", "indiacode.nic.in"].includes(hostname)) {
    return "official";
  }
  if (["livelaw.in", "barandbench.com", "scconline.com", "taxmann.com", "indiankanoon.org"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return "legal_report";
  }
  return "other";
}

function normalizeSearchQuery(value = "") {
  return normalizeWhitespace(value).slice(0, 500);
}

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value = "", limit = DEFAULT_MAX_RESULT_CHARS) {
  const text = normalizeWhitespace(value);
  const max = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_MAX_RESULT_CHARS;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function providerErrorMessage(payload) {
  const message = payload?.error?.message || payload?.message || payload?.error;
  return typeof message === "string" && message.trim() ? message.trim() : "";
}

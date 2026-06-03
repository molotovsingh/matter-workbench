#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadLocalEnv } from "../shared/local-env.mjs";

const DEFAULT_ENDPOINT = "https://api.parallel.ai/v1/search";
const DEFAULT_COUNTRY = "India";
const DEFAULT_DAYS = 14;
const DEFAULT_MAX_ITEMS = 6;
const DEFAULT_MODE = "advanced";
const MIN_SEARCH_CANDIDATE_ITEMS = 20;
const SEARCH_CANDIDATE_MULTIPLIER = 4;

export function parseProbeArgs(argv = []) {
  const options = {
    country: DEFAULT_COUNTRY,
    days: DEFAULT_DAYS,
    maxItems: DEFAULT_MAX_ITEMS,
    mode: DEFAULT_MODE,
    json: false,
    mock: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--country") {
      options.country = boundedText(argv[++index], DEFAULT_COUNTRY, 80);
    } else if (arg === "--days") {
      options.days = clampInteger(argv[++index], 1, 30, DEFAULT_DAYS);
    } else if (arg === "--max") {
      options.maxItems = clampInteger(argv[++index], 1, 12, DEFAULT_MAX_ITEMS);
    } else if (arg === "--mode") {
      const mode = String(argv[++index] || "").trim().toLowerCase();
      options.mode = mode === "advanced" ? "advanced" : "basic";
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--mock") {
      options.mock = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

export function buildParallelSearchRequest({
  country = DEFAULT_COUNTRY,
  days = DEFAULT_DAYS,
  maxItems = DEFAULT_MAX_ITEMS,
  mode = DEFAULT_MODE,
  now = new Date(),
} = {}) {
  const normalizedCountry = boundedText(country, DEFAULT_COUNTRY, 80);
  const normalizedDays = clampInteger(days, 1, 30, DEFAULT_DAYS);
  const normalizedMax = clampInteger(maxItems, 1, 12, DEFAULT_MAX_ITEMS);
  const normalizedMode = mode === "advanced" ? "advanced" : "basic";
  const candidateItems = Math.max(MIN_SEARCH_CANDIDATE_ITEMS, normalizedMax * SEARCH_CANDIDATE_MULTIPLIER);

  return {
    objective: [
      `Find public legal developments in ${normalizedCountry} from the last ${normalizedDays} days.`,
      "Prefer official court, regulator, government, bar, or reputable legal reporting sources.",
      "Return concise source pages useful for a public legal updates digest.",
      "Avoid homepages, category pages, search portals, access-wall pages, recruitment pages, listing notices, or generic update indexes.",
      "Do not provide legal advice, do not infer relevance to any private matter, and do not fabricate court, date, citation, or case names.",
    ].join(" "),
    search_queries: buildSearchQueries(normalizedCountry, now),
    max_chars_total: candidateItems * 1400,
    mode: normalizedMode,
  };
}

export async function fetchLegalDevelopments({
  apiKey,
  country = DEFAULT_COUNTRY,
  days = DEFAULT_DAYS,
  maxItems = DEFAULT_MAX_ITEMS,
  mode = DEFAULT_MODE,
  now = new Date(),
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = fetch,
} = {}) {
  const key = String(apiKey || "").trim();
  if (!key || /^changeme|placeholder|replace_me|todo$/i.test(key)) {
    throw new Error("PARALLEL_API_KEY is required for live legal updates.");
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify(buildParallelSearchRequest({ country, days, maxItems, mode, now })),
  });

  if (!response?.ok) {
    const detail = await safeResponseText(response);
    throw new Error(`Parallel Search failed with HTTP ${response?.status || "unknown"}${detail ? `: ${detail}` : ""}`);
  }

  return normalizeParallelSearchResults(await response.json(), { maxItems, days, country, now });
}

export function normalizeParallelSearchResults(payload, {
  maxItems = DEFAULT_MAX_ITEMS,
  days = DEFAULT_DAYS,
  now = new Date(),
  country = DEFAULT_COUNTRY,
} = {}) {
  const limit = clampInteger(maxItems, 1, 12, DEFAULT_MAX_ITEMS);
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const usefulResults = results.filter((result) => isUsefulSearchResult(result, { days, now, country }));
  const preferredResults = usefulResults.filter((result) => isPreferredLegalSource(result?.url, country));
  const selectedResults = preferredResults.length > 0 ? preferredResults : usefulResults;

  return selectedResults.map((result, index) => {
    const url = cleanUrl(result?.url);
    const rawTitle = boundedText(cleanDisplayText(result?.title), "Untitled legal update", 180);
    const excerpts = Array.isArray(result?.excerpts) ? result.excerpts : [];
    const summary = summarizeLegalUpdate({
      title: rawTitle,
      text: excerpts.map((item) => cleanDisplayText(item)).filter(Boolean).join(" "),
    });
    const title = buildDigestTitle({ title: rawTitle, summary });
    const date = cleanIsoDate(result?.publish_date || result?.date || extractDateFromText(title));
    const court = explicitCourt(result);
    const category = classifyLazyLegalCategory(`${title} ${summary}`);

    return {
      id: `legal-update-${index + 1}`,
      title,
      source: "parallel_search",
      url,
      date,
      court,
      category,
      summary,
      citations: url ? [url] : [],
      tags: ["public-source"],
    };
  }).filter(isUsableNormalizedUpdate).slice(0, limit).map((update, index) => ({
    ...update,
    id: `legal-update-${index + 1}`,
  }));
}

export function formatLegalDevelopmentsDigest(updates, {
  country = DEFAULT_COUNTRY,
  days = DEFAULT_DAYS,
  now = new Date(),
} = {}) {
  const normalizedCountry = boundedText(country, DEFAULT_COUNTRY, 80);
  const normalizedDays = clampInteger(days, 1, 30, DEFAULT_DAYS);
  const generated = toDisplayDate(now);
  const rows = Array.isArray(updates) ? updates : [];

  const lines = [
    `${normalizedDays <= 7 ? "Here's what happened this week" : "Here's what happened recently"} in legal developments: ${normalizedCountry}`,
    `Window: last ${normalizedDays} days`,
    `Generated: ${generated}`,
    "",
  ];

  if (rows.length === 0) {
    lines.push("No usable public legal updates were returned for this query.");
    return lines.join("\n");
  }

  rows.forEach((update, index) => {
    lines.push(`${index + 1}. ${update.title}`);
    if (update.url) lines.push(`   Link: ${update.url}`);
    lines.push("");
  });

  lines.push("Note: public-source digest only. Verify sources before relying on any legal development.");
  return lines.join("\n");
}

export function mockLegalDevelopments(country = DEFAULT_COUNTRY) {
  const normalizedCountry = boundedText(country, DEFAULT_COUNTRY, 80);
  return [
    {
      id: "legal-update-1",
      title: `${normalizedCountry} court update digest sample`,
      source: "parallel_search",
      url: "https://example.test/legal-update",
      date: "2026-05-22",
      court: null,
      category: "General",
      summary: "Sample mode shows the output shape without calling Parallel. Live mode replaces this with public search results and source links.",
      citations: ["https://example.test/legal-update"],
      tags: ["public-source", "sample"],
    },
  ];
}

async function main() {
  const options = parseProbeArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await loadLocalEnv({ appDir, targetEnv: process.env, override: false });

  let updates;
  if (options.mock) {
    updates = mockLegalDevelopments(options.country);
  } else {
    updates = await fetchLegalDevelopments({
      apiKey: process.env.PARALLEL_API_KEY,
      country: options.country,
      days: options.days,
      maxItems: options.maxItems,
      mode: options.mode,
      endpoint: process.env.PARALLEL_SEARCH_ENDPOINT || DEFAULT_ENDPOINT,
    });
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...options, updates }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatLegalDevelopmentsDigest(updates, options)}\n`);
}

function buildSearchQueries(country, now = new Date()) {
  const dateHint = searchDateHint(now);
  if (String(country).trim().toLowerCase() === "india") {
    return [
      `India legal developments court judgments ${dateHint} SCC Online`,
      `India High Court weekly round-up ${dateHint} LiveLaw`,
      `India Supreme Court High Court legal news ${dateHint} Bar and Bench`,
      `India Supreme Court High Court legal developments ${dateHint} LawBeat`,
      `India Supreme Court High Court legal developments ${dateHint} Verdictum`,
      `India court legal developments regulator ${dateHint}`,
    ];
  }
  return [
    `${country} court judgments ${dateHint}`,
    `${country} legal news ${dateHint}`,
    `${country} law reform ${dateHint}`,
  ];
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function boundedText(value, fallback, maxLength) {
  const text = collapseWhitespace(value);
  if (!text) return fallback;
  if (text.length <= maxLength) return text;
  const raw = text.slice(0, maxLength - 3).trim();
  const wordBoundary = raw.lastIndexOf(" ");
  const clipped = wordBoundary > Math.floor(maxLength * 0.6) ? raw.slice(0, wordBoundary).trim() : raw;
  return `${clipped}...`;
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanUrl(value) {
  const text = collapseWhitespace(value);
  if (!/^https?:\/\//i.test(text)) return null;
  return text;
}

function cleanIsoDate(value) {
  const text = collapseWhitespace(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function explicitCourt(result) {
  const value = result?.court || result?.metadata?.court;
  return collapseWhitespace(value) || null;
}

function isUsefulSearchResult(result, { days = DEFAULT_DAYS, now = new Date(), country = DEFAULT_COUNTRY } = {}) {
  const url = cleanUrl(result?.url);
  const title = collapseWhitespace(result?.title);
  const excerpts = Array.isArray(result?.excerpts) ? result.excerpts.join(" ") : "";
  const summary = collapseWhitespace(excerpts);
  const discoveredDate = result?.publish_date || result?.date || extractDateFromText(title) || extractDateFromUrl(url);
  if (!url || !title) return false;
  if (isLikelyHomepage(url)) return false;
  if (isCodeRepositoryUrl(url)) return false;
  if (isSocialUrl(url)) return false;
  if (!isDateWithinWindow(discoveredDate, { days, now })) return false;
  if (/\b(ip subscription is detected|redirecting to register page|please register yourself|unlimited free access)\b/i.test(summary)) {
    return false;
  }
  if (/\b(download app from|website policies|contact us|enjoying your free trial|upgrade now|subscribe latest legal news|law school legal jobs|get latest news)\b/i.test(summary)) {
    return false;
  }
  if (!isCountryRelevantResult(result, country)) return false;
  if (/^(home|top stories|latest news)$/i.test(title)) return false;
  if (/^description:/i.test(title)) return false;
  if (/^latest orders\b/i.test(title)) return false;
  if (/^(legal news|legal updates)(?:\s*[-|]|$)/i.test(title)) return false;
  return true;
}

function isPreferredLegalSource(url, country = DEFAULT_COUNTRY) {
  const normalizedCountry = collapseWhitespace(country).toLowerCase();
  if (normalizedCountry !== "india") return true;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return [
      "sci.gov.in",
      "main.sci.gov.in",
      "scobserver.in",
      "scconline.com",
      "livelaw.in",
      "barandbench.com",
      "lawbeat.in",
      "theleaflet.in",
      "verdictum.in",
      "prsindia.org",
      "egazette.gov.in",
      "pib.gov.in",
      "sebi.gov.in",
      "rbi.org.in",
      "cci.gov.in",
      "nclt.gov.in",
      "nclat.nic.in",
      "doj.gov.in",
    ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function isUsableNormalizedUpdate(update) {
  const title = collapseWhitespace(update?.title);
  const summary = collapseWhitespace(update?.summary);
  if (!title || !summary) return false;
  if (/\b(?:invalid captcha|judgments and orders home|phrase all words any words|nominal index|citations\s+20\d{2}\s+livelaw)\b/i.test(`${title} ${summary}`)) return false;
  if (summary.length < 45) return false;
  if (/^\d+(?:\(\d+\)|\.)?\s+(?:and|r\/w|read with)\b/i.test(summary)) return false;
  return true;
}

function classifyLazyLegalCategory(value) {
  const text = collapseWhitespace(value).toLowerCase();
  const rules = [
    ["Criminal Law", /\b(criminal|conviction|convicted|acquitted|bail|fir|police|offence|offense|sentence|sentencing|dowry|murder|rape|pocso|ndps|ipc|bnss|bns|pmla|custody|arrest|anticipatory)\b/],
    ["Family Law", /\b(family|matrimonial|marriage|divorce|maintenance|custody|wife|husband|spouse|child support|domestic violence|adoption|guardianship)\b/],
    ["Constitutional / Public Law", /\b(constitution|constitutional|article\s+\d+|fundamental right|writ|public land|religious|religion|reservation|election|citizenship|government|state action)\b/],
    ["Tax", /\b(tax|income tax|gst|customs|excise|reassessment|tds|tribunal|itat)\b/],
    ["Commercial / Arbitration", /\b(arbitration|commercial|contract|company|corporate|insolvency|ibc|nclt|nclat|merger|shareholder|sebi|competition|consumer contract)\b/],
    ["Consumer Law", /\b(consumer|deficiency in service|unfair trade|builder|homebuyer|rera)\b/],
    ["Labour / Employment", /\b(labour|labor|employment|employee|workman|industrial dispute|service law|termination|wages|pension)\b/],
    ["Property / Land", /\b(property|land|lease|tenancy|eviction|possession|title|specific performance|real estate)\b/],
    ["Regulatory", /\b(regulator|regulatory|rbi|cci|sebi|irdai|trai|guidelines|circular|notification)\b/],
    ["Court Procedure", /\b(procedure|procedural|limitation|evidence|jurisdiction|maintainability|appeal|review petition|revision|interim order|injunction|pleading)\b/],
  ];
  for (const [category, pattern] of rules) {
    if (pattern.test(text)) return category;
  }
  return "General";
}

function isCountryRelevantResult(result, country = DEFAULT_COUNTRY) {
  const signals = countrySignals(country);
  if (signals.length === 0) return true;
  const haystack = [
    result?.title,
    result?.url,
    ...(Array.isArray(result?.excerpts) ? result.excerpts : []),
  ].map((item) => cleanDisplayText(item).toLowerCase()).join(" ");
  return signals.some((signal) => haystack.includes(signal));
}

function countrySignals(country = DEFAULT_COUNTRY) {
  const normalized = collapseWhitespace(country).toLowerCase();
  if (!normalized) return [];
  if (normalized === "india") {
    return [
      "india",
      "indian",
      "supreme court of india",
      "delhi high court",
      "allahabad high court",
      "bombay high court",
      "calcutta high court",
      "madras high court",
      "madhya pradesh high court",
      "karnataka high court",
      "kerala high court",
      "gujarat high court",
      "rajasthan high court",
      "patna high court",
      "orissa high court",
      "odisha high court",
      "telangana high court",
      "andhra pradesh high court",
      "punjab and haryana high court",
      "chhattisgarh high court",
      "jharkhand high court",
      "uttarakhand high court",
      "gauhati high court",
      "nclt",
      "nclat",
      "ncdrf",
      "sebi",
      "rbi",
      "cci",
      "gst",
      "scc online",
      "scconline",
      "livelaw",
      "bar and bench",
      "lawbeat",
      "verdictum",
    ];
  }
  if (normalized === "united kingdom" || normalized === "uk") {
    return ["united kingdom", "uk", "british", "england", "wales", "scotland", "northern ireland"];
  }
  if (normalized === "united states" || normalized === "usa" || normalized === "us") {
    return ["united states", "usa", "u.s.", "us supreme court", "federal court", "american"];
  }
  return [normalized];
}

function isCodeRepositoryUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)github\.com$/i.test(parsed.hostname)
      || /(^|\.)gitlab\.com$/i.test(parsed.hostname)
      || /(^|\.)bitbucket\.org$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isSocialUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)instagram\.com$/i.test(parsed.hostname)
      || /(^|\.)facebook\.com$/i.test(parsed.hostname)
      || /(^|\.)x\.com$/i.test(parsed.hostname)
      || /(^|\.)twitter\.com$/i.test(parsed.hostname)
      || /(^|\.)youtube\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isDateWithinWindow(value, { days, now }) {
  const text = collapseWhitespace(value);
  if (!text) return true;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return true;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  const end = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(end.getTime())) return true;
  const start = new Date(end.getTime() - clampInteger(days, 1, 30, DEFAULT_DAYS) * 24 * 60 * 60 * 1000);
  return date >= start && date <= end;
}

function searchDateHint(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return "recent";
  const month = date.toLocaleString("en", { month: "short", timeZone: "UTC" });
  return `${month} ${date.getUTCFullYear()}`;
}

function cleanDisplayText(value) {
  let text = String(value || "");
  text = text.replace(/!\[[^\]]*]\([^)]+\)/g, " ");
  text = text.replace(/\[([^\]]*)]\([^)]+\)/g, "$1");
  text = text.replace(/^\s*#{1,6}\s*/gm, " ");
  text = text.replace(/[*_`]+/g, "");
  return collapseWhitespace(decodeHtmlEntities(text.replace(/<[^>]*>/g, " ")));
}

function summarizeLegalUpdate({ title = "", text = "" } = {}) {
  let cleaned = collapseWhitespace(text);
  cleaned = removeSummaryBoilerplate(cleaned, title);
  const legalSentence = extractLegalSentence(cleaned) || extractStatementSummary(cleaned) || firstUsefulFragment(cleaned);
  return boundedText(legalSentence, "No excerpt returned.", 360);
}

function buildDigestTitle({ title = "", summary = "" } = {}) {
  const rawTitle = boundedText(cleanDisplayText(title), "Untitled legal update", 180);
  if (!isGenericDigestTitle(rawTitle)) return rawTitle;
  const court = extractCourtName(summary);
  if (!court) return rawTitle;
  const issue = extractIssueFromLegalSummary(summary);
  return boundedText(`${court}${issue ? `: ${issue}` : ""}`, rawTitle, 140);
}

function isGenericDigestTitle(value) {
  return /\b(?:top weekly legal developments|weekly legal developments|weekly round-up|legal developments india|legal news|latest legal updates|court declares another|islamophobia news)\b/i.test(value);
}

function extractCourtName(value) {
  const text = collapseWhitespace(value);
  const match = text.match(/\b(?:the\s+)?(Supreme Court(?:\s+of\s+India)?|[A-Z][A-Za-z.&'-]+(?:\s+[A-Z][A-Za-z.&'-]+){0,5}\s+High Court|High Court|Court of Appeal|Constitutional Court|Tribunal)\b/);
  if (!match) return "";
  return match[1].replace(/^the\s+/i, "");
}

function extractIssueFromLegalSummary(value) {
  const text = collapseWhitespace(value);
  const held = text.match(/\bheld\s+that\s+(.+?)(?:[.;]|\s+and\s+finding\b|$)/i);
  if (held) return headlineCaseFragment(held[1]);
  const verb = text.match(/\b(set aside|upheld|allowed|dismissed|ruled|observed|directed|clarified|issued|granted|rejected|refused)\b\s+(?:that\s+)?(.+?)(?:[.;]|$)/i);
  if (verb) return headlineCaseFragment(`${verb[1]} ${verb[2]}`);
  return "";
}

function headlineCaseFragment(value) {
  let text = collapseWhitespace(value)
    .replace(/^the\s+/i, "")
    .replace(/\s+and\s+finding\s+.*$/i, "")
    .replace(/[,\s]+$/g, "");
  if (!text) return "";
  text = text.charAt(0).toLowerCase() + text.slice(1);
  return text;
}

function removeSummaryBoilerplate(value, title = "") {
  let text = collapseWhitespace(value);
  const titleText = collapseWhitespace(title);
  if (titleText && text.toLowerCase().startsWith(titleText.toLowerCase())) {
    text = text.slice(titleText.length).trim();
  }
  return collapseWhitespace(text
    .replace(/\bTop Legal Developments\s*\[[^\]]+\]\s*\|/gi, " ")
    .replace(/\bHIGH COURT HIGHLIGHTS OF THIS WEEK\b/gi, " ")
    .replace(/\bSUPREME COURT HIGHLIGHTS OF THIS WEEK\b/gi, " ")
    .replace(/\bRead more HERE\b/gi, " ")
    .replace(/\bCollegium Resolutions\s*\|\s*Title\s*\|\s*View\s*\/\s*Download\s*\|/gi, " ")
    .replace(/\|\s*Accessible Version\b.*$/gi, " ")
    .replace(/\bClick here to (?:view|download)\b/gi, " ")
    .replace(/\bView\s*\(\d+\s*(?:KB|MB)\)\b/gi, " "));
}

function extractLegalSentence(value) {
  const text = collapseWhitespace(value);
  const courtPattern = /\b(?:Supreme Court|[A-Z][A-Za-z.&'-]+(?:\s+[A-Z][A-Za-z.&'-]+){0,5}\s+High Court|High Court|Court of Appeal|Constitutional Court|Tribunal)\b/g;
  const legalVerbPattern = /\b(?:held|ruled|observed|directed|set aside|upheld|allowed|dismissed|clarified|issued|granted|rejected|refused|appointed|recommended|convicted|acquitted)\b/i;
  const matches = [...text.matchAll(courtPattern)];
  for (const match of matches) {
    let start = match.index || 0;
    if (start >= 4 && text.slice(start - 4, start).toLowerCase() === "the ") start -= 4;
    const fragment = sentenceFromIndex(text, start);
    if (legalVerbPattern.test(fragment)) return tidySentence(fragment);
  }
  return "";
}

function extractStatementSummary(value) {
  const text = collapseWhitespace(value);
  const statement = text.match(/\bStatement dated\b.{20,260}/i);
  return statement ? tidySentence(statement[0]) : "";
}

function firstUsefulFragment(value) {
  const fragments = collapseWhitespace(value)
    .split(/\s+\|\s+|(?<=[.!?])\s+/)
    .map((item) => tidySentence(item))
    .filter((item) => item.length >= 10)
    .filter((item) => !/\b(?:homepage|navigation|read more|download app|website policies|contact us)\b/i.test(item));
  return fragments[0] || "";
}

function sentenceFromIndex(value, index) {
  const text = String(value || "").slice(index);
  const match = text.match(/^.{20,420}?(?:[.!?](?=\s|$)|$)/);
  return match ? match[0] : text;
}

function tidySentence(value) {
  let text = collapseWhitespace(value)
    .replace(/\s+,/g, ",")
    .replace(/\s+;/g, ";")
    .replace(/\s+\./g, ".")
    .replace(/^\W+/, "");
  if (!text) return "";
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_match, code) => {
      const number = Number.parseInt(code, 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const number = Number.parseInt(code, 16);
      return Number.isFinite(number) ? String.fromCodePoint(number) : "";
    });
}

function extractDateFromText(value) {
  const text = collapseWhitespace(value);
  const yearMonthDay = text.match(/\b(20\d{2})[-\s](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[-\s](\d{1,2})\b/i);
  if (yearMonthDay) {
    return isoDate(yearMonthDay[1], monthNumber(yearMonthDay[2]), yearMonthDay[3]);
  }
  const rangeMonthYear = text.match(/\b(\d{1,2})\s*[-\u2013]\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(20\d{2})\b/i);
  if (rangeMonthYear) {
    return isoDate(rangeMonthYear[4], monthNumber(rangeMonthYear[3]), rangeMonthYear[2]);
  }
  const dayMonthYear = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(20\d{2})\b/i);
  if (dayMonthYear) {
    return isoDate(dayMonthYear[3], monthNumber(dayMonthYear[2]), dayMonthYear[1]);
  }
  return "";
}

function extractDateFromUrl(value) {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/\/(20\d{2})\/(\d{2})(?:\/(\d{2}))?\b/);
    if (!match) return "";
    return `${match[1]}-${match[2]}-${String(match[3] || "01").padStart(2, "0")}`;
  } catch {
    return "";
  }
}

function monthNumber(value) {
  const month = String(value || "").slice(0, 3).toLowerCase();
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.indexOf(month);
  return index >= 0 ? index + 1 : 0;
}

function isoDate(year, month, day) {
  const m = Number(month);
  const d = Number(day);
  if (!year || !m || !d) return "";
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isLikelyHomepage(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname === "") return true;
    return /^\/(?:topic|tag|category|round-ups?|all-updates|latest-orders|recruitments)\b/i.test(pathname);
  } catch {
    return false;
  }
}

function toDisplayDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

async function safeResponseText(response) {
  try {
    const text = await response.text();
    return boundedText(text, "", 240);
  } catch {
    return "";
  }
}

function usage() {
  return [
    "Usage: node scripts/legal-updates-probe.mjs [options]",
    "",
    "Options:",
    "  --country <name>   Country/jurisdiction focus. Default: India",
    "  --days <number>    Lookback window, 1-30 days. Default: 14",
    "  --max <number>     Maximum updates, 1-12. Default: 6",
    "  --mode <basic|advanced>  Parallel Search mode. Default: advanced",
    "  --json             Print normalized JSON instead of the headline-link digest",
    "  --mock             Show deterministic sample output without calling Parallel",
    "  --help             Show this help",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}

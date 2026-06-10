import {
  EVENT_TYPES,
  LAWYER_FACING_PERSPECTIVE,
} from "./providers.mjs";
import { sourceLabelFields } from "./source-records.mjs";

const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const HIGH_RISK_CONCLUSION_TERMS = [
  "fraud",
  "bad faith",
  "breach proved",
  "liability admitted",
];
const RAW_CITATION_RE = /\bFILE-\d{4,}\s+p\d+\.b\d+\b/g;
const NON_MERITS_EVENT_RE = /\b(?:client\s+interview\s+transcript\s+recorded|transcript\s+(?:was\s+)?recorded|email\s+correspondence\s+exported|e-?mail\s+export(?:ed)?|gmail\s+export(?:ed)?|file\s+export(?:ed)?|vakalatnama(?:\s+(?:was\s+)?executed|\s+execution)?|executed\s+vakalatnama)\b/i;

export function validateAndHydrateEntries(rawEntries, blocks, sourceIndex = new Map()) {
  const blockByCitation = new Map(blocks.map((block) => [block.citation, block]));
  const entries = [];
  for (const raw of rawEntries) {
    const block = blockByCitation.get(raw.citation);
    if (!block) continue;
    if (!isValidDateIso(raw.date_iso)) continue;
    const event = normalizeEventText(raw.event, block.text);
    const dateText = String(raw.date_text || "").replace(/\s+/g, " ").trim();
    const eventType = normalizeEventType(raw.event_type);
    const legalRelevance = normalizeLegalRelevance(raw.legal_relevance, block.text);
    const issueTags = normalizeIssueTags(raw.issue_tags);
    const perspective = String(raw.perspective || "").replace(/\s+/g, " ").trim();
    if (!event || !dateText || !eventType || !legalRelevance || !issueTags.length) continue;
    if (perspective !== LAWYER_FACING_PERSPECTIVE) continue;
    if (isNonMeritsChronologyEntry({ event, legalRelevance, eventType, issueTags })) continue;
    entries.push({
      date_iso: raw.date_iso,
      date_text: dateText,
      event,
      event_type: eventType,
      legal_relevance: legalRelevance,
      issue_tags: issueTags,
      perspective,
      citation: raw.citation,
      file_id: block.file_id,
      source_file_id: block.file_id,
      ...sourceLabelFields(sourceIndex.get(block.file_id)),
      source_path: block.source_path,
      original_name: block.original_name,
      page: block.page,
      block_id: block.block_id,
      block_type: block.block_type,
      needs_review: Boolean(raw.needs_review || block.needs_review),
      confidence: normalizeConfidence(raw.confidence),
      source_excerpt: block.text.slice(0, 500),
    });
  }
  return entries;
}

export function validateAndHydrateCandidates(rawCandidates, blocks, sourceIndex = new Map()) {
  const blockByCitation = new Map(blocks.map((block) => [block.citation, block]));
  const candidates = [];
  for (const raw of rawCandidates) {
    const block = blockByCitation.get(raw?.citation);
    if (!block) continue;
    if (!isValidDateIso(raw.date_iso)) continue;
    const eventCandidate = normalizeNarrativeText(raw.event_candidate, block.text).slice(0, 1000);
    const legalMateriality = normalizeNarrativeText(raw.legal_materiality, block.text).slice(0, 1000);
    const dateText = String(raw.date_text || "").replace(/\s+/g, " ").trim();
    if (!eventCandidate || !legalMateriality || !dateText) continue;
    const candidateType = normalizeCandidateType(raw.candidate_type);
    const partyPosture = normalizePartyPosture(raw.party_posture);
    candidates.push({
      candidate_id: `cand_${String(candidates.length + 1).padStart(4, "0")}`,
      date_iso: raw.date_iso,
      date_text: dateText,
      event_candidate: eventCandidate,
      legal_materiality: legalMateriality,
      citation: raw.citation,
      source_excerpt: normalizeCandidateExcerpt(raw.source_excerpt, block.text),
      candidate_type: candidateType,
      party_posture: partyPosture,
      same_fact_hint: normalizeCandidateNote(raw.same_fact_hint),
      date_uncertainty: normalizeCandidateNote(raw.date_uncertainty),
      ocr_suspicion: normalizeCandidateNote(raw.ocr_suspicion),
      file_id: block.file_id,
      source_file_id: block.file_id,
      ...sourceLabelFields(sourceIndex.get(block.file_id)),
      source_path: block.source_path,
      original_name: block.original_name,
      page: block.page,
      block_id: block.block_id,
      block_type: block.block_type,
      needs_review: Boolean(raw.needs_review || block.needs_review),
      confidence: normalizeConfidence(raw.confidence),
    });
  }
  return candidates.sort(compareEntries);
}

function normalizeCandidateType(value) {
  const type = String(value || "").trim().toLowerCase();
  return [
    "agreement",
    "payment",
    "notice",
    "pleading",
    "order",
    "filing",
    "inspection",
    "correspondence",
    "other",
  ].includes(type) ? type : "other";
}

function normalizePartyPosture(value) {
  const posture = String(value || "").trim().toLowerCase();
  return ["helps_client", "hurts_client", "neutral", "unclear"].includes(posture) ? posture : "unclear";
}

function normalizeCandidateExcerpt(value, sourceText) {
  const excerpt = String(value || "").replace(/\s+/g, " ").trim();
  return (excerpt || String(sourceText || "").replace(/\s+/g, " ").trim()).slice(0, 700);
}

function normalizeCandidateNote(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function normalizeEventType(value) {
  const eventType = String(value || "").trim().toLowerCase();
  return EVENT_TYPE_SET.has(eventType) ? eventType : "";
}

function normalizeEventText(value, sourceText) {
  const event = normalizeNarrativeText(value, sourceText);
  if (!event) return "";
  if (hasUnsupportedHighRiskConclusion(event, sourceText)) return "";
  return event.slice(0, 1000);
}

function normalizeNarrativeText(value) {
  return softenUnsupportedConclusionLanguage(String(value || ""))
    .replace(RAW_CITATION_RE, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

function normalizeLegalRelevance(value, sourceText) {
  const relevance = sharpenLegalRelevanceLanguage(normalizeNarrativeText(value, sourceText));
  if (!relevance) return "";
  if (hasUnsupportedHighRiskConclusion(relevance, sourceText)) return "";
  return relevance.slice(0, 1000);
}

function isNonMeritsChronologyEntry({ event, legalRelevance, eventType, issueTags }) {
  const text = `${event} ${legalRelevance} ${eventType} ${(issueTags || []).join(" ")}`;
  return NON_MERITS_EVENT_RE.test(text);
}

function sharpenLegalRelevanceLanguage(value) {
  return String(value || "")
    .replace(/\bThis event is relevant to the client's case because\b/gi, "Supports the client's case because")
    .replace(/\bThis event is relevant because\b/gi, "Supports the client's chronology because")
    .replace(/\bThis payment is relevant as it shows\b/gi, "Supports")
    .replace(/\bThis notice is relevant as it marks\b/gi, "Shows notice by marking")
    .replace(/\bThis notice is relevant because\b/gi, "Shows notice because")
    .replace(/\bThis communication is relevant because\b/gi, "Records")
    .replace(/\bcrucial\b/gi, "relevant")
    .replace(/\bfoundational\b/gi, "relevant")
    .replace(/\bdemonstrates\b/gi, "may support")
    .replace(/\bshows\s+(?:their|its|the opposing party'?s)\s+willingness\s+to\s+(?:accommodate|resolve)(?:\s+(?:it|the dispute|the issue|the grievance))?/gi, "records the opposing party's stated response to the complaint")
    .replace(/\bwillingness\s+to\s+(?:accommodate|resolve)(?:\s+(?:it|the dispute|the issue|the grievance))?/gi, "stated response to the complaint")
    .replace(/\bmay support\s+(?:the\s+)?emotional and financial impact\b/gi, "may support hardship and consequential prejudice, subject to proof")
    .replace(/\bemotional and financial impact\b/gi, "hardship and consequential prejudice, subject to proof")
    .replace(/\s+/g, " ")
    .trim();
}

function softenUnsupportedConclusionLanguage(value) {
  return value
    .replace(/\bproves?\b/gi, "supports")
    .replace(/\bproved\b/gi, "supported")
    .replace(/\bconstitutes\s+a\s+breach\b/gi, "supports a contractual default issue")
    .replace(/\bestablishing\s+the\s+breach\b/gi, "supporting the client's default issue")
    .replace(/\bbreach\s+of\s+(?:the\s+)?agreement\b/gi, "contractual default issue")
    .replace(/\bbreached\b/gi, "missed")
    .replace(/\bbreach\b/gi, "default issue");
}

function hasUnsupportedHighRiskConclusion(relevance, sourceText) {
  const source = String(sourceText || "").toLowerCase();
  const text = relevance.toLowerCase();
  return HIGH_RISK_CONCLUSION_TERMS.some((term) => text.includes(term) && !source.includes(term));
}

function normalizeIssueTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || "").split(/[,;]/);
  const tags = [];
  const seen = new Set();
  for (const rawTag of rawTags) {
    const tag = String(rawTag || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag.slice(0, 64));
    if (tags.length >= 8) break;
  }
  return tags;
}

function isValidDateIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

export function compareEntries(a, b) {
  return a.date_iso.localeCompare(b.date_iso)
    || a.file_id.localeCompare(b.file_id)
    || String(a.block_id).localeCompare(String(b.block_id))
    || a.date_text.localeCompare(b.date_text);
}

export function matterSummary(matterJson) {
  return {
    matter_name: matterJson.matter_name || "",
    client_name: matterJson.client_name || "",
    opposite_party: matterJson.opposite_party || "",
    matter_type: matterJson.matter_type || "",
    jurisdiction: matterJson.jurisdiction || "",
    brief_description: matterJson.brief_description || "",
  };
}

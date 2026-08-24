import { normalizeReferenceText, sha256, summarizeNumbers } from "./util.mjs";

export function comparePageText(candidateText, referenceText) {
  const candidate = normalizeReferenceText(candidateText);
  const reference = normalizeReferenceText(referenceText);
  const candidateTokens = wordTokens(candidate);
  const referenceTokens = wordTokens(reference);
  const candidateCounts = frequency(candidateTokens);
  const referenceCounts = frequency(referenceTokens);
  let overlap = 0;
  for (const [token, count] of referenceCounts) overlap += Math.min(count, candidateCounts.get(token) || 0);
  const precision = candidateTokens.length ? overlap / candidateTokens.length : (referenceTokens.length ? 0 : 1);
  const recall = referenceTokens.length ? overlap / referenceTokens.length : (candidateTokens.length ? 0 : 1);
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const referenceCritical = criticalTokens(reference);
  const candidateCritical = new Set(criticalTokens(candidate));
  const criticalMatches = referenceCritical.filter((token) => candidateCritical.has(token)).length;
  const criticalRecall = referenceCritical.length ? criticalMatches / referenceCritical.length : 1;
  return {
    exactNormalizedText: candidate === reference,
    candidateNormalizedSha256: sha256(candidate),
    referenceNormalizedSha256: sha256(reference),
    candidateCharacters: candidate.length,
    referenceCharacters: reference.length,
    tokenPrecision: precision,
    tokenRecall: recall,
    tokenF1: f1,
    referenceCriticalTokens: referenceCritical.length,
    matchedCriticalTokens: criticalMatches,
    criticalTokenRecall: criticalRecall,
  };
}

export function summarizePageComparisons(comparisons = []) {
  const values = comparisons.filter(Boolean);
  return {
    pages: values.length,
    exactNormalizedTextPages: values.filter((value) => value.exactNormalizedText).length,
    fullCriticalTokenRecallPages: values.filter((value) => value.criticalTokenRecall === 1).length,
    tokenPrecision: summarizeNumbers(values.map((value) => value.tokenPrecision)),
    tokenRecall: summarizeNumbers(values.map((value) => value.tokenRecall)),
    tokenF1: summarizeNumbers(values.map((value) => value.tokenF1)),
    criticalTokenRecall: summarizeNumbers(values.map((value) => value.criticalTokenRecall)),
    pagesBelowReferenceReviewThreshold: values.filter((value) => (
      value.criticalTokenRecall < 1 || value.tokenRecall < 0.9 || value.tokenPrecision < 0.9
    )).length,
  };
}

export function pageText(page) {
  if (Array.isArray(page?.blocks)) {
    return page.blocks.map((block) => String(block?.text ?? block?.markdown ?? "")).join("\n");
  }
  return String(page?.markdown ?? page?.text ?? "");
}

function wordTokens(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .match(/[\p{L}\p{N}]+(?:[./'-][\p{L}\p{N}]+)*/gu) || [];
}

function criticalTokens(text) {
  const patterns = [
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
    /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g,
    /(?:Rs\.?|INR|₹)\s*[\d,]+(?:\.\d+)?/gi,
    /\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b/g,
    /\b(?:section|article|clause|rule|order)\s+[\w()./-]+/gi,
  ];
  const values = [];
  for (const pattern of patterns) values.push(...(String(text || "").match(pattern) || []));
  return [...new Set(values.map((value) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()))].sort();
}

function frequency(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) || 0) + 1);
  return result;
}

import { markdownToBlocks } from "./ocr-normalize.mjs";

const DATE_PATTERN = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\b/g;
const AMOUNT_PATTERN = /(?:Rs\.?|INR|₹)\s*[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b/gi;
const SUSPICIOUS_PATTERNS = [
  /[$₹]\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g,
  /\b[$]\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
  /\b(?:l|I|\|)\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
];

export function scoreOcrProviderResult(providerResult, { pageCount = 0 } = {}) {
  const pages = Array.isArray(providerResult?.pages) ? providerResult.pages : [];
  const expectedPages = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : pages.length;
  const warnings = [];
  let chars = 0;
  let blocks = 0;
  let lowConfidencePages = 0;
  let emptyPages = 0;
  let dateHits = 0;
  let amountHits = 0;
  let suspiciousHits = 0;

  for (let index = 0; index < Math.max(pages.length, expectedPages); index += 1) {
    const page = pages[index] || {};
    const pageWarnings = Array.isArray(page.warnings) ? page.warnings.filter(Boolean).map(String) : [];
    warnings.push(...pageWarnings);

    const text = pageText(page);
    chars += text.length;
    const pageBlocks = pageBlockCount(page, index + 1);
    blocks += pageBlocks;
    if (!text.trim() || pageBlocks === 0) emptyPages += 1;

    const confidence = Number(page.confidence ?? page.confidence_avg);
    if (Number.isFinite(confidence) && confidence < 0.75) lowConfidencePages += 1;

    dateHits += countMatches(text, DATE_PATTERN);
    amountHits += countMatches(text, AMOUNT_PATTERN);
    for (const pattern of SUSPICIOUS_PATTERNS) {
      suspiciousHits += countMatches(text, pattern);
    }
  }

  const usable = chars > 0 && blocks > 0 && emptyPages < Math.max(1, expectedPages || pages.length || 1);
  const veryThinText = expectedPages > 0 && chars < expectedPages * 40 && dateHits === 0 && amountHits === 0;
  const needsRepair = !usable
    || warnings.length > 0
    || lowConfidencePages > 0
    || emptyPages > 0
    || suspiciousHits > 0
    || veryThinText;

  const score = chars
    + (blocks * 25)
    + (dateHits * 50)
    + (amountHits * 80)
    - (warnings.length * 120)
    - (lowConfidencePages * 150)
    - (emptyPages * 500)
    - (suspiciousHits * 500)
    - (veryThinText ? 200 : 0);

  const reasons = [];
  if (!usable) reasons.push("no usable OCR text");
  if (warnings.length) reasons.push(`${warnings.length} provider warning(s)`);
  if (lowConfidencePages) reasons.push(`${lowConfidencePages} low-confidence page(s)`);
  if (emptyPages) reasons.push(`${emptyPages} empty page(s)`);
  if (suspiciousHits) reasons.push(`${suspiciousHits} suspicious OCR token(s)`);
  if (veryThinText) reasons.push("thin OCR text");

  return {
    pageCount: expectedPages,
    chars,
    blocks,
    warnings: warnings.length,
    lowConfidencePages,
    emptyPages,
    dateHits,
    amountHits,
    suspiciousHits,
    usable,
    needsRepair,
    score,
    reasons,
  };
}

function pageText(page) {
  if (Array.isArray(page?.blocks)) {
    return page.blocks.map((block) => String(block?.text ?? block?.markdown ?? "")).join("\n");
  }
  return String(page?.markdown ?? page?.text ?? "");
}

function pageBlockCount(page, pageNumber) {
  if (Array.isArray(page?.blocks)) return page.blocks.filter((block) => String(block?.text ?? block?.markdown ?? "").trim()).length;
  return markdownToBlocks(String(page?.markdown ?? page?.text ?? ""), pageNumber).length;
}

function countMatches(text, pattern) {
  pattern.lastIndex = 0;
  return (String(text || "").match(pattern) || []).length;
}

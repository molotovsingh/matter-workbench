import { scoreOcrProviderResult } from "./ocr-quality.mjs";

export function canUseCachedPdfOcrExtraction(cached, {
  ocrProviderAvailable,
  pdfEngineFingerprint,
} = {}) {
  if (!ocrProviderAvailable) return true;
  if (cached?.engine === pdfEngineFingerprint || cached?.extraction_strategy !== "ocr-first") return false;
  if (isOcrPlaceholderRecord(cached)) return false;
  if (hasWeakCachedOcr(cached)) return false;
  return true;
}

export function hasWeakCachedOcr(cached) {
  const pages = Array.isArray(cached?.pages) ? cached.pages : [];
  const hasOcrPages = pages.some((page) => page.ocr_required === true);
  if (!hasOcrPages) return false;
  const score = scoreOcrProviderResult(cached, { pageCount: cached.page_count });
  if (score.needsRepair) return true;
  return pages.some((page) => {
    if (page.ocr_required !== true) return false;
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    return page.needs_review === true
      || blocks.length === 0
      || isKnownLowConfidence(page.confidence_avg);
  });
}

export function buildExtractionOcrObservability(record, stats = {}) {
  const pages = Array.isArray(record?.pages) ? record.pages : [];
  const warnings = Array.isArray(record?.warnings) ? record.warnings : [];
  const pipeline = record?.ocr_pipeline && typeof record.ocr_pipeline === "object" ? record.ocr_pipeline : {};
  const ocrApplied = Boolean(stats.ocrApplied || pages.some((page) => (
    page.ocr_required === true
    && Array.isArray(page.blocks)
    && page.blocks.length > 0
  )));
  return {
    engine: record?.engine || "",
    page_count: record?.page_count ?? stats.pageCount ?? "",
    ocr_applied: ocrApplied ? "yes" : "no",
    ocr_provider_model: ocrApplied ? (record?.engine || "") : "",
    ocr_primary_model: pipeline.primary_model || (ocrApplied ? (record?.engine || "") : ""),
    ocr_repair_model: pipeline.repair_model || "",
    ocr_repair_status: pipeline.repair_status || "",
    ocr_repair_reason: pipeline.repair_reason || "",
    ocr_required_pages: stats.ocrRequiredPageCount ?? pages.filter((page) => page.ocr_required === true).length,
    low_confidence_pages: pages.filter((page) => isKnownLowConfidence(page.confidence_avg)).length,
    needs_review_pages: pages.filter((page) => page.needs_review === true).length,
    confidence_status: classifyConfidenceStatus(pages),
    provider_warnings_count: ocrApplied ? (stats.providerWarningsCount ?? warnings.length) : 0,
  };
}

export function analyzeOcrRepairNeed(primaryScore, qualityHints = {}) {
  const hintReasons = normalizeQualityHintReasons(qualityHints);
  return {
    needsRepair: Boolean(primaryScore?.needsRepair || qualityHintsNeedRepair(qualityHints)),
    reasons: [...(Array.isArray(primaryScore?.reasons) ? primaryScore.reasons : []), ...hintReasons],
  };
}

export function qualityHintsNeedRepair(qualityHints = {}) {
  return Boolean(qualityHints?.needsRepair || normalizeQualityHintReasons(qualityHints).length);
}

export function normalizeQualityHintReasons(qualityHints = {}) {
  if (Array.isArray(qualityHints?.reasons)) {
    return qualityHints.reasons.filter(Boolean).map(String);
  }
  return [];
}

export function evaluateOcrRepairResult(providerResult, { pageCount, score } = {}) {
  const repairScore = score || scoreOcrProviderResult(providerResult, { pageCount });
  const coverage = summarizePageCoverage(providerResult, pageCount);
  const valid = repairScore.usable && coverage.valid;
  return {
    valid,
    score: repairScore,
    coverage,
    reason: invalidRepairReason(repairScore, coverage),
  };
}

export function summarizePageCoverage(providerResult, pageCount) {
  const pages = Array.isArray(providerResult?.pages) ? providerResult.pages : [];
  const expectedPages = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : pages.length;
  const seen = new Set();
  let textPages = 0;
  let valid = true;

  for (const page of pages) {
    const pageNumber = Number(page?.page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || (expectedPages > 0 && pageNumber > expectedPages) || seen.has(pageNumber)) {
      valid = false;
      continue;
    }
    seen.add(pageNumber);
    if (pageHasText(page)) textPages += 1;
  }

  if (expectedPages > 0 && seen.size < expectedPages) valid = false;
  return { valid, textPages, expectedPages };
}

export function withProviderWarning(providerResult, warning) {
  const pages = Array.isArray(providerResult?.pages) ? providerResult.pages : [];
  if (!pages.length) return providerResult;
  const firstPage = pages[0] || {};
  return {
    ...providerResult,
    pages: [
      {
        ...firstPage,
        warnings: [...(Array.isArray(firstPage.warnings) ? firstPage.warnings : []), warning],
      },
      ...pages.slice(1),
    ],
  };
}

export function withOcrPipeline(providerResult, pipeline) {
  return {
    ...providerResult,
    pipeline,
  };
}

export function invalidRepairReason(score, coverage) {
  const reasons = [];
  if (!coverage.valid) reasons.push("repair output did not cover every page exactly once");
  if (!score.usable) reasons.push("repair output had no usable OCR text");
  if (!reasons.length) reasons.push("repair output failed hard validity checks");
  return reasons.join("; ");
}

export function classifyConfidenceStatus(pages = []) {
  const values = pages.map((page) => page?.confidence_avg);
  const known = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return "";
  if (known.length === 0) return "unknown";
  if (known.some((value) => value < 0.75)) return "low";
  if (known.length < values.length) return "partial";
  return "ok";
}

export function isKnownLowConfidence(value) {
  return typeof value === "number" && Number.isFinite(value) && value < 0.75;
}

function isOcrPlaceholderRecord(record) {
  const pages = Array.isArray(record?.pages) ? record.pages : [];
  return pages.length > 0
    && pages.every((page) => page.ocr_required === true && (!Array.isArray(page.blocks) || page.blocks.length === 0));
}

function pageHasText(page) {
  if (Array.isArray(page?.blocks)) {
    return page.blocks.some((block) => String(block?.text ?? block?.markdown ?? "").trim());
  }
  return String(page?.markdown ?? page?.text ?? "").trim().length > 0;
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeOcrRepairNeed,
  buildExtractionOcrObservability,
  canUseCachedPdfOcrExtraction,
  classifyConfidenceStatus,
  evaluateOcrRepairResult,
  hasWeakCachedOcr,
} from "../extract-utils/ocr-policy.mjs";
import { buildPdfTextLayerQualityHints } from "../extract-utils/pdf-ocr-hints.mjs";
import { PDF_ENGINE_FINGERPRINT } from "../extract-utils/pdf-extract.mjs";

test("OCR policy invalidates cached pdfjs records when OCR is configured", () => {
  const cached = {
    engine: PDF_ENGINE_FINGERPRINT,
    extraction_strategy: "pdf-text-layer",
    pages: [{ page: 1, ocr_required: false, confidence_avg: 1, blocks: [{ text: "embedded text" }] }],
  };

  assert.equal(canUseCachedPdfOcrExtraction(cached, {
    ocrProviderAvailable: true,
    pdfEngineFingerprint: PDF_ENGINE_FINGERPRINT,
  }), false);
});

test("OCR policy invalidates weak cached OCR records", () => {
  const cached = {
    engine: "mistral-ocr-latest",
    extraction_strategy: "ocr-first",
    page_count: 1,
    pages: [{
      page: 1,
      ocr_required: true,
      confidence_avg: null,
      needs_review: false,
      blocks: [{ text: "Agreement dated 20 April 2026 records payment of Rs. 10,00,000." }],
    }],
  };

  assert.equal(hasWeakCachedOcr(cached), true);
  assert.equal(canUseCachedPdfOcrExtraction(cached, {
    ocrProviderAvailable: true,
    pdfEngineFingerprint: PDF_ENGINE_FINGERPRINT,
  }), false);
});

test("OCR observability treats missing confidence as unknown, not low", () => {
  const record = {
    engine: "gemini-ocr:gemini-2.5-pro",
    page_count: 1,
    ocr_pipeline: { primary_model: "mistral-ocr-latest", repair_status: "used" },
    pages: [{
      page: 1,
      ocr_required: true,
      confidence_avg: null,
      needs_review: false,
      blocks: [{ text: "Readable OCR text." }],
    }],
  };

  assert.equal(classifyConfidenceStatus(record.pages), "unknown");
  assert.equal(buildExtractionOcrObservability(record).confidence_status, "unknown");
  assert.equal(buildExtractionOcrObservability(record).low_confidence_pages, 0);
});

test("OCR repair validity requires complete non-empty page coverage", () => {
  const valid = evaluateOcrRepairResult({
    pages: [
      { page: 1, markdown: "Page one text." },
      { page: 2, markdown: "Page two text." },
    ],
  }, { pageCount: 2 });
  const missing = evaluateOcrRepairResult({
    pages: [{ page: 1, markdown: "Page one text." }],
  }, { pageCount: 2 });
  const empty = evaluateOcrRepairResult({
    pages: [
      { page: 1, markdown: "" },
      { page: 2, markdown: "" },
    ],
  }, { pageCount: 2 });

  assert.equal(valid.valid, true);
  assert.equal(missing.valid, false);
  assert.match(missing.reason, /cover every page/);
  assert.equal(empty.valid, false);
  assert.match(empty.reason, /no usable OCR text/);
});

test("OCR repair reasons combine provider doubt with text-layer layout hints", () => {
  const hints = buildPdfTextLayerQualityHints({
    pages: [{
      page: 1,
      needs_review: true,
      blocks: [{ text: "thin" }],
    }],
    multiColumnPageCount: 1,
  });
  const decision = analyzeOcrRepairNeed(
    { needsRepair: true, reasons: ["1 page(s) with unknown confidence"] },
    hints,
  );

  assert.equal(decision.needsRepair, true);
  assert.ok(decision.reasons.some((reason) => reason.includes("unknown confidence")));
  assert.ok(decision.reasons.some((reason) => reason.includes("layout/read-order risk")));
});

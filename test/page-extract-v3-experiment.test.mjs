import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { captureCurrentV3Baseline, V3_BASELINE_SCHEMA } from "../experiments/page-extract-v3/lib/baseline.mjs";
import { classifyNativePage } from "../experiments/page-extract-v3/lib/page-inspector.mjs";
import { comparePageText } from "../experiments/page-extract-v3/lib/reference-comparison.mjs";
import { buildV3RoutePlan, V3_ROUTE_PLAN_SCHEMA } from "../experiments/page-extract-v3/lib/route-plan.mjs";

const SECRET_REFERENCE_TEXT = "Client paid Rs. 1,00,000 on 20/04/2026 under Section 42.";

test("page extract v3 freezes a sanitized current baseline with measured critical path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-page-v3-"));
  const sessionId = "current-reference";
  const sessionRoot = path.join(root, "sessions", sessionId);
  const outFile = path.join(root, "evidence", "baseline.json");
  try {
    await mkdir(path.join(sessionRoot, "extracted"), { recursive: true });
    await writeJson(path.join(sessionRoot, "session.json"), syntheticSession(sessionId));
    await writeJson(path.join(sessionRoot, "extracted", "000000.json"), pdfRecord({ repairStatus: "used" }));
    await writeJson(path.join(sessionRoot, "extracted", "000001.json"), pdfRecord({ repairStatus: "failed" }));
    await writeJson(path.join(sessionRoot, "extracted", "000002.json"), docxRecord());

    const baseline = await captureCurrentV3Baseline({ v2Root: root, sessionId, outFile });
    assert.equal(baseline.schemaVersion, V3_BASELINE_SCHEMA);
    assert.equal(baseline.workload.realFiles, 3);
    assert.equal(baseline.workload.uniqueRealFiles, 2);
    assert.equal(baseline.workload.duplicateFiles, 1);
    assert.equal(baseline.workload.pdf.files, 2);
    assert.equal(baseline.workload.pdf.pages, 4);
    assert.equal(baseline.workload.pdf.noTextLayerPages, 2);
    assert.equal(baseline.workload.pdf.layoutRiskPages, 2);
    assert.deepEqual(baseline.pipeline.repairStatuses, { used: 1, failed: 1 });
    assert.equal(baseline.pipeline.repairFailures.timeout, 1);
    assert.equal(baseline.timing.exactCriticalPathSample.files, 3);
    assert.equal(baseline.timing.exactCriticalPathSample.cumulativeFileMs, 1920);
    assert.equal(baseline.timing.exactCriticalPathSample.provider.byProvider.gemini.latencyMs.sum, 1700);
    assert.equal(baseline.timing.exactCriticalPathSample.provider.byProvider.mistral.latencyMs.sum, 100);
    assert.equal(baseline.timing.exactCriticalPathSample.localParseNormalizeWriteMs, 120);
    assert.equal(baseline.reference.documents[0].pageReferences.length, 2);
    assert.equal(baseline.reference.containsDocumentText, false);
    assert.ok(baseline.reference.documents[0].criticalTokenCount >= 5);

    const serialized = await readFile(outFile, "utf8");
    assert.doesNotMatch(serialized, /Client paid/);
    assert.doesNotMatch(serialized, /folder\/confidential/i);
    assert.match(await readFile(outFile.replace(/\.json$/, ".md"), "utf8"), /Current Reference Baseline/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("page extract v3 routes only trustworthy native pages without treating unknown provider confidence as a routing signal", () => {
  const safe = classifyNativePage({
    text: "This agreement records the parties, consideration, obligations, representations, warranties, remedies, notices, governing law, jurisdiction, dates, amounts and signatures in ordinary reading order.",
    lines: [
      { text: "This agreement records the parties and consideration." },
      { text: "The remaining provisions record obligations and remedies." },
      { text: "Notices, governing law and jurisdiction follow." },
    ],
    multiColumn: false,
  });
  assert.equal(safe.route, "native");
  assert.deepEqual(safe.reasons, []);

  assert.deepEqual(classifyNativePage({ text: "", lines: [] }).reasons, ["no_embedded_text", "too_few_words"]);
  assert.match(classifyNativePage({ text: "enough ".repeat(40), lines: [{ text: "enough" }], multiColumn: true }).reasons.join(" "), /layout/);
});

test("page extract v3 compares critical legal tokens separately from general text", () => {
  const comparison = comparePageText(
    "Order under Section 42 records Rs. 1,00,000 on 20/04/2026.",
    "The order under Section 42 records payment of Rs. 1,00,000 on 20/04/2026.",
  );
  assert.equal(comparison.criticalTokenRecall, 1);
  assert.ok(comparison.tokenRecall < 1);
  assert.ok(comparison.tokenF1 > 0.7);
});

test("page extract v3 produces a sanitized no-provider routing replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-page-v3-route-"));
  const sessionId = "route-reference";
  const sessionRoot = path.join(root, "sessions", sessionId);
  const outFile = path.join(root, "evidence", "route.json");
  try {
    const session = syntheticSession(sessionId);
    await mkdir(path.join(sessionRoot, "extracted"), { recursive: true });
    await writeJson(path.join(sessionRoot, "session.json"), session);
    await writeJson(path.join(sessionRoot, "extracted", "000000.json"), pdfRecord({ repairStatus: "used" }));
    const report = await buildV3RoutePlan({
      v2Root: root,
      sessionId,
      outFile,
      inspectPdf: async () => ({
        pageCount: 2,
        bytes: 10,
        pages: [
          {
            page: 1,
            nativeText: SECRET_REFERENCE_TEXT,
            route: "native",
            reasons: [],
            diagnostics: { characters: 50, words: 10, lines: 2, multiColumn: false },
          },
          {
            page: 2,
            nativeText: "",
            route: "primary_ocr",
            reasons: ["no_embedded_text"],
            diagnostics: { characters: 0, words: 0, lines: 0, multiColumn: false },
          },
        ],
      }),
    });
    assert.equal(report.schemaVersion, V3_ROUTE_PLAN_SCHEMA);
    assert.equal(report.workload.uniquePdfFiles, 1);
    assert.equal(report.workload.duplicatePdfFiles, 1);
    assert.equal(report.routing.nativePages, 1);
    assert.equal(report.routing.primaryOcrPages, 1);
    assert.equal(report.referenceComparison.fullCriticalTokenRecallPages, 1);
    assert.equal(report.measurement.providerCalls, 0);
    assert.equal(report.projectedPrimaryOcrCost.avoidedPages, 1);
    const serialized = await readFile(outFile, "utf8");
    assert.doesNotMatch(serialized, /Client paid/);
    assert.doesNotMatch(serialized, /confidential-a/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function syntheticSession(id) {
  return {
    id,
    state: "complete",
    files: [
      sourceFile(0, "folder/confidential-a.pdf", "a".repeat(64), {
        status: "succeeded", engine: "gemini-ocr:gemini-2.5-pro", pageCount: 2, durationMs: 1000, providerCalls: 2,
      }),
      sourceFile(1, "folder/confidential-copy.pdf", "a".repeat(64), {
        status: "succeeded", engine: "mistral-ocr-latest", pageCount: 2, durationMs: 900, providerCalls: 2,
      }),
      sourceFile(2, "folder/confidential.docx", "b".repeat(64), {
        status: "succeeded", engine: "mammoth@1.12.0", pageCount: 1, durationMs: 20, providerCalls: 0,
      }),
      {
        index: 3,
        relativePath: ".DS_Store",
        sourceKind: "filtered-placeholder",
        commitDisposition: "filtered",
        expectedBytes: 10,
        sha256: "c".repeat(64),
        extraction: { status: "skipped", durationMs: 0 },
      },
    ],
    metrics: {
      uploadRuns: [{ activeMs: 50, uploadedBytes: 30, peakRssBytes: 10 }],
      extractionRuns: [{
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:02.000Z",
        activeMs: 2000,
        peakRssBytes: 100,
        provider: {
          totalCalls: 4,
          successfulCalls: 3,
          failedCalls: 1,
          byProvider: {
            mistral: {
              calls: 2,
              succeededCalls: 2,
              failedCalls: 0,
              pagesProcessed: 4,
              latencyMs: { count: 2, sum: 100, min: 40, max: 60, mean: 50 },
              estimatedCostUsd: 0.016,
            },
            gemini: {
              calls: 2,
              succeededCalls: 1,
              failedCalls: 1,
              latencyMs: { count: 2, sum: 1700, min: 700, max: 1000, mean: 850 },
              estimatedCostUsd: 0.2,
            },
          },
        },
      }],
    },
  };
}

function sourceFile(index, relativePath, sha256, extraction) {
  return {
    index,
    relativePath,
    sourceKind: "real",
    commitDisposition: "ready",
    expectedBytes: 10,
    sha256,
    extraction: {
      ...extraction,
      finishedAt: `2026-01-01T00:00:01.${index}00Z`,
      outputTextBytes: 100,
    },
  };
}

function pdfRecord({ repairStatus }) {
  return {
    engine: repairStatus === "used" ? "gemini-ocr:gemini-2.5-pro" : "mistral-ocr-latest",
    page_count: 2,
    ocr_pipeline: {
      primary_model: "mistral-ocr-latest",
      repair_model: "gemini-ocr:gemini-2.5-pro",
      repair_status: repairStatus,
      repair_reason: repairStatus === "failed"
        ? "Gemini OCR request timed out after 180000ms"
        : "2 page(s) with unknown confidence; 1 page(s) had no reliable embedded text layer; 1 page(s) had layout/read-order risk in embedded text",
      final_model: repairStatus === "used" ? "gemini-ocr:gemini-2.5-pro" : "mistral-ocr-latest",
    },
    warnings: [
      "page 1: no text layer; OCR required",
      "page 2: tabular or multi-column layout detected; reading order may be wrong",
    ],
    pages: [
      { page: 1, blocks: [{ text: SECRET_REFERENCE_TEXT }], confidence_avg: 0.9, warnings: [] },
      { page: 2, blocks: [{ text: "Order dated 2026-05-01." }], confidence_avg: 0.8, warnings: [] },
    ],
  };
}

function docxRecord() {
  return {
    engine: "mammoth@1.12.0",
    page_count: 1,
    pages: [{ page: 1, blocks: [{ text: "Native document text" }], confidence_avg: 1 }],
    warnings: [],
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

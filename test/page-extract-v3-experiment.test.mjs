import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { captureCurrentV3Baseline, V3_BASELINE_SCHEMA } from "../experiments/page-extract-v3/lib/baseline.mjs";
import { buildBalancedPageBatches } from "../experiments/page-extract-v3/lib/batching.mjs";
import { prepareCachedPrimaryTasks, runCurrentProviderCandidate } from "../experiments/page-extract-v3/lib/current-candidate-runner.mjs";
import { classifyPageImages, parsePdfImagesList } from "../experiments/page-extract-v3/lib/pdf-image-inspector.mjs";
import { classifyNativePage } from "../experiments/page-extract-v3/lib/page-inspector.mjs";
import { evaluatePrimaryPage } from "../experiments/page-extract-v3/lib/page-quality.mjs";
import { runRepairProviderTask } from "../experiments/page-extract-v3/lib/provider-task-runner.mjs";
import { comparePageText } from "../experiments/page-extract-v3/lib/reference-comparison.mjs";
import { buildV3RoutePlan, V3_ROUTE_PLAN_SCHEMA } from "../experiments/page-extract-v3/lib/route-plan.mjs";
import { sha256 } from "../experiments/page-extract-v3/lib/util.mjs";

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
  assert.match(classifyNativePage({
    text: "enough ".repeat(40),
    lines: [{ text: "enough" }],
    images: { imageCount: 1, largeImageCount: 1, maximumImagePixels: 1_000_000 },
  }).reasons.join(" "), /large_raster_image/);
  assert.match(classifyNativePage({
    text: `Ordinary text ${String.fromCodePoint(0xF020)} followed by a custom-font private glyph `.repeat(8),
    lines: [{ text: "Ordinary text" }],
  }).reasons.join(" "), /invalid_unicode/);
  assert.match(classifyNativePage({
    text: "Subject date sender recipient Subject date sender recipient Subject date sender recipient additional ordinary document wording follows here",
    lines: [{ text: "Subject date sender recipient" }],
  }).reasons.join(" "), /duplicate_text_layer/);
  assert.match(classifyNativePage({
    text: "ordinary complete document text ".repeat(12),
    lines: [{ text: "ordinary complete document text" }],
    annotations: { count: 1, contentBearingCount: 1 },
  }).reasons.join(" "), /form_or_annotation/);
});

test("page extract v3 uses cheap pdfimages metadata instead of rendering images during preflight", () => {
  const pages = parsePdfImagesList([
    "page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio",
    "1 0 image 2032 3264 rgb 3 8 jpeg yes 5 0 327 326 665K 3.4%",
    "1 1 smask 100 100 gray 1 8 image no 6 0 72 72 1K 1%",
    "2 2 image 120 80 rgb 3 8 jpeg no 7 0 72 72 2K 2%",
  ].join("\n"));
  assert.equal(pages[1].imageCount, 1);
  assert.equal(pages[1].maximumImagePixels, 2032 * 3264);
  assert.equal(classifyPageImages(pages[1]).largeImageCount, 1);
  assert.equal(classifyPageImages(pages[2]).largeImageCount, 0);
});

test("page extract v3 balances weighted page units without arbitrary fixed-size document batches", () => {
  const units = [900, 800, 700, 200, 100, 50].map((bytes, index) => ({ documentId: `d${index}`, page: 1, bytes }));
  const batches = buildBalancedPageBatches(units, { maxPages: 2, maxBytes: 2_000, minimumBatches: 3 });
  assert.equal(batches.length, 3);
  assert.equal(batches.flatMap((batch) => batch.units).length, units.length);
  assert.ok(batches.every((batch) => batch.units.length <= 2));
  const weights = batches.map((batch) => batch.weight);
  assert.ok(Math.max(...weights) / Math.min(...weights) < 1.25);
});

test("page extract v3 does not escalate primary OCR solely because confidence is absent", () => {
  const accepted = evaluatePrimaryPage({
    providerPage: { markdown: "Order under Section 42 records Rs. 1,00,000 on 20/04/2026.", warnings: ["page contains 2 extracted image placeholder(s)"] },
    nativeText: "Order under Section 42 records Rs. 1,00,000 on 20/04/2026.",
  });
  assert.equal(accepted.needsRepair, false);
  assert.equal(accepted.diagnostics.confidenceKnown, false);
  assert.equal(accepted.diagnostics.imagePlaceholderWarningCount, 1);
  assert.equal(accepted.diagnostics.materialWarningCount, 0);

  const materialWarning = evaluatePrimaryPage({
    providerPage: { markdown: "Order text", warnings: ["provider page normalization failed"] },
  });
  assert.equal(materialWarning.needsRepair, true);
  assert.match(materialWarning.reasons.join(" "), /provider_warning/);

  const rejected = evaluatePrimaryPage({
    providerPage: { markdown: "Order records payment.", warnings: [] },
    nativeText: "Order under Section 42 records Rs. 1,00,000 on 20/04/2026.",
  });
  assert.equal(rejected.needsRepair, true);
  assert.match(rejected.reasons.join(" "), /critical_token/);
});

test("page extract v3 checkpoints a Gemini 3.7 repair task and resumes without a second paid call", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-page-v3-provider-"));
  const resultFile = path.join(root, "repair.json");
  let calls = 0;
  const task = {
    id: "repair-1",
    index: 0,
    pdfPath: path.join(root, "input.pdf"),
    units: [{ documentId: "doc", page: 4, sourceSha256: "a".repeat(64) }],
  };
  try {
    const options = {
      task,
      resultFile,
      model: "gemini-3.7-flash",
      thinkingLevel: "LOW",
      env: { GEMINI_API_KEY: "test" },
      providerFactory: () => async () => {
        calls += 1;
        return { engine: "gemini-ocr:gemini-3.7-flash", pages: [{ page: 1, markdown: "Repaired page" }] };
      },
    };
    const first = await runRepairProviderTask(options);
    const resumed = await runRepairProviderTask(options);
    assert.equal(first.status, "succeeded");
    assert.equal(first.model, "gemini-3.7-flash");
    assert.equal(first.pages[0].page, 4);
    assert.equal(resumed.resumed, true);
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("page extract v3 reconstructs cached primary task boundaries exactly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-page-v3-cache-"));
  const cacheResultDir = path.join(root, "cache");
  try {
    await mkdir(cacheResultDir, { recursive: true });
    const units = [1, 2, 3].map((page) => ({
      documentId: "doc",
      page,
      sourceSha256: "a".repeat(64),
      filePath: path.join(root, `${page}.pdf`),
      bytes: page * 10,
      complexity: 1,
    }));
    await writeJson(path.join(cacheResultDir, "primary-1.json"), {
      taskId: "primary-0001-a",
      providerName: "mistral",
      status: "succeeded",
      units: [{ documentId: "doc", page: 2 }, { documentId: "doc", page: 1 }],
    });
    await writeJson(path.join(cacheResultDir, "primary-2.json"), {
      taskId: "primary-0002-b",
      providerName: "mistral",
      status: "succeeded",
      units: [{ documentId: "doc", page: 3 }],
    });
    const tasks = await prepareCachedPrimaryTasks({
      units,
      candidateRoot: path.join(root, "candidate"),
      cacheResultDir,
      concurrency: 1,
      combinePages: async ({ units: taskUnits, outFile }) => {
        await writeFile(outFile, "pdf");
        assert.ok(taskUnits.length > 0);
      },
    });
    assert.deepEqual(tasks.map((task) => task.id), ["primary-0001-a", "primary-0002-b"]);
    assert.deepEqual(tasks[0].units.map((unit) => unit.page), [2, 1]);
    assert.deepEqual(tasks[1].units.map((unit) => unit.page), [3]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("page extract v3 current-provider runner assembles checkpointed native and primary pages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-page-v3-current-"));
  const v2Root = path.join(root, "v2");
  const candidateRoot = path.join(root, "v3");
  const sessionId = "candidate-source";
  const sessionRoot = path.join(v2Root, "sessions", sessionId);
  const routePlanFile = path.join(root, "route-plan.json");
  try {
    await mkdir(path.join(sessionRoot, "extracted"), { recursive: true });
    const session = syntheticSession(sessionId);
    await writeJson(path.join(sessionRoot, "session.json"), session);
    await writeJson(path.join(sessionRoot, "extracted", "000000.json"), pdfRecord({ repairStatus: "used" }));
    const routePlan = {
      schemaVersion: V3_ROUTE_PLAN_SCHEMA,
      fingerprintSha256: "plan-fingerprint",
      source: { sessionId },
      policy: {},
      workload: { duplicatePdfFiles: 1 },
      routing: { nativePages: 1, primaryOcrPages: 1 },
      documents: [{
        documentId: "candidate-doc",
        sourceIndex: 0,
        sourceSha256: "a".repeat(64),
        status: "inspected",
        pageCount: 2,
        pages: [
          { page: 1, route: "native", nativeTextSha256: sha256(SECRET_REFERENCE_TEXT) },
          { page: 2, route: "primary_ocr", nativeTextSha256: sha256("") },
        ],
      }],
    };
    await writeJson(routePlanFile, routePlan);
    const report = await runCurrentProviderCandidate({
      v2Root,
      routePlanFile,
      root: candidateRoot,
      candidateId: "candidate",
      env: { MISTRAL_API_KEY: "m", GEMINI_API_KEY: "g" },
      inspectPdf: async () => ({
        pageCount: 2,
        pages: [
          { page: 1, route: "native", reasons: [], diagnostics: {}, nativeText: SECRET_REFERENCE_TEXT, nativeBlocks: [{ text: SECRET_REFERENCE_TEXT }] },
          { page: 2, route: "primary_ocr", reasons: ["no_embedded_text"], diagnostics: {}, nativeText: "", nativeBlocks: [] },
        ],
      }),
      preparePages: async ({ outDir }) => {
        await mkdir(outDir, { recursive: true });
        const pages = [];
        for (const page of [1, 2]) {
          const filePath = path.join(outDir, `page-${page}.pdf`);
          await writeFile(filePath, `page-${page}`);
          pages.push({ page, filePath, bytes: 6 });
        }
        return { pageCount: 2, pages };
      },
      combinePages: async ({ outFile }) => {
        await mkdir(path.dirname(outFile), { recursive: true });
        await writeFile(outFile, "combined");
        return { filePath: outFile, bytes: 8 };
      },
      primaryTaskRunner: async ({ task }) => ({
        status: "succeeded", attempts: 1, durationMs: 10, resumed: false,
        pages: task.units.map((unit) => ({ documentId: unit.documentId, page: unit.page, providerPage: { page: 1, markdown: "Order dated 2026-05-01.", warnings: [] } })),
        provider: { totalCalls: 1, successfulCalls: 1, failedCalls: 0, byProvider: { mistral: { calls: 1, succeededCalls: 1, failedCalls: 0, pagesProcessed: 1, inputTokens: 0, outputTokens: 0, latencyMs: { count: 1, mean: 10 }, estimatedCostUsd: 0.004 } } },
      }),
      repairTaskRunner: async () => { throw new Error("repair should not run"); },
    });
    assert.equal(report.workload.outputPages, 2);
    assert.equal(report.workload.missingPages, 0);
    assert.deepEqual(report.routing.selectedPageSources, { native: 1, primary: 1 });
    assert.equal(report.tasks.primary.tasks, 1);
    assert.equal(report.tasks.repair.tasks, 0);
    assert.equal(report.provider.totalCalls, 1);
    assert.equal(report.verdict.everyExpectedPageProduced, true);
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

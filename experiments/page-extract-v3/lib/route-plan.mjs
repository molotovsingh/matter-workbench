import path from "node:path";
import { performance } from "node:perf_hooks";

import { inspectPdfPages } from "./page-inspector.mjs";
import { comparePageText, pageText, summarizePageComparisons } from "./reference-comparison.mjs";
import {
  atomicWriteFile,
  atomicWriteJson,
  countBy,
  mapWithConcurrency,
  readJson,
  readJsonIfExists,
  safeId,
  sha256,
  summarizeNumbers,
} from "./util.mjs";

export const V3_ROUTE_PLAN_SCHEMA = "page-extract-v3/route-plan-v1";

export async function buildV3RoutePlan({
  v2Root,
  sessionId,
  outFile,
  concurrency = 2,
  policy = {},
  inspectPdf = inspectPdfPages,
  onProgress = () => {},
} = {}) {
  if (!v2Root) throw new Error("v2 root is required");
  if (!outFile) throw new Error("output file is required");
  const id = safeId(sessionId, "session id");
  const root = path.resolve(v2Root);
  const sessionRoot = path.join(root, "sessions", id);
  const session = await readJson(path.join(sessionRoot, "session.json"));
  const seenSha = new Set();
  const uniquePdfs = [];
  let duplicatePdfs = 0;

  for (const file of session.files) {
    if (file.sourceKind !== "real" || file.commitDisposition !== "ready") continue;
    if (path.extname(String(file.relativePath || "")).toLowerCase() !== ".pdf") continue;
    if (seenSha.has(file.sha256)) {
      duplicatePdfs += 1;
      continue;
    }
    seenSha.add(file.sha256);
    uniquePdfs.push(file);
  }

  const boundedConcurrency = Math.min(8, Math.max(1, Math.trunc(Number(concurrency) || 2)));
  const started = performance.now();
  let peakRssBytes = process.memoryUsage().rss;
  const memoryTimer = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 100);
  memoryTimer.unref?.();
  let completed = 0;
  let documents;
  try {
    documents = await mapWithConcurrency(uniquePdfs, boundedConcurrency, async (file) => {
      const result = await inspectDocument({ sessionRoot, sessionId: id, file, policy, inspectPdf });
      completed += 1;
      onProgress({ completedFiles: completed, attemptedFiles: uniquePdfs.length, status: result.status });
      return result;
    });
  } finally {
    clearInterval(memoryTimer);
  }

  const pages = documents.flatMap((document) => document.pages || []);
  const nativePages = pages.filter((page) => page.route === "native");
  const primaryPages = pages.filter((page) => page.route === "primary_ocr");
  const comparisons = nativePages.map((page) => page.referenceComparison).filter(Boolean);
  const reasonCounts = {};
  for (const page of primaryPages) {
    for (const reason of page.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  const totalPages = pages.length;
  const currentMistralCost = totalPages * 0.004;
  const routedMistralCost = primaryPages.length * 0.004;
  const report = {
    schemaVersion: V3_ROUTE_PLAN_SCHEMA,
    generatedAt: new Date().toISOString(),
    source: {
      experiment: "upload-extract-v2",
      sessionId: id,
    },
    policy: normalizedPolicy(policy),
    workload: {
      uniquePdfFiles: uniquePdfs.length,
      duplicatePdfFiles: duplicatePdfs,
      inspectedPdfFiles: documents.filter((document) => document.status === "inspected").length,
      failedPdfFiles: documents.filter((document) => document.status === "failed").length,
      totalPages,
      sourceBytes: uniquePdfs.reduce((sum, file) => sum + (Number(file.expectedBytes) || 0), 0),
    },
    routing: {
      nativePages: nativePages.length,
      primaryOcrPages: primaryPages.length,
      nativeShare: totalPages ? nativePages.length / totalPages : 0,
      reasonCounts,
      nativePageCharacters: summarizeNumbers(nativePages.map((page) => page.diagnostics.characters)),
      primaryPageCharacters: summarizeNumbers(primaryPages.map((page) => page.diagnostics.characters)),
    },
    referenceComparison: summarizePageComparisons(comparisons),
    projectedPrimaryOcrCost: {
      pricingAssumption: "Mistral OCR at $4 per 1,000 submitted pages",
      currentAllPageCostUsd: currentMistralCost,
      routedPageCostUsd: routedMistralCost,
      avoidedPages: Math.max(0, totalPages - primaryPages.length),
      avoidedCostUsd: Math.max(0, currentMistralCost - routedMistralCost),
      excludesRepairCost: true,
    },
    measurement: {
      wallMs: Math.round(performance.now() - started),
      concurrency: boundedConcurrency,
      peakRssBytes,
      providerCalls: 0,
    },
    documents,
  };
  report.fingerprintSha256 = sha256(JSON.stringify({
    policy: report.policy,
    documents: documents.map((document) => ({
      documentId: document.documentId,
      status: document.status,
      pages: document.pages.map((page) => ({ page: page.page, route: page.route, reasons: page.reasons })),
    })),
  }));

  const jsonPath = path.resolve(outFile);
  await atomicWriteJson(jsonPath, report);
  await atomicWriteFile(jsonPath.replace(/\.json$/i, "") + ".md", renderMarkdown(report));
  return report;
}

async function inspectDocument({ sessionRoot, sessionId, file, policy, inspectPdf }) {
  const documentId = sha256(`${sessionId}\0${file.sha256 || ""}\0${Number(file.index)}`).slice(0, 24);
  const referenceRecord = await readJsonIfExists(path.join(sessionRoot, "extracted", `${padIndex(file.index)}.json`));
  try {
    const inspection = await inspectPdf({
      pdfPath: path.join(sessionRoot, "objects", `${padIndex(file.index)}.blob`),
      policy,
    });
    const referencePages = new Map((referenceRecord?.pages || []).map((page, index) => [normalizePageNumber(page?.page, index), page]));
    const pages = inspection.pages.map((page) => {
      const reference = referencePages.get(page.page);
      return {
        page: page.page,
        route: page.route,
        reasons: page.reasons,
        diagnostics: page.diagnostics,
        nativeTextSha256: sha256(page.nativeText),
        referenceComparison: reference ? comparePageText(page.nativeText, pageText(reference)) : null,
      };
    });
    return {
      documentId,
      sourceIndex: Number(file.index),
      sourceSha256: String(file.sha256 || ""),
      status: "inspected",
      pageCount: inspection.pageCount,
      sourceBytes: inspection.bytes,
      referenceEngine: String(referenceRecord?.engine || file.extraction?.engine || ""),
      pages,
      errorCategory: "",
    };
  } catch (error) {
    return {
      documentId,
      sourceIndex: Number(file.index),
      sourceSha256: String(file.sha256 || ""),
      status: "failed",
      pageCount: Number(file.extraction?.pageCount) || 0,
      sourceBytes: Number(file.expectedBytes) || 0,
      referenceEngine: String(referenceRecord?.engine || file.extraction?.engine || ""),
      pages: [],
      errorCategory: classifyPdfError(error),
    };
  }
}

function normalizedPolicy(policy) {
  return {
    minimumCharacters: positive(policy.minimumCharacters, 120),
    minimumWords: positive(policy.minimumWords, 8),
    minimumCharactersForShortPage: positive(policy.minimumCharactersForShortPage, 240),
    maximumReplacementRatio: nonNegative(policy.maximumReplacementRatio, 0.005),
    maximumDuplicateLineRatio: nonNegative(policy.maximumDuplicateLineRatio, 0.35),
    maximumRepeatedNgramRatio: nonNegative(policy.maximumRepeatedNgramRatio, 0.08),
    minimumLargeImagePixels: positive(policy.minimumLargeImagePixels, 200_000),
  };
}

function classifyPdfError(error) {
  const value = String(error?.message || error || "").toLowerCase();
  if (value.includes("password")) return "password_protected";
  if (value.includes("invalid pdf") || value.includes("bad xref")) return "invalid_pdf";
  if (value.includes("enoent") || value.includes("read")) return "read_failed";
  return "pdf_inspection_failed";
}

function normalizePageNumber(value, index) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : index + 1;
}

function padIndex(value) {
  return String(Number(value)).padStart(6, "0");
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegative(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function renderMarkdown(report) {
  const routing = report.routing;
  const comparison = report.referenceComparison;
  const cost = report.projectedPrimaryOcrCost;
  return [
    "# Page Extract V3 — Native Routing Plan",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "> This is a read-only routing replay. It made no provider calls and does not claim candidate quality yet.",
    "",
    "## Workload",
    "",
    `- Unique / duplicate PDFs: ${report.workload.uniquePdfFiles} / ${report.workload.duplicatePdfFiles}`,
    `- Inspected / failed PDFs: ${report.workload.inspectedPdfFiles} / ${report.workload.failedPdfFiles}`,
    `- Pages: ${report.workload.totalPages}`,
    "",
    "## Routing",
    "",
    `- Native pages: ${routing.nativePages} (${formatPercent(routing.nativeShare)})`,
    `- Primary OCR pages: ${routing.primaryOcrPages}`,
    `- Reasons: ${JSON.stringify(routing.reasonCounts)}`,
    "",
    "## Native pages compared with current reference",
    "",
    `- Compared pages: ${comparison.pages}`,
    `- Exact normalized pages: ${comparison.exactNormalizedTextPages}`,
    `- Full critical-token recall pages: ${comparison.fullCriticalTokenRecallPages}`,
    `- Median token precision / recall / F1: ${formatPercent(comparison.tokenPrecision.p50)} / ${formatPercent(comparison.tokenRecall.p50)} / ${formatPercent(comparison.tokenF1.p50)}`,
    `- Pages below review threshold: ${comparison.pagesBelowReferenceReviewThreshold}`,
    "",
    "## Projected Mistral page cost",
    "",
    `- Current all-page cost: $${cost.currentAllPageCostUsd.toFixed(3)}`,
    `- Routed-page cost: $${cost.routedPageCostUsd.toFixed(3)}`,
    `- Avoided pages / cost: ${cost.avoidedPages} / $${cost.avoidedCostUsd.toFixed(3)}`,
    `- Repair cost: not yet projected`,
    "",
    "## Measurement",
    "",
    `- Inspection wall time: ${(report.measurement.wallMs / 1000).toFixed(3)}s`,
    `- Peak RSS: ${(report.measurement.peakRssBytes / (1024 * 1024)).toFixed(1)} MiB`,
    `- Provider calls: ${report.measurement.providerCalls}`,
    "",
  ].join("\n");
}

function formatPercent(value) {
  return `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)}%`;
}

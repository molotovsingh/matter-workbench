import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteFile,
  atomicWriteJson,
  countBy,
  elapsedMs,
  normalizeReferenceText,
  readJson,
  readJsonIfExists,
  safeId,
  sha256,
  summarizeNumbers,
} from "./util.mjs";

export const V3_BASELINE_SCHEMA = "page-extract-v3/current-reference-v1";

export async function captureCurrentV3Baseline({ v2Root, sessionId, outFile } = {}) {
  if (!v2Root) throw new Error("v2 root is required");
  if (!outFile) throw new Error("output file is required");
  const id = safeId(sessionId, "session id");
  const sessionRoot = path.join(path.resolve(v2Root), "sessions", id);
  const session = await readJson(path.join(sessionRoot, "session.json"));
  if (session.id !== id) throw new Error(`session id mismatch: expected ${id}`);

  const sourceFiles = session.files.filter((file) => file.sourceKind === "real");
  const extractable = sourceFiles.filter((file) => file.commitDisposition === "ready");
  const firstDocumentBySha = new Map();
  const documents = [];
  const records = new Map();

  for (const file of extractable) {
    const documentId = referenceDocumentId(id, file);
    const duplicateOf = firstDocumentBySha.get(file.sha256) || "";
    if (!duplicateOf) firstDocumentBySha.set(file.sha256, documentId);
    const record = await readJsonIfExists(path.join(sessionRoot, "extracted", `${padIndex(file.index)}.json`));
    if (record) records.set(file.index, record);
    documents.push(buildReferenceDocument({ documentId, duplicateOf, file, record }));
  }

  const extractionRuns = session.metrics?.extractionRuns || [];
  const uploadRuns = session.metrics?.uploadRuns || [];
  const timing = buildTimingEvidence({ extractable, extractionRuns, uploadRuns });
  const pipeline = buildPipelineEvidence({ documents, records, extractionRuns });
  const workload = buildWorkloadEvidence({ session, sourceFiles, extractable, documents, records });
  const referenceFingerprint = sha256(documents
    .filter((document) => !document.duplicateOf)
    .map((document) => `${document.documentId}:${document.normalizedTextSha256}:${document.status}`)
    .sort()
    .join("\n"));

  const baseline = {
    schemaVersion: V3_BASELINE_SCHEMA,
    generatedAt: new Date().toISOString(),
    purpose: "Frozen current whole-PDF Mistral-to-Gemini output used as the first V3 non-inferiority reference; it is not human-verified ground truth.",
    source: {
      experiment: "upload-extract-v2",
      sessionId: id,
      state: session.state,
    },
    workload,
    timing,
    pipeline,
    reference: {
      uniqueDocumentCount: documents.filter((document) => !document.duplicateOf).length,
      documentCountIncludingDuplicates: documents.length,
      fingerprintSha256: referenceFingerprint,
      containsDocumentText: false,
      documents,
    },
    acceptanceBoundary: {
      baselineIsGroundTruth: false,
      candidateMustAccountForEveryUniqueDocument: true,
      candidateMustPreservePageCoverage: true,
      candidateMustReportNamesDatesAmountsAndCitationsSeparately: true,
      candidateMustReportEveryProviderCallAndCost: true,
      byteIdenticalTextRequired: false,
    },
  };

  const jsonPath = path.resolve(outFile);
  const markdownPath = jsonPath.replace(/\.json$/i, "") + ".md";
  await atomicWriteJson(jsonPath, baseline);
  await atomicWriteFile(markdownPath, renderBaselineMarkdown(baseline));
  return baseline;
}

function buildReferenceDocument({ documentId, duplicateOf, file, record }) {
  const pages = Array.isArray(record?.pages) ? record.pages.map(buildReferencePage) : [];
  const normalizedText = normalizeReferenceText(pages.map((page) => page.normalizedTextForDigest).join("\n\n"));
  const criticalTokens = extractCriticalTokens(normalizedText);
  const extension = path.extname(String(file.relativePath || "")).toLowerCase();
  return {
    documentId,
    sourceIndex: Number(file.index),
    sourceSha256: String(file.sha256 || ""),
    duplicateOf,
    extension,
    status: String(file.extraction?.status || "unknown"),
    engine: String(file.extraction?.engine || record?.engine || ""),
    pageCount: Number(file.extraction?.pageCount ?? record?.page_count) || 0,
    durationMs: Number(file.extraction?.durationMs) || 0,
    providerCalls: Number(file.extraction?.providerCalls) || 0,
    textBytes: Number(file.extraction?.outputTextBytes) || Buffer.byteLength(normalizedText),
    normalizedTextSha256: sha256(normalizedText),
    normalizedTextCharacters: normalizedText.length,
    criticalTokenCount: criticalTokens.length,
    criticalTokenSetSha256: sha256(criticalTokens.join("\n")),
    pipeline: sanitizePipeline(record?.ocr_pipeline),
    pageReferences: pages.map(({ normalizedTextForDigest: _text, ...page }) => page),
  };
}

function buildReferencePage(page, index) {
  const text = normalizeReferenceText(pageText(page));
  const criticalTokens = extractCriticalTokens(text);
  return {
    page: normalizePageNumber(page?.page, index),
    normalizedTextSha256: sha256(text),
    normalizedTextCharacters: text.length,
    criticalTokenCount: criticalTokens.length,
    criticalTokenSetSha256: sha256(criticalTokens.join("\n")),
    warningCount: Array.isArray(page?.warnings) ? page.warnings.length : 0,
    confidenceKnown: Number.isFinite(Number(page?.confidence_avg ?? page?.confidence)),
    normalizedTextForDigest: text,
  };
}

function buildWorkloadEvidence({ session, sourceFiles, extractable, documents, records }) {
  const pdfDocuments = documents.filter((document) => document.extension === ".pdf");
  const pdfIndexes = new Set(pdfDocuments.map((document) => document.sourceIndex));
  let noTextLayerPages = 0;
  let layoutRiskPages = 0;
  let pageOpenFailures = 0;
  let textExtractionFailures = 0;
  const noTextFiles = new Set();
  const layoutRiskFiles = new Set();
  const thinTextFiles = new Set();

  for (const [fileIndex, record] of records) {
    if (!pdfIndexes.has(fileIndex)) continue;
    for (const warningValue of record?.warnings || []) {
      const warning = String(warningValue || "");
      if (warning.includes("no text layer; OCR required")) {
        noTextLayerPages += 1;
        noTextFiles.add(fileIndex);
      }
      if (warning.includes("tabular or multi-column layout detected")) {
        layoutRiskPages += 1;
        layoutRiskFiles.add(fileIndex);
      }
      if (warning.includes("failed to open")) pageOpenFailures += 1;
      if (warning.includes("text extraction failed")) textExtractionFailures += 1;
    }
    if (String(record?.ocr_pipeline?.repair_reason || "").includes("embedded text layer looked thin")) {
      thinTextFiles.add(fileIndex);
    }
  }

  const pdfPages = pdfDocuments.reduce((sum, document) => sum + document.pageCount, 0);
  return {
    uploadEntries: session.files.length,
    realFiles: sourceFiles.length,
    extractableRealFiles: extractable.length,
    uniqueRealFiles: documents.filter((document) => !document.duplicateOf).length,
    duplicateFiles: documents.filter((document) => document.duplicateOf).length,
    totalRealBytes: sourceFiles.reduce((sum, file) => sum + (Number(file.expectedBytes) || 0), 0),
    extensions: countBy(documents, (document) => document.extension || "none"),
    extractionStatuses: countBy(documents, (document) => document.status),
    pdf: {
      files: pdfDocuments.length,
      pages: pdfPages,
      noTextLayerPages,
      pagesWithEmbeddedText: Math.max(0, pdfPages - noTextLayerPages),
      layoutRiskPages,
      straightforwardNativePageCeiling: Math.max(0, pdfPages - noTextLayerPages - layoutRiskPages),
      noTextLayerFiles: noTextFiles.size,
      layoutRiskFiles: layoutRiskFiles.size,
      thinTextFiles: thinTextFiles.size,
      pageOpenFailures,
      textExtractionFailures,
    },
  };
}

function buildTimingEvidence({ extractable, extractionRuns, uploadRuns }) {
  const fileDurations = extractable.map((file) => Number(file.extraction?.durationMs) || 0);
  const pdfDurations = extractable
    .filter((file) => path.extname(String(file.relativePath || "")).toLowerCase() === ".pdf")
    .map((file) => Number(file.extraction?.durationMs) || 0);
  const exactRuns = extractionRuns.filter(hasExactProviderLatency);
  const exactWindows = exactRuns.map((run) => ({
    startedAt: Date.parse(String(run.startedAt || "")),
    finishedAt: Date.parse(String(run.finishedAt || "")),
  }));
  const exactFiles = extractable.filter((file) => timestampInWindows(file.extraction?.finishedAt, exactWindows));
  const exactFileMs = exactFiles.reduce((sum, file) => sum + (Number(file.extraction?.durationMs) || 0), 0);
  const exactProviderLatency = mergeLatencyEvidence(exactRuns.map((run) => run.provider || {}));
  const exactProviderMs = Object.values(exactProviderLatency.byProvider).reduce((sum, provider) => sum + provider.latencyMs.sum, 0);
  const localOtherMs = Math.max(0, exactFileMs - exactProviderMs);
  const denominator = exactFileMs || 1;

  return {
    uploadActiveMs: sum(uploadRuns, "activeMs"),
    extractionActiveMs: sum(extractionRuns, "activeMs"),
    extractionEndToEndMs: elapsedMs(extractionRuns[0]?.startedAt, extractionRuns.at(-1)?.finishedAt),
    peakRssBytes: max(extractionRuns, "peakRssBytes"),
    fileDurationMs: summarizeNumbers(fileDurations),
    pdfFileDurationMs: summarizeNumbers(pdfDurations),
    engineDurationMs: summarizeByEngine(extractable),
    exactCriticalPathSample: {
      extractionRuns: exactRuns.length,
      files: exactFiles.length,
      cumulativeFileMs: exactFileMs,
      provider: exactProviderLatency,
      localParseNormalizeWriteMs: localOtherMs,
      shares: {
        gemini: (exactProviderLatency.byProvider.gemini?.latencyMs.sum || 0) / denominator,
        mistral: (exactProviderLatency.byProvider.mistral?.latencyMs.sum || 0) / denominator,
        localParseNormalizeWrite: localOtherMs / denominator,
      },
    },
  };
}

function buildPipelineEvidence({ documents, records, extractionRuns }) {
  const repairStatuses = countBy(documents.filter((document) => document.pipeline.status), (document) => document.pipeline.status);
  const reasonFileCounts = {
    unknownConfidence: 0,
    providerWarning: 0,
    noReliableEmbeddedText: 0,
    layoutOrReadingOrderRisk: 0,
    thinEmbeddedText: 0,
    emptyPage: 0,
    suspiciousToken: 0,
  };
  const repairFailures = { timeout: 0, unavailable: 0, invalidArgument: 0, other: 0 };
  let onlyUnknownConfidence = 0;

  for (const record of records.values()) {
    const pipeline = record?.ocr_pipeline || {};
    const reason = String(pipeline.repair_reason || "");
    const flags = {
      unknownConfidence: reason.includes("unknown confidence"),
      providerWarning: reason.includes("provider warning"),
      noReliableEmbeddedText: reason.includes("no reliable embedded text layer") || reason.includes("no text layer"),
      layoutOrReadingOrderRisk: reason.includes("layout/read-order") || reason.includes("multi-column"),
      thinEmbeddedText: reason.includes("embedded text layer looked thin"),
      emptyPage: reason.includes("empty page"),
      suspiciousToken: reason.includes("suspicious OCR token"),
    };
    for (const [key, present] of Object.entries(flags)) if (present) reasonFileCounts[key] += 1;
    if (flags.unknownConfidence && Object.entries(flags).every(([key, present]) => key === "unknownConfidence" || !present)) {
      onlyUnknownConfidence += 1;
    }
    if (pipeline.repair_status === "failed") {
      const failure = classifyRepairFailure(reason);
      repairFailures[failure] += 1;
    }
  }

  return {
    design: "Every readable PDF was sent to whole-document Mistral OCR; the repair gate then sent every Mistral result to whole-document Gemini 2.5 Pro.",
    pdfProviderEligibleFiles: documents.filter((document) => document.extension === ".pdf" && document.status !== "failed").length,
    documentsWithProviderCalls: documents.filter((document) => document.providerCalls > 0).length,
    totalProviderCallsFromCheckpoints: documents.reduce((sum, document) => sum + document.providerCalls, 0),
    repairStatuses,
    repairReasonFileCounts: reasonFileCounts,
    repairUsedSolelyForUnknownConfidenceFiles: onlyUnknownConfidence,
    repairFailures,
    provider: mergeProviderSummaries(extractionRuns.map((run) => run.provider || {})),
  };
}

function sanitizePipeline(value) {
  const pipeline = value && typeof value === "object" ? value : {};
  return {
    primaryModel: String(pipeline.primary_model || ""),
    repairModel: String(pipeline.repair_model || ""),
    status: String(pipeline.repair_status || ""),
    finalModel: String(pipeline.final_model || ""),
  };
}

function hasExactProviderLatency(run) {
  const providers = Object.values(run?.provider?.byProvider || {}).filter((provider) => Number(provider.calls) > 0);
  return providers.length > 0 && providers.every((provider) => (
    Number(provider.latencyMs?.count) > 0
    && Number(provider.latencyMs?.count) === Number(provider.calls)
  ));
}

function mergeLatencyEvidence(summaries) {
  const result = { totalCalls: 0, byProvider: {} };
  for (const summary of summaries) {
    result.totalCalls += Number(summary.totalCalls) || 0;
    for (const [name, provider] of Object.entries(summary.byProvider || {})) {
      const target = result.byProvider[name] || {
        calls: 0,
        latencyMs: { count: 0, sum: 0, min: null, max: 0, mean: 0 },
      };
      target.calls += Number(provider.calls) || 0;
      target.latencyMs.count += Number(provider.latencyMs?.count) || 0;
      target.latencyMs.sum += Number(provider.latencyMs?.sum) || 0;
      const minimum = Number(provider.latencyMs?.min);
      if (Number.isFinite(minimum)) target.latencyMs.min = target.latencyMs.min === null ? minimum : Math.min(target.latencyMs.min, minimum);
      target.latencyMs.max = Math.max(target.latencyMs.max, Number(provider.latencyMs?.max) || 0);
      target.latencyMs.mean = target.latencyMs.count ? target.latencyMs.sum / target.latencyMs.count : 0;
      result.byProvider[name] = target;
    }
  }
  return result;
}

function mergeProviderSummaries(summaries) {
  const result = { totalCalls: 0, successfulCalls: 0, failedCalls: 0, byProvider: {} };
  for (const summary of summaries) {
    result.totalCalls += Number(summary.totalCalls) || 0;
    result.successfulCalls += Number(summary.successfulCalls) || 0;
    result.failedCalls += Number(summary.failedCalls) || 0;
    for (const [name, provider] of Object.entries(summary.byProvider || {})) {
      const target = result.byProvider[name] || {
        calls: 0,
        succeededCalls: 0,
        failedCalls: 0,
        pagesProcessed: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        costCoverageComplete: true,
      };
      for (const key of ["calls", "succeededCalls", "failedCalls", "pagesProcessed", "inputTokens", "outputTokens"]) {
        target[key] += Number(provider[key]) || 0;
      }
      if (provider.estimatedCostUsd === null || provider.estimatedCostUsd === undefined) {
        if (Number(provider.calls) > 0) target.costCoverageComplete = false;
      } else {
        target.estimatedCostUsd += Number(provider.estimatedCostUsd) || 0;
      }
      result.byProvider[name] = target;
    }
  }
  for (const provider of Object.values(result.byProvider)) {
    if (!provider.costCoverageComplete) provider.estimatedCostUsd = null;
  }
  return result;
}

function summarizeByEngine(files) {
  const result = {};
  for (const file of files) {
    const engine = String(file.extraction?.engine || "unknown");
    const target = result[engine] || { files: 0, cumulativeMs: 0 };
    target.files += 1;
    target.cumulativeMs += Number(file.extraction?.durationMs) || 0;
    result[engine] = target;
  }
  return Object.fromEntries(Object.entries(result).sort((left, right) => right[1].cumulativeMs - left[1].cumulativeMs));
}

function classifyRepairFailure(reason) {
  const value = String(reason || "").toLowerCase();
  if (value.includes("timed out")) return value.includes("503") ? "unavailable" : "timeout";
  if (value.includes("503") || value.includes("unavailable")) return "unavailable";
  if (value.includes("invalid argument") || value.includes("400")) return "invalidArgument";
  return "other";
}

function timestampInWindows(value, windows) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) && windows.some((window) => (
    Number.isFinite(window.startedAt)
    && Number.isFinite(window.finishedAt)
    && timestamp >= window.startedAt
    && timestamp <= window.finishedAt
  ));
}

function pageText(page) {
  if (Array.isArray(page?.blocks)) {
    return page.blocks.map((block) => String(block?.text ?? block?.markdown ?? "")).join("\n");
  }
  return String(page?.markdown ?? page?.text ?? "");
}

function extractCriticalTokens(text) {
  const patterns = [
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
    /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g,
    /(?:Rs\.?|INR|₹)\s*[\d,]+(?:\.\d+)?/gi,
    /\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b/g,
    /\b(?:section|article|clause|rule|order)\s+[\w()./-]+/gi,
  ];
  const tokens = [];
  for (const pattern of patterns) tokens.push(...(String(text || "").match(pattern) || []));
  return [...new Set(tokens.map((token) => token.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()))].sort();
}

function normalizePageNumber(value, index) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : index + 1;
}

function referenceDocumentId(sessionId, file) {
  return sha256(`${sessionId}\0${file.sha256 || ""}\0${Number(file.index)}`).slice(0, 24);
}

function padIndex(value) {
  return String(Number(value)).padStart(6, "0");
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

function max(items, key) {
  return items.reduce((greatest, item) => Math.max(greatest, Number(item?.[key]) || 0), 0);
}

function renderBaselineMarkdown(baseline) {
  const workload = baseline.workload;
  const timing = baseline.timing;
  const critical = timing.exactCriticalPathSample;
  const pipeline = baseline.pipeline;
  return [
    "# Page Extract V3 — Current Reference Baseline",
    "",
    `Generated: ${baseline.generatedAt}`,
    "",
    "> This is the current Mistral → Gemini output reference, not human-verified ground truth.",
    "",
    "## Workload",
    "",
    `- Upload entries / real files / unique files: ${workload.uploadEntries} / ${workload.extractableRealFiles} / ${workload.uniqueRealFiles}`,
    `- Duplicate files: ${workload.duplicateFiles}`,
    `- PDF files / pages: ${workload.pdf.files} / ${workload.pdf.pages}`,
    `- Pages without embedded text: ${workload.pdf.noTextLayerPages}`,
    `- Layout-risk pages: ${workload.pdf.layoutRiskPages}`,
    `- Straightforward native-page ceiling: ${workload.pdf.straightforwardNativePageCeiling}`,
    "",
    "## Timing",
    "",
    `- Upload active: ${formatMs(timing.uploadActiveMs)}`,
    `- Extraction active: ${formatMs(timing.extractionActiveMs)}`,
    `- Cumulative file processing: ${formatMs(timing.fileDurationMs.sum)}`,
    `- Peak RSS: ${formatBytes(timing.peakRssBytes)}`,
    "",
    "## Exact provider-latency sample",
    "",
    `- Runs / files: ${critical.extractionRuns} / ${critical.files}`,
    `- Gemini: ${formatMs(critical.provider.byProvider.gemini?.latencyMs.sum || 0)} (${formatPercent(critical.shares.gemini)})`,
    `- Mistral: ${formatMs(critical.provider.byProvider.mistral?.latencyMs.sum || 0)} (${formatPercent(critical.shares.mistral)})`,
    `- Local parse/normalize/write: ${formatMs(critical.localParseNormalizeWriteMs)} (${formatPercent(critical.shares.localParseNormalizeWrite)})`,
    "",
    "## Repair behavior",
    "",
    `- Repair statuses: ${JSON.stringify(pipeline.repairStatuses)}`,
    `- Repair solely for unknown confidence: ${pipeline.repairUsedSolelyForUnknownConfidenceFiles} files`,
    `- Repair failures: ${JSON.stringify(pipeline.repairFailures)}`,
    "",
    "## V3 acceptance boundary",
    "",
    "- Account for every unique document and page.",
    "- Compare critical legal tokens separately from general text similarity.",
    "- Report every provider call, latency, and cost.",
    "- Do not require byte-identical OCR output.",
    "- Do not claim human-level correctness from parity with this baseline.",
    "",
  ].join("\n");
}

function formatMs(value) {
  const milliseconds = Math.max(0, Number(value) || 0);
  return `${(milliseconds / 1000).toFixed(3)}s`;
}

function formatPercent(value) {
  return `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)}%`;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

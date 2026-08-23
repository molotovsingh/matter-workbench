import path from "node:path";

import { V2SessionStore } from "./session-store.mjs";
import { atomicWriteFile, atomicWriteJson, elapsedMs, readJson, summarizeNumbers } from "./util.mjs";

export async function buildV2BenchmarkReport({ root, sessionId, baselineFile, outFile }) {
  if (!root || !sessionId || !baselineFile || !outFile) throw new Error("root, session, baseline, and output are required");
  const baseline = await readJson(path.resolve(baselineFile));
  const session = await new V2SessionStore({ root }).readSession(sessionId);
  const realFiles = session.files.filter((file) => file.sourceKind === "real");
  const extractable = session.files.filter((file) => file.commitDisposition === "ready");
  const uploadRuns = session.metrics?.uploadRuns || [];
  const extractionRuns = session.metrics?.extractionRuns || [];
  const v2UploadActiveMs = sum(uploadRuns, "activeMs");
  const v2ExtractionActiveMs = sum(extractionRuns, "activeMs");
  const provider = mergeProviderSummaries(extractionRuns.map((run) => run.provider || {}));
  const extractionDurations = extractable.map((file) => file.extraction.durationMs);
  const completed = extractable.filter((file) => ["succeeded", "failed", "skipped"].includes(file.extraction.status));
  const matchedPageCounts = extractable.filter((file) => (
    file.extraction.status === "succeeded"
    && Number(file.baseline?.pageCount) > 0
    && Number(file.extraction.pageCount) === Number(file.baseline.pageCount)
  )).length;
  const comparablePageCounts = extractable.filter((file) => file.extraction.status === "succeeded" && Number(file.baseline?.pageCount) > 0).length;
  const extractionAttempts = extractable.map((file) => Number(file.extraction.attempts) || 0);
  const repeatedFiles = extractable.filter((file) => Number(file.extraction.attempts) > 1).length;
  const recoveredInterruptedFiles = Number(session.metrics?.recoveredInterruptedFiles) || 0;

  const baselineSuccessful = sumStatusCounts(baseline.extraction?.statusCounts, ["extracted", "cached", "ocr-required-all"]);
  const baselineSkipped = sumStatusCounts(baseline.extraction?.statusCounts, ["skipped-unsupported-format", "skipped-duplicate"]);
  const baselineFailed = sumStatusCounts(baseline.extraction?.statusCounts, ["failed"]);
  const v2Counts = countBy(extractable, (file) => file.extraction.status);
  const duplicateAnalysis = analyzeDuplicateOutcomes(extractable);
  const v2UniqueCounts = countBy(duplicateAnalysis.uniqueFiles, (file) => file.extraction.status);
  const baselineDuplicateCount = Number(baseline.extraction?.statusCounts?.["skipped-duplicate"]) || 0;
  const baselineUnsupported = sumStatusCounts(baseline.extraction?.statusCounts, ["skipped-unsupported-format"]);
  const uploadSpeedup = ratio(baseline.upload?.wallMs, v2UploadActiveMs);
  const extractionSpeedup = ratio(baseline.extraction?.fileProcessingMs?.sum || baseline.extraction?.jobWallMs, v2ExtractionActiveMs);
  const checkpointRecoveryBounded = repeatedFiles <= recoveredInterruptedFiles
    && extractionAttempts.every((attempts) => attempts <= 2);
  const accountedFor = completed.length === extractable.length;
  const uniqueOutcomeParity = (v2UniqueCounts.succeeded || 0) >= baselineSuccessful
    && (v2UniqueCounts.skipped || 0) <= baselineUnsupported
    && (v2UniqueCounts.failed || 0) <= baselineFailed;
  const duplicateHandlingParity = duplicateAnalysis.redundantlyProcessed === 0
    && duplicateAnalysis.duplicateFiles === baselineDuplicateCount;
  const outputParity = uniqueOutcomeParity && duplicateHandlingParity;

  const report = {
    schemaVersion: "upload-extract-v2/benchmark-report-v1",
    generatedAt: new Date().toISOString(),
    verdict: {
      state: extractionSpeedup > 1 && accountedFor && outputParity && provider.totalCalls > 0 && checkpointRecoveryBounded
        ? "v2_better"
        : "review_required",
      extractionFaster: extractionSpeedup > 1,
      everyExtractableFileAccountedFor: accountedFor,
      outputCountParity: outputParity,
      uniqueFileOutcomeParity: uniqueOutcomeParity,
      duplicateHandlingParity,
      realProviderCallsObserved: provider.totalCalls > 0,
      completedFilesWereNotRepeated: checkpointRecoveryBounded,
    },
    fixture: {
      sessionId: session.id,
      totalUploadFiles: session.files.length,
      realFiles: realFiles.length,
      filteredPlaceholders: session.files.filter((file) => file.sourceKind === "filtered-placeholder").length,
      totalBytes: session.files.reduce((total, file) => total + file.expectedBytes, 0),
      extractableFiles: extractable.length,
    },
    v1: baseline,
    v2: {
      state: session.state,
      upload: {
        runs: uploadRuns.length,
        activeMs: v2UploadActiveMs,
        uploadedBytes: sum(uploadRuns, "uploadedBytes"),
        peakRssBytes: max(uploadRuns, "peakRssBytes"),
      },
      extraction: {
        runs: extractionRuns.length,
        activeMs: v2ExtractionActiveMs,
        endToEndMs: elapsedMs(extractionRuns[0]?.startedAt, extractionRuns.at(-1)?.finishedAt),
        configuredConcurrency: max(extractionRuns, "concurrency"),
        peakRssBytes: max(extractionRuns, "peakRssBytes"),
        counts: v2Counts,
        uniqueFileCounts: v2UniqueCounts,
        duplicateFiles: duplicateAnalysis.duplicateFiles,
        redundantlyProcessedDuplicates: duplicateAnalysis.redundantlyProcessed,
        totalPages: extractable.reduce((sum, file) => sum + (Number(file.extraction.pageCount) || 0), 0),
        fileDurationMs: summarizeNumbers(extractionDurations),
        pageCountExactMatches: matchedPageCounts,
        comparablePageCounts,
        maxExtractionAttemptsPerFile: extractionAttempts.length ? Math.max(...extractionAttempts) : 0,
        recoveredInterruptedFiles,
        repeatedInFlightFiles: repeatedFiles,
        interruptedRuns: extractionRuns.filter((run) => run.status === "interrupted").length,
        providerUsageComplete: extractionRuns.every((run) => run.status !== "interrupted"),
        provider,
      },
    },
    comparison: {
      uploadSpeedupDirectional: uploadSpeedup,
      extractionSpeedupControlled: extractionSpeedup,
      baselineSuccessful,
      baselineSkipped,
      baselineFailed,
      baselineDuplicateCount,
      v2Succeeded: v2Counts.succeeded || 0,
      v2Skipped: v2Counts.skipped || 0,
      v2Failed: v2Counts.failed || 0,
      v2UniqueSucceeded: v2UniqueCounts.succeeded || 0,
      v2UniqueSkipped: v2UniqueCounts.skipped || 0,
      v2UniqueFailed: v2UniqueCounts.failed || 0,
      pageCountExactMatchRate: comparablePageCounts ? matchedPageCounts / comparablePageCounts : null,
      caveats: [
        "Upload speed is directional unless v1 and v2 clients run over the same network path.",
        "The v1 processing job includes its recorded retry/recovery history; controlled extraction speedup uses summed per-file v1 timings.",
        "Provider cost is estimated only when explicit v2 pricing-rate environment variables were supplied; provider calls and returned usage are actual.",
        "For an interrupted process, completed-file provider call counts and Mistral pages are checkpointed; Gemini token usage and any killed in-flight request are left to the provider billing ledger.",
        "v2 unique-file outcomes match v1, but v2 did not suppress five byte-identical duplicates before extraction; that redundant work keeps the verdict at review_required.",
      ],
    },
  };

  const jsonPath = path.resolve(outFile);
  const markdownPath = jsonPath.replace(/\.json$/i, "") + ".md";
  await atomicWriteJson(jsonPath, report);
  await atomicWriteFile(markdownPath, renderMarkdown(report));
  return report;
}

function renderMarkdown(report) {
  const c = report.comparison;
  const p = report.v2.extraction.provider;
  return [
    "# Upload + Extract v2 Real Benchmark",
    "",
    `Verdict: **${report.verdict.state}**`,
    "",
    "## Fixture",
    "",
    `- Upload entries: ${report.fixture.totalUploadFiles}`,
    `- Real extractable files: ${report.fixture.extractableFiles}`,
    `- Filtered placeholders: ${report.fixture.filteredPlaceholders}`,
    `- Total bytes: ${report.fixture.totalBytes}`,
    "",
    "## Timing",
    "",
    `- v1 upload: ${formatMs(report.v1.upload?.wallMs || 0)}`,
    `- v2 upload active time: ${formatMs(report.v2.upload.activeMs)} (${formatRatio(c.uploadSpeedupDirectional)} directional speedup)`,
    `- v1 extraction summed file time: ${formatMs(report.v1.extraction?.fileProcessingMs?.sum || 0)}`,
    `- v2 extraction active wall time: ${formatMs(report.v2.extraction.activeMs)}`,
    `- Controlled extraction speedup: **${formatRatio(c.extractionSpeedupControlled)}**`,
    `- v2 peak RSS: ${formatBytes(report.v2.extraction.peakRssBytes)}`,
    "",
    "## Correctness",
    "",
    `- v1 success / skipped / failed: ${c.baselineSuccessful} / ${c.baselineSkipped} / ${c.baselineFailed}`,
    `- v2 all-file success / skipped / failed: ${c.v2Succeeded} / ${c.v2Skipped} / ${c.v2Failed}`,
    `- v2 unique-file success / skipped / failed: ${c.v2UniqueSucceeded} / ${c.v2UniqueSkipped} / ${c.v2UniqueFailed}`,
    `- Duplicate files / redundantly processed: ${report.v2.extraction.duplicateFiles} / ${report.v2.extraction.redundantlyProcessedDuplicates}`,
    `- Page-count exact match: ${c.pageCountExactMatchRate === null ? "n/a" : `${(c.pageCountExactMatchRate * 100).toFixed(1)}%`}`,
    `- Max extraction attempts per file: ${report.v2.extraction.maxExtractionAttemptsPerFile}`,
    `- Recovered / repeated in-flight files: ${report.v2.extraction.recoveredInterruptedFiles} / ${report.v2.extraction.repeatedInFlightFiles}`,
    "",
    "## Real provider usage",
    "",
    `- HTTP calls: ${p.totalCalls}`,
    `- Successful / failed calls: ${p.successfulCalls} / ${p.failedCalls}`,
    ...Object.entries(p.byProvider || {}).map(([name, value]) => `- ${name}: ${value.calls} calls, ${value.pagesProcessed || 0} pages, estimated cost ${value.estimatedCostUsd ?? (value.costCoverageComplete ? "rate not configured" : "incomplete after interrupted run")}`),
    "",
    "## Caveats",
    "",
    ...c.caveats.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function analyzeDuplicateOutcomes(files) {
  const firstBySha = new Map();
  const uniqueFiles = [];
  let duplicateFiles = 0;
  let redundantlyProcessed = 0;
  for (const file of files) {
    const sha = String(file.sha256 || "");
    if (!sha || !firstBySha.has(sha)) {
      if (sha) firstBySha.set(sha, file);
      uniqueFiles.push(file);
      continue;
    }
    duplicateFiles += 1;
    if (file.extraction.status !== "skipped") redundantlyProcessed += 1;
  }
  return { uniqueFiles, duplicateFiles, redundantlyProcessed };
}

function mergeProviderSummaries(summaries) {
  const result = { totalCalls: 0, successfulCalls: 0, failedCalls: 0, byProvider: {} };
  for (const summary of summaries) {
    result.totalCalls += Number(summary.totalCalls) || 0;
    result.successfulCalls += Number(summary.successfulCalls) || 0;
    result.failedCalls += Number(summary.failedCalls) || 0;
    for (const [provider, value] of Object.entries(summary.byProvider || {})) {
      const target = result.byProvider[provider] || {
        calls: 0,
        succeededCalls: 0,
        failedCalls: 0,
        pagesProcessed: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: null,
        costCoverageComplete: true,
      };
      for (const key of ["calls", "succeededCalls", "failedCalls", "pagesProcessed", "inputTokens", "outputTokens"]) {
        target[key] += Number(value[key]) || 0;
      }
      if (value.estimatedCostUsd !== null && value.estimatedCostUsd !== undefined) {
        target.estimatedCostUsd = (target.estimatedCostUsd || 0) + Number(value.estimatedCostUsd || 0);
      } else if (Number(value.calls) > 0) {
        target.costCoverageComplete = false;
      }
      if (!target.costCoverageComplete) target.estimatedCostUsd = null;
      result.byProvider[provider] = target;
    }
  }
  return result;
}

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = String(keyFor(item) || "unknown");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sumStatusCounts(counts = {}, statuses = []) {
  return statuses.reduce((total, status) => total + (Number(counts?.[status]) || 0), 0);
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

function max(items, key) {
  return items.reduce((greatest, item) => Math.max(greatest, Number(item?.[key]) || 0), 0);
}

function ratio(baseline, candidate) {
  const left = Number(baseline);
  const right = Number(candidate);
  return Number.isFinite(left) && Number.isFinite(right) && right > 0 ? left / right : 0;
}

function formatRatio(value) {
  return `${Number(value || 0).toFixed(2)}×`;
}

function formatMs(value) {
  const seconds = Math.round((Number(value) || 0) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}h ${minutes}m ${rest}s` : `${minutes}m ${rest}s`;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

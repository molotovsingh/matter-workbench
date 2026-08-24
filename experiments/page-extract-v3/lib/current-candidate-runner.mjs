import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { buildBalancedPageBatches } from "./batching.mjs";
import { combinePageUnits, preparePdfPageFiles } from "./pdf-page-files.mjs";
import { inspectPdfPages } from "./page-inspector.mjs";
import { evaluatePrimaryPage, evaluateRepairPage } from "./page-quality.mjs";
import { runPrimaryProviderTask, runRepairProviderTask } from "./provider-task-runner.mjs";
import { comparePageText, pageText, summarizePageComparisons } from "./reference-comparison.mjs";
import {
  atomicWriteFile,
  atomicWriteJson,
  countBy,
  mapWithConcurrency,
  normalizeReferenceText,
  readJson,
  readJsonIfExists,
  safeId,
  sha256,
  summarizeNumbers,
} from "./util.mjs";

const PREPARED_DOCUMENT_SCHEMA = "page-extract-v3/prepared-document-v1";
const CANDIDATE_SCHEMA = "page-extract-v3/current-provider-candidate-v1";

export async function runCurrentProviderCandidate({
  v2Root,
  routePlanFile,
  root,
  candidateId,
  preflightConcurrency = 2,
  primaryConcurrency = 4,
  repairConcurrency = 4,
  primaryMaxPages = 16,
  primaryMaxBytes = 20 * 1024 * 1024,
  repairMaxPages = 4,
  repairMaxBytes = 10 * 1024 * 1024,
  repairModel = "gemini-2.5-pro",
  repairThinkingLevel = "",
  prepareOnly = false,
  env = process.env,
  fetchImpl = fetch,
  inspectPdf = inspectPdfPages,
  preparePages = preparePdfPageFiles,
  combinePages = combinePageUnits,
  primaryTaskRunner = runPrimaryProviderTask,
  repairTaskRunner = runRepairProviderTask,
  onProgress = () => {},
} = {}) {
  if (!v2Root || !routePlanFile || !root) throw new Error("v2 root, route plan, and candidate root are required");
  if (!prepareOnly && !env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY is required for the current-provider V3 candidate");
  if (!prepareOnly && !(env.GEMINI_API_KEY || env.GOOGLE_API_KEY)) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required for the current-provider V3 candidate");
  const id = safeId(candidateId, "candidate id");
  const plan = await readJson(path.resolve(routePlanFile));
  const sessionId = safeId(plan.source?.sessionId, "source session id");
  const sourceRoot = path.join(path.resolve(v2Root), "sessions", sessionId);
  const session = await readJson(path.join(sourceRoot, "session.json"));
  const candidateRoot = path.join(path.resolve(root), "candidates", id);
  await mkdir(candidateRoot, { recursive: true, mode: 0o700 });

  const configuration = {
    preflightConcurrency: bounded(preflightConcurrency, 2, 8),
    primaryConcurrency: bounded(primaryConcurrency, 4, 32),
    repairConcurrency: bounded(repairConcurrency, 4, 32),
    primaryMaxPages: bounded(primaryMaxPages, 16, 64),
    primaryMaxBytes: bounded(primaryMaxBytes, 20 * 1024 * 1024, 50 * 1024 * 1024),
    repairMaxPages: bounded(repairMaxPages, 4, 16),
    repairMaxBytes: bounded(repairMaxBytes, 10 * 1024 * 1024, 50 * 1024 * 1024),
    repairModel: String(repairModel || "gemini-2.5-pro"),
    repairThinkingLevel: String(repairThinkingLevel || "").toUpperCase(),
  };
  const runFingerprint = sha256(JSON.stringify({ plan: plan.fingerprintSha256, configuration }));
  const startedAt = new Date().toISOString();
  const totalStarted = performance.now();
  let peakRssBytes = process.memoryUsage().rss;
  const memoryTimer = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 100);
  memoryTimer.unref?.();
  const stageMs = {};
  await atomicWriteJson(path.join(candidateRoot, "run.json"), {
    schemaVersion: CANDIDATE_SCHEMA,
    candidateId: id,
    sourceSessionId: sessionId,
    routePlanFingerprint: plan.fingerprintSha256,
    runFingerprint,
    state: "running",
    startedAt,
    configuration,
  });

  try {
    const sourceFiles = new Map(session.files.map((file) => [Number(file.index), file]));
    let stageStarted = performance.now();
    const preparedDocuments = await prepareDocuments({
      plan,
      sourceRoot,
      candidateRoot,
      sourceFiles,
      concurrency: configuration.preflightConcurrency,
      inspectPdf,
      preparePages,
      onProgress,
    });
    stageMs.prepare = Math.round(performance.now() - stageStarted);

    stageStarted = performance.now();
    const primaryUnits = buildPrimaryUnits(preparedDocuments);
    const primaryTasks = await prepareProviderTasks({
      kind: "primary",
      units: primaryUnits,
      candidateRoot,
      maxPages: configuration.primaryMaxPages,
      maxBytes: configuration.primaryMaxBytes,
      minimumBatches: configuration.primaryConcurrency * 2,
      combinePages,
      concurrency: configuration.preflightConcurrency,
    });
    stageMs.primaryBatchPreparation = Math.round(performance.now() - stageStarted);

    if (prepareOnly) {
      const preparedReport = {
        schemaVersion: CANDIDATE_SCHEMA,
        candidateId: id,
        state: "prepared",
        runFingerprint,
        routePlanFingerprint: plan.fingerprintSha256,
        configuration,
        workload: {
          uniquePdfFiles: preparedDocuments.length,
          duplicatePdfFilesSkipped: plan.workload.duplicatePdfFiles,
          expectedPages: preparedDocuments.reduce((sum, document) => sum + document.pageCount, 0),
          nativePages: plan.routing.nativePages,
          primaryPages: primaryUnits.length,
        },
        primaryBatches: {
          tasks: primaryTasks.length,
          pages: primaryTasks.reduce((sum, task) => sum + task.units.length, 0),
          bytes: summarizeNumbers(primaryTasks.map((task) => task.bytes)),
          weights: summarizeNumbers(primaryTasks.map((task) => task.weight)),
        },
        measurement: {
          totalWallMs: Math.round(performance.now() - totalStarted),
          peakRssBytes: Math.max(peakRssBytes, process.memoryUsage().rss),
          stageMs: { ...stageMs },
          providerCalls: 0,
        },
      };
      await atomicWriteJson(path.join(candidateRoot, "preparation-report.json"), preparedReport);
      await atomicWriteJson(path.join(candidateRoot, "run.json"), {
        schemaVersion: CANDIDATE_SCHEMA,
        candidateId: id,
        sourceSessionId: sessionId,
        routePlanFingerprint: plan.fingerprintSha256,
        runFingerprint,
        state: "prepared",
        startedAt,
        finishedAt: new Date().toISOString(),
        configuration,
        report: "preparation-report.json",
      });
      return preparedReport;
    }

    stageStarted = performance.now();
    const primaryResults = await runTasks({
      tasks: primaryTasks,
      concurrency: configuration.primaryConcurrency,
      resultDir: path.join(candidateRoot, "tasks", "primary-results"),
      onProgress,
      label: "primary",
      run: (task, resultFile) => primaryTaskRunner({ task, resultFile, env, fetchImpl }),
    });
    stageMs.primaryProvider = Math.round(performance.now() - stageStarted);

    const primaryPageMap = providerPageMap(primaryResults);
    const primaryEvaluations = [];
    const repairUnits = [];
    for (const unit of primaryUnits) {
      const mapped = primaryPageMap.get(unitKey(unit));
      const evaluation = evaluatePrimaryPage({ providerPage: mapped?.providerPage, nativeText: unit.nativeText });
      const value = {
        documentId: unit.documentId,
        page: unit.page,
        reasons: evaluation.reasons,
        diagnostics: evaluation.diagnostics,
      };
      primaryEvaluations.push(value);
      if (evaluation.needsRepair) repairUnits.push({ ...unit, complexity: 1.5, primaryEvaluation: value });
    }
    await atomicWriteJson(path.join(candidateRoot, "primary-evaluation.json"), {
      schemaVersion: "page-extract-v3/primary-evaluation-v1",
      pages: primaryEvaluations,
    });

    stageStarted = performance.now();
    const repairTasks = await prepareProviderTasks({
      kind: "repair",
      units: repairUnits,
      candidateRoot,
      maxPages: configuration.repairMaxPages,
      maxBytes: configuration.repairMaxBytes,
      minimumBatches: configuration.repairConcurrency * 2,
      combinePages,
      concurrency: configuration.preflightConcurrency,
    });
    stageMs.repairBatchPreparation = Math.round(performance.now() - stageStarted);

    stageStarted = performance.now();
    const repairResults = await runTasks({
      tasks: repairTasks,
      concurrency: configuration.repairConcurrency,
      resultDir: path.join(candidateRoot, "tasks", "repair-results"),
      onProgress,
      label: "repair",
      run: (task, resultFile) => repairTaskRunner({
        task,
        resultFile,
        model: configuration.repairModel,
        thinkingLevel: configuration.repairThinkingLevel,
        env,
        fetchImpl,
      }),
    });
    stageMs.repairProvider = Math.round(performance.now() - stageStarted);

    stageStarted = performance.now();
    const report = await assembleCandidate({
      candidateId: id,
      candidateRoot,
      sourceRoot,
      plan,
      configuration,
      runFingerprint,
      preparedDocuments,
      primaryResults,
      repairResults,
      primaryEvaluations,
      stageMs,
      startedAt,
      totalStarted,
      peakRssBytes,
    });
    stageMs.assembly = Math.round(performance.now() - stageStarted);
    report.measurement.stageMs = { ...stageMs };
    report.measurement.totalWallMs = Math.round(performance.now() - totalStarted);
    report.measurement.peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    report.finishedAt = new Date().toISOString();
    await writeCandidateReport(candidateRoot, report);
    await atomicWriteJson(path.join(candidateRoot, "run.json"), {
      schemaVersion: CANDIDATE_SCHEMA,
      candidateId: id,
      sourceSessionId: sessionId,
      routePlanFingerprint: plan.fingerprintSha256,
      runFingerprint,
      state: "complete",
      startedAt,
      finishedAt: report.finishedAt,
      configuration,
      report: "report.json",
    });
    return report;
  } catch (error) {
    await atomicWriteJson(path.join(candidateRoot, "run.json"), {
      schemaVersion: CANDIDATE_SCHEMA,
      candidateId: id,
      sourceSessionId: sessionId,
      routePlanFingerprint: plan.fingerprintSha256,
      runFingerprint,
      state: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      configuration,
      error: safeError(error),
    });
    throw error;
  } finally {
    clearInterval(memoryTimer);
  }
}

async function prepareDocuments({ plan, sourceRoot, candidateRoot, sourceFiles, concurrency, inspectPdf, preparePages, onProgress }) {
  const eligible = plan.documents.filter((document) => document.status === "inspected");
  let completed = 0;
  return mapWithConcurrency(eligible, concurrency, async (planned) => {
    const source = sourceFiles.get(Number(planned.sourceIndex));
    if (!source || source.sha256 !== planned.sourceSha256) throw new Error(`source checkpoint mismatch for ${planned.documentId}`);
    const documentRoot = path.join(candidateRoot, "documents", planned.documentId);
    const preparedFile = path.join(documentRoot, "prepared.json");
    const existing = await readJsonIfExists(preparedFile);
    if (existing?.schemaVersion === PREPARED_DOCUMENT_SCHEMA && existing.planFingerprint === plan.fingerprintSha256) {
      const restored = await restorePreparedDocument(existing, documentRoot);
      if (restored) {
        completed += 1;
        onProgress({ stage: "prepare", completedFiles: completed, attemptedFiles: eligible.length, resumed: true });
        return restored;
      }
    }

    const sourcePath = path.join(sourceRoot, "objects", `${padIndex(planned.sourceIndex)}.blob`);
    const inspection = await inspectPdf({ pdfPath: sourcePath, policy: plan.policy });
    if (inspection.pageCount !== planned.pageCount) throw new Error(`page count changed for ${planned.documentId}`);
    const plannedPages = new Map(planned.pages.map((page) => [page.page, page]));
    for (const page of inspection.pages) {
      const plannedPage = plannedPages.get(page.page);
      if (plannedPage?.route !== page.route || plannedPage?.nativeTextSha256 !== sha256(page.nativeText)) {
        throw new Error(`route plan changed for ${planned.documentId} page ${page.page}`);
      }
    }
    const separated = await preparePages({
      sourcePath,
      outDir: path.join(documentRoot, "pages"),
      pageCount: inspection.pageCount,
    });
    const pageFiles = new Map(separated.pages.map((page) => [page.page, page]));
    const prepared = {
      schemaVersion: PREPARED_DOCUMENT_SCHEMA,
      planFingerprint: plan.fingerprintSha256,
      documentId: planned.documentId,
      sourceIndex: planned.sourceIndex,
      sourceSha256: planned.sourceSha256,
      pageCount: inspection.pageCount,
      pages: inspection.pages.map((page) => ({
        page: page.page,
        route: page.route,
        reasons: page.reasons,
        diagnostics: page.diagnostics,
        nativeText: page.nativeText,
        nativeBlocks: page.nativeBlocks,
        pageFile: path.relative(documentRoot, pageFiles.get(page.page).filePath),
        bytes: pageFiles.get(page.page).bytes,
      })),
    };
    await atomicWriteJson(preparedFile, prepared);
    completed += 1;
    onProgress({ stage: "prepare", completedFiles: completed, attemptedFiles: eligible.length, resumed: false });
    return hydratePreparedDocument(prepared, documentRoot);
  });
}

async function restorePreparedDocument(existing, documentRoot) {
  try {
    for (const page of existing.pages) await stat(path.join(documentRoot, page.pageFile));
    return hydratePreparedDocument(existing, documentRoot);
  } catch {
    return null;
  }
}

function hydratePreparedDocument(document, documentRoot) {
  return {
    ...document,
    pages: document.pages.map((page) => ({ ...page, filePath: path.join(documentRoot, page.pageFile) })),
  };
}

function buildPrimaryUnits(documents) {
  return documents.flatMap((document) => document.pages
    .filter((page) => page.route === "primary_ocr")
    .map((page) => ({
      documentId: document.documentId,
      page: page.page,
      sourceSha256: document.sourceSha256,
      filePath: page.filePath,
      bytes: page.bytes,
      nativeText: page.nativeText,
      complexity: pageComplexity(page.reasons),
    })));
}

async function prepareProviderTasks({ kind, units, candidateRoot, maxPages, maxBytes, minimumBatches, combinePages, concurrency }) {
  const batches = buildBalancedPageBatches(units, { maxPages, maxBytes, minimumBatches });
  const pdfDir = path.join(candidateRoot, "tasks", `${kind}-pdfs`);
  await mkdir(pdfDir, { recursive: true, mode: 0o700 });
  return mapWithConcurrency(batches, concurrency, async (batch, index) => {
    const mappingFingerprint = sha256(batch.units.map(unitKey).join("\n")).slice(0, 16);
    const id = `${kind}-${String(index + 1).padStart(4, "0")}-${mappingFingerprint}`;
    const pdfPath = path.join(pdfDir, `${id}.pdf`);
    await combinePages({ units: batch.units, outFile: pdfPath });
    return { id, index, pdfPath, units: batch.units, bytes: batch.bytes, weight: batch.weight };
  });
}

async function runTasks({ tasks, concurrency, resultDir, run, onProgress, label }) {
  await mkdir(resultDir, { recursive: true, mode: 0o700 });
  let completed = 0;
  return mapWithConcurrency(tasks, concurrency, async (task) => {
    const result = await run(task, path.join(resultDir, `${task.id}.json`));
    completed += 1;
    onProgress({ stage: label, completedFiles: completed, attemptedFiles: tasks.length, status: result.status, resumed: result.resumed });
    return result;
  });
}

async function assembleCandidate({
  candidateId,
  candidateRoot,
  sourceRoot,
  plan,
  configuration,
  runFingerprint,
  preparedDocuments,
  primaryResults,
  repairResults,
  primaryEvaluations,
  stageMs,
  startedAt,
  totalStarted,
  peakRssBytes,
}) {
  const primaryMap = providerPageMap(primaryResults);
  const repairMap = providerPageMap(repairResults);
  const evaluationMap = new Map(primaryEvaluations.map((value) => [unitKey(value), value]));
  const comparisons = [];
  const comparisonsByLane = { native: [], primary: [], repair: [] };
  const pageSources = [];
  const documents = [];
  let missingPages = 0;
  const outputDir = path.join(candidateRoot, "outputs");
  await mkdir(outputDir, { recursive: true, mode: 0o700 });

  for (const prepared of preparedDocuments) {
    const reference = await readJsonIfExists(path.join(sourceRoot, "extracted", `${padIndex(prepared.sourceIndex)}.json`));
    const referencePages = new Map((reference?.pages || []).map((page, index) => [normalizePageNumber(page?.page, index), page]));
    const outputPages = [];
    const documentComparisons = [];
    for (const page of prepared.pages) {
      const key = unitKey({ documentId: prepared.documentId, page: page.page });
      const primary = primaryMap.get(key)?.providerPage || null;
      const repair = repairMap.get(key)?.providerPage || null;
      const primaryEvaluation = evaluationMap.get(key);
      const repairEvaluation = repair ? evaluateRepairPage({ providerPage: repair }) : null;
      let selected;
      let source;
      if (page.route === "native") {
        source = "native";
        selected = { page: page.page, blocks: page.nativeBlocks, warnings: [] };
      } else if (primaryEvaluation?.reasons.length && repairEvaluation?.usable) {
        source = "repair";
        selected = { ...repair, page: page.page };
      } else if (primary) {
        source = primaryEvaluation?.reasons.length ? "primary_after_repair_failure" : "primary";
        selected = { ...primary, page: page.page };
      } else if (repairEvaluation?.usable) {
        source = "repair_fallback";
        selected = { ...repair, page: page.page };
      } else {
        source = "missing";
        selected = { page: page.page, markdown: "", warnings: ["V3 candidate produced no usable page result"] };
        missingPages += 1;
      }
      outputPages.push({ ...selected, v3_source: source });
      pageSources.push(source);
      const referencePage = referencePages.get(page.page);
      if (referencePage) {
        const comparison = comparePageText(pageText(selected), pageText(referencePage));
        comparisons.push(comparison);
        comparisonsByLane[source === "native" ? "native" : (source.startsWith("repair") ? "repair" : "primary")].push(comparison);
        documentComparisons.push(comparison);
      }
    }
    const flatText = outputPages.map(pageText).join("\n\n");
    const outputRecord = {
      schemaVersion: "page-extract-v3/candidate-output-v1",
      candidateId,
      documentId: prepared.documentId,
      sourceSha256: prepared.sourceSha256,
      pageCount: prepared.pageCount,
      pages: outputPages,
      outputTextSha256: sha256(normalizeReferenceText(flatText)),
    };
    await atomicWriteJson(path.join(outputDir, `${prepared.documentId}.json`), outputRecord);
    await atomicWriteFile(path.join(outputDir, `${prepared.documentId}.txt`), flatText);
    documents.push({
      documentId: prepared.documentId,
      pageCount: prepared.pageCount,
      outputTextSha256: outputRecord.outputTextSha256,
      pageSources: countBy(outputPages, (page) => page.v3_source),
      referenceComparison: summarizePageComparisons(documentComparisons),
    });
  }

  const provider = mergeProviderTaskResults([...primaryResults, ...repairResults]);
  const totalComparison = summarizePageComparisons(comparisons);
  const expectedPages = preparedDocuments.reduce((sum, document) => sum + document.pageCount, 0);
  const primaryReasonCounts = {};
  for (const evaluation of primaryEvaluations) {
    for (const reason of evaluation.reasons) primaryReasonCounts[reason] = (primaryReasonCounts[reason] || 0) + 1;
  }
  const report = {
    schemaVersion: CANDIDATE_SCHEMA,
    candidateId,
    startedAt,
    finishedAt: "",
    runFingerprint,
    routePlanFingerprint: plan.fingerprintSha256,
    configuration,
    verdict: {
      state: missingPages === 0 && totalComparison.criticalTokenRecall.min === 1 ? "candidate_complete" : "review_required",
      everyExpectedPageProduced: missingPages === 0,
      fullCriticalTokenRecallAgainstReference: totalComparison.criticalTokenRecall.min === 1,
      baselineIsGroundTruth: false,
    },
    workload: {
      uniquePdfFiles: preparedDocuments.length,
      duplicatePdfFilesSkipped: plan.workload.duplicatePdfFiles,
      expectedPages,
      outputPages: pageSources.length,
      missingPages,
    },
    routing: {
      plannedNativePages: plan.routing.nativePages,
      plannedPrimaryPages: plan.routing.primaryOcrPages,
      selectedPageSources: countBy(pageSources, (source) => source),
      primaryRepairReasonCounts: primaryReasonCounts,
    },
    tasks: {
      primary: taskSummary(primaryResults),
      repair: taskSummary(repairResults),
    },
    provider,
    qualityAgainstCurrentReference: {
      overall: totalComparison,
      native: summarizePageComparisons(comparisonsByLane.native),
      primary: summarizePageComparisons(comparisonsByLane.primary),
      repair: summarizePageComparisons(comparisonsByLane.repair),
    },
    measurement: {
      totalWallMs: Math.round(performance.now() - totalStarted),
      peakRssBytes,
      stageMs: { ...stageMs },
    },
    documents,
    caveats: [
      "The current Mistral-to-Gemini output is a non-inferiority reference, not human-verified ground truth.",
      "The candidate uses byte-unique PDFs; duplicate files are skipped before paid provider work.",
      "Native routes are decided independently of the reference; reference comparisons are applied only after extraction.",
    ],
  };
  return report;
}

function providerPageMap(results) {
  const result = new Map();
  for (const task of results || []) {
    for (const page of task.pages || []) result.set(unitKey(page), page);
  }
  return result;
}

function mergeProviderTaskResults(taskResults) {
  const result = { totalCalls: 0, successfulCalls: 0, failedCalls: 0, estimatedCostUsd: 0, costCoverageComplete: true, byProvider: {} };
  const rawLatencies = {};
  for (const taskResult of taskResults) {
    const summary = taskResult.provider || {};
    result.totalCalls += Number(summary.totalCalls) || 0;
    result.successfulCalls += Number(summary.successfulCalls) || 0;
    result.failedCalls += Number(summary.failedCalls) || 0;
    for (const [name, value] of Object.entries(summary.byProvider || {})) {
      const target = result.byProvider[name] || {
        calls: 0, succeededCalls: 0, failedCalls: 0, pagesProcessed: 0, inputTokens: 0, outputTokens: 0,
        latencyMs: {}, estimatedCostUsd: 0, costCoverageComplete: true,
      };
      for (const key of ["calls", "succeededCalls", "failedCalls", "pagesProcessed", "inputTokens", "outputTokens"]) target[key] += Number(value[key]) || 0;
      if (value.estimatedCostUsd === null || value.estimatedCostUsd === undefined) target.costCoverageComplete = false;
      else target.estimatedCostUsd += Number(value.estimatedCostUsd) || 0;
      result.byProvider[name] = target;
      rawLatencies[name] ||= [];
      const exact = (taskResult.providerEvents || []).filter((event) => event.provider === name).map((event) => Number(event.durationMs) || 0);
      if (exact.length) rawLatencies[name].push(...exact);
      else if (value.latencyMs?.count) rawLatencies[name].push(...Array(Number(value.latencyMs.count)).fill(Number(value.latencyMs.mean) || 0));
    }
  }
  for (const [name, provider] of Object.entries(result.byProvider)) {
    provider.latencyMs = summarizeNumbers(rawLatencies[name] || []);
    if (!provider.costCoverageComplete) {
      provider.estimatedCostUsd = null;
      result.costCoverageComplete = false;
    } else result.estimatedCostUsd += provider.estimatedCostUsd;
  }
  if (!result.costCoverageComplete) result.estimatedCostUsd = null;
  return result;
}

function taskSummary(results) {
  return {
    tasks: results.length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failed: results.filter((result) => result.status === "failed").length,
    resumed: results.filter((result) => result.resumed).length,
    attempts: results.reduce((sum, result) => sum + (Number(result.attempts) || 0), 0),
    durationMs: summarizeNumbers(results.map((result) => result.durationMs)),
  };
}

async function writeCandidateReport(candidateRoot, report) {
  await atomicWriteJson(path.join(candidateRoot, "report.json"), report);
  await atomicWriteFile(path.join(candidateRoot, "report.md"), renderReport(report));
}

function renderReport(report) {
  const quality = report.qualityAgainstCurrentReference.overall;
  const providerLines = Object.entries(report.provider.byProvider).map(([name, value]) => (
    `- ${name}: ${value.calls} calls, ${value.pagesProcessed} pages, ${value.inputTokens}/${value.outputTokens} input/output tokens, cost ${value.estimatedCostUsd === null ? "incomplete" : `$${value.estimatedCostUsd.toFixed(4)}`}`
  ));
  return [
    "# Page Extract V3 — Current Provider Candidate",
    "",
    `Verdict: **${report.verdict.state}**`,
    `Repair model: **${report.configuration.repairModel}** (${report.configuration.repairThinkingLevel || "provider-default"} thinking)`, 
    "",
    "## Workload and routing",
    "",
    `- Unique PDFs / pages: ${report.workload.uniquePdfFiles} / ${report.workload.expectedPages}`,
    `- Native / primary planned pages: ${report.routing.plannedNativePages} / ${report.routing.plannedPrimaryPages}`,
    `- Selected page sources: ${JSON.stringify(report.routing.selectedPageSources)}`,
    `- Missing pages: ${report.workload.missingPages}`,
    "",
    "## Timing",
    "",
    `- Total wall: ${(report.measurement.totalWallMs / 1000).toFixed(3)}s`,
    `- Stage time: ${JSON.stringify(report.measurement.stageMs)}`,
    `- Peak RSS: ${(report.measurement.peakRssBytes / (1024 * 1024)).toFixed(1)} MiB`,
    "",
    "## Provider",
    "",
    `- Total calls: ${report.provider.totalCalls}`,
    ...providerLines,
    "",
    "## Quality against current reference",
    "",
    `- Compared pages: ${quality.pages}`,
    `- Full critical-token recall pages: ${quality.fullCriticalTokenRecallPages}`,
    `- Median token precision / recall / F1: ${percent(quality.tokenPrecision.p50)} / ${percent(quality.tokenRecall.p50)} / ${percent(quality.tokenF1.p50)}`,
    `- Pages below review threshold: ${quality.pagesBelowReferenceReviewThreshold}`,
    "",
    ...report.caveats.map((caveat) => `- ${caveat}`),
    "",
  ].join("\n");
}

function pageComplexity(reasons = []) {
  let value = 1;
  if (reasons.includes("no_embedded_text")) value += 0.3;
  if (reasons.includes("large_raster_image_risk")) value += 0.3;
  if (reasons.includes("layout_or_reading_order_risk")) value += 0.2;
  if (reasons.includes("form_or_annotation_content_risk")) value += 0.2;
  return value;
}

function unitKey(unit) {
  return `${String(unit?.documentId || "")}:${Number(unit?.page) || 0}`;
}

function normalizePageNumber(value, index) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : index + 1;
}

function padIndex(value) {
  return String(Number(value)).padStart(6, "0");
}

function bounded(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, Math.trunc(parsed)) : fallback;
}

function safeError(error) {
  return String(error?.message || error || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function percent(value) {
  return `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)}%`;
}

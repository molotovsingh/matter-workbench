import { SERVICE_LIMITS, assertPinnedProviderCapability } from "../../../packages/extraction-contracts/index.mjs";

const PLAN_SCHEMA = "document-intake-extraction.capacity-plan/v1";

export function planWorkloadCapacity({
  workload = {},
  corpusEstimate = {},
  providerStages = [],
  queue = {},
  workers = {},
  objective = {},
} = {}) {
  const expectedFiles = boundedInteger(workload.expectedFiles, "workload.expectedFiles", 1, SERVICE_LIMITS.maximumFiles);
  const expectedBytes = boundedInteger(workload.expectedBytes, "workload.expectedBytes", 1, SERVICE_LIMITS.maximumBytes);
  const committedFiles = boundedInteger(workload.committedFiles ?? 0, "workload.committedFiles", 0, expectedFiles);
  const committedBytes = boundedInteger(workload.committedBytes ?? 0, "workload.committedBytes", 0, expectedBytes);
  const observedPages = boundedInteger(workload.observedPages ?? 0, "workload.observedPages", 0, SERVICE_LIMITS.maximumPages);
  const remainingBytes = Math.max(0, expectedBytes - committedBytes);
  const progress = expectedBytes ? committedBytes / expectedBytes : committedFiles / expectedFiles;
  const prior = normalizeCorpusEstimate(corpusEstimate);
  const observedDensity = committedBytes > 0 && observedPages > 0 ? observedPages / committedBytes : null;
  const observationWeight = clamp(progress * 1.5, 0, 0.9);
  const density = {
    low: blend(prior.pagesPerByte.low, observedDensity ? observedDensity * 0.8 : prior.pagesPerByte.low, observationWeight),
    median: blend(prior.pagesPerByte.median, observedDensity || prior.pagesPerByte.median, observationWeight),
    high: blend(prior.pagesPerByte.high, observedDensity ? observedDensity * 1.25 : prior.pagesPerByte.high, observationWeight),
  };
  const minimumLogicalPages = Math.max(expectedFiles, observedPages);
  const pages = {
    low: clampInteger(observedPages + Math.floor(remainingBytes * density.low), minimumLogicalPages, SERVICE_LIMITS.maximumPages),
    median: clampInteger(observedPages + Math.round(remainingBytes * density.median), minimumLogicalPages, SERVICE_LIMITS.maximumPages),
    high: clampInteger(observedPages + Math.ceil(remainingBytes * density.high), minimumLogicalPages, SERVICE_LIMITS.maximumPages),
  };
  pages.median = clampInteger(pages.median, pages.low, pages.high);

  const p95Seconds = positiveNumber(objective.p95Seconds, "objective.p95Seconds", 60);
  const p99Seconds = positiveNumber(objective.p99Seconds, "objective.p99Seconds", 120);
  if (p99Seconds < p95Seconds) throw new Error("objective.p99Seconds must be at least p95Seconds");
  const fixedSeconds = nonNegativeNumber(objective.fixedSeconds, "objective.fixedSeconds", 3);
  const assemblySeconds = nonNegativeNumber(objective.assemblySeconds, "objective.assemblySeconds", 2);
  const usableP95Seconds = Math.max(1, p95Seconds - fixedSeconds - assemblySeconds);

  const workerPlan = planWorkers({ pages, workers, usableP95Seconds });
  const providerPlan = planProviders({
    pages,
    corpus: prior,
    providerStages,
    queueOperations: nonNegativeNumber(queue.weightedPageOperations, "queue.weightedPageOperations", 0),
  });
  const lowerSeconds = fixedSeconds + Math.max(workerPlan.seconds.low, providerPlan.seconds.low) + assemblySeconds;
  const upperSeconds = fixedSeconds + providerPlan.queueSeconds + Math.max(workerPlan.seconds.high, providerPlan.seconds.high) + assemblySeconds;
  const eta = {
    lowerSeconds: roundEta(lowerSeconds, "down"),
    upperSeconds: roundEta(upperSeconds, "up"),
    confidence: confidenceLabel({ progress, corpusSamples: prior.sampleCount, providerSamples: providerPlan.minimumSampleCount }),
    objectiveP95Seconds: p95Seconds,
    objectiveP99Seconds: p99Seconds,
  };
  eta.sloState = !Number.isFinite(upperSeconds)
    ? "exception_predicted"
    : eta.upperSeconds <= p95Seconds
      ? "within_p95"
      : eta.upperSeconds <= p99Seconds
        ? "p95_at_risk"
        : "exception_predicted";

  const uploadBytesPerSecond = nonNegativeNumber(workload.uploadBytesPerSecond, "workload.uploadBytesPerSecond", 0);
  const remainingUploadSeconds = uploadBytesPerSecond > 0 ? remainingBytes / uploadBytesPerSecond : null;
  const scaleLeadSeconds = workerPlan.bootP95Seconds + nonNegativeNumber(workers.scaleSafetySeconds, "workers.scaleSafetySeconds", 5);
  const additionalWorkers = Math.max(0, workerPlan.targetWorkers - workerPlan.activeWorkers);
  let scaleAction = "hold";
  if (additionalWorkers > 0) {
    if (remainingUploadSeconds === null || remainingUploadSeconds <= scaleLeadSeconds) scaleAction = "scale_now";
    else scaleAction = "schedule_during_upload";
  }

  const exceptionReasons = [];
  if (pages.high >= SERVICE_LIMITS.maximumPages && observedPages < SERVICE_LIMITS.maximumPages) exceptionReasons.push("page_envelope_at_risk");
  if (workerPlan.capacityLimited) exceptionReasons.push("local_worker_capacity");
  if (providerPlan.unavailableStages.length) exceptionReasons.push("provider_capacity_unavailable");
  if (providerPlan.quotaLimitedStages.length) exceptionReasons.push("provider_quota_capacity");
  if (providerPlan.queueSeconds > usableP95Seconds) exceptionReasons.push("queue_depth");
  if (eta.upperSeconds > p99Seconds) exceptionReasons.push("processing_objective_exceeded");

  return {
    schemaVersion: PLAN_SCHEMA,
    workload: {
      expectedFiles,
      expectedBytes,
      committedFiles,
      committedBytes,
      uploadProgress: progress,
      predictedPages: pages,
      predictedProviderPageOperations: providerPlan.pageOperations,
    },
    calibration: {
      corpusSampleCount: prior.sampleCount,
      minimumProviderSampleCount: providerPlan.minimumSampleCount,
      blendedPagesPerByte: density,
      observedPagesPerByte: observedDensity,
    },
    workers: workerPlan,
    providers: providerPlan,
    uploadScaleWindow: {
      remainingUploadSeconds: remainingUploadSeconds === null ? null : roundOne(remainingUploadSeconds),
      scaleLeadSeconds: roundOne(scaleLeadSeconds),
      additionalWorkers,
      action: scaleAction,
    },
    processingEta: eta,
    exception: {
      active: exceptionReasons.length > 0,
      reasons: Array.from(new Set(exceptionReasons)),
    },
  };
}

function planWorkers({ pages, workers, usableP95Seconds }) {
  const activeWorkers = boundedInteger(workers.activeWorkers ?? workers.warmWorkers ?? 1, "workers.activeWorkers", 0, 100_000);
  const warmWorkers = boundedInteger(workers.warmWorkers ?? 1, "workers.warmWorkers", 0, 100_000);
  const maximumWorkers = boundedInteger(workers.maximumWorkers ?? Math.max(1, activeWorkers), "workers.maximumWorkers", 1, 100_000);
  if (activeWorkers > maximumWorkers || warmWorkers > maximumWorkers) throw new Error("active and warm workers must not exceed workers.maximumWorkers");
  const operationsPerSecondPerWorker = positiveNumber(workers.pageOperationsPerSecondPerWorker, "workers.pageOperationsPerSecondPerWorker", 10);
  const scratchBytesPerWorker = positiveNumber(workers.scratchBytesPerWorker, "workers.scratchBytesPerWorker", 1024 * 1024 * 1024);
  const availableScratchBytes = positiveNumber(
    workers.availableScratchBytes,
    "workers.availableScratchBytes",
    maximumWorkers * scratchBytesPerWorker,
  );
  const scratchLimitedWorkers = Math.max(1, Math.floor(availableScratchBytes / scratchBytesPerWorker));
  const configuredCeiling = Math.max(1, Math.min(maximumWorkers, scratchLimitedWorkers));
  const requiredWorkers = Math.max(warmWorkers, Math.ceil(pages.high / (operationsPerSecondPerWorker * usableP95Seconds)));
  const targetWorkers = Math.min(configuredCeiling, requiredWorkers);
  const effectiveWorkers = Math.max(1, targetWorkers);
  return {
    activeWorkers,
    warmWorkers,
    maximumWorkers,
    scratchLimitedWorkers,
    requiredWorkers,
    targetWorkers,
    capacityLimited: targetWorkers < requiredWorkers,
    pageOperationsPerSecond: effectiveWorkers * operationsPerSecondPerWorker,
    seconds: {
      low: pages.low / (effectiveWorkers * operationsPerSecondPerWorker),
      median: pages.median / (effectiveWorkers * operationsPerSecondPerWorker),
      high: pages.high / (effectiveWorkers * operationsPerSecondPerWorker),
    },
    bootP95Seconds: positiveNumber(workers.bootP95Seconds, "workers.bootP95Seconds", 20),
  };
}

function planProviders({ pages, corpus, providerStages, queueOperations }) {
  const stages = providerStages.map((stage, index) => normalizeProviderStage(stage, index, corpus));
  const providerWorkRequired = corpus.ocrShare + corpus.repairShare > 0;
  const unavailableStages = stages.filter((stage) => !stage.available && stage.workShare > 0).map((stage) => stage.stage);
  if (!stages.length && providerWorkRequired) unavailableStages.push("provider_route");
  const quotaLimitedStages = [];
  let minimumSampleCount = stages.length ? Infinity : 0;
  const pageOperations = { low: 0, median: 0, high: 0 };
  const seconds = { low: 0, median: 0, high: 0 };
  for (const stage of stages) {
    minimumSampleCount = Math.min(minimumSampleCount, stage.sampleCount);
    const operations = {
      low: pages.low * stage.workShare,
      median: pages.median * stage.workShare,
      high: pages.high * stage.workShare,
    };
    for (const key of Object.keys(pageOperations)) pageOperations[key] += operations[key];
    if (!stage.available || stage.workShare <= 0) {
      if (stage.workShare > 0) seconds.high = Infinity;
      continue;
    }
    const requiredRate = operations.high / Math.max(1, stage.targetSeconds);
    if (stage.effectivePageOperationsPerSecond < requiredRate) quotaLimitedStages.push(stage.stage);
    seconds.low += operations.low / stage.optimisticPageOperationsPerSecond;
    seconds.median += operations.median / stage.medianPageOperationsPerSecond;
    seconds.high += operations.high / stage.effectivePageOperationsPerSecond;
  }
  if (!stages.length && providerWorkRequired) {
    seconds.low = Infinity;
    seconds.median = Infinity;
    seconds.high = Infinity;
    pageOperations.low = pages.low * (corpus.ocrShare + corpus.repairShare);
    pageOperations.median = pages.median * (corpus.ocrShare + corpus.repairShare);
    pageOperations.high = pages.high * (corpus.ocrShare + corpus.repairShare);
  }
  const totalEffectiveRate = stages
    .filter((stage) => stage.available && stage.workShare > 0)
    .reduce((sum, stage) => sum + stage.effectivePageOperationsPerSecond, 0);
  const queueSeconds = totalEffectiveRate > 0 ? queueOperations / totalEffectiveRate : queueOperations > 0 ? Infinity : 0;
  return {
    stages,
    unavailableStages,
    quotaLimitedStages: Array.from(new Set(quotaLimitedStages)),
    minimumSampleCount: Number.isFinite(minimumSampleCount) ? minimumSampleCount : 0,
    pageOperations,
    seconds,
    queueSeconds,
    totalEffectivePageOperationsPerSecond: totalEffectiveRate,
  };
}

function normalizeProviderStage(stage, index, corpus) {
  const workShare = clamp(nonNegativeNumber(
    stage.workShare,
    `providerStages[${index}].workShare`,
    index === 0 ? corpus.ocrShare : corpus.repairShare,
  ), 0, 2);
  const median = positiveNumber(stage.pageOperationsPerSecond, `providerStages[${index}].pageOperationsPerSecond`, 1);
  const conservative = positiveNumber(stage.conservativePageOperationsPerSecond, `providerStages[${index}].conservativePageOperationsPerSecond`, median * 0.7);
  const optimistic = positiveNumber(stage.optimisticPageOperationsPerSecond, `providerStages[${index}].optimisticPageOperationsPerSecond`, median * 1.15);
  const quota = positiveNumber(stage.quotaPageOperationsPerSecond, `providerStages[${index}].quotaPageOperationsPerSecond`, Infinity);
  const safetyFactor = clamp(nonNegativeNumber(stage.safetyFactor, `providerStages[${index}].safetyFactor`, 0.8), 0.05, 1);
  const throttleRate = clamp(nonNegativeNumber(stage.throttleRate, `providerStages[${index}].throttleRate`, 0), 0, 0.95);
  const capability = assertPinnedProviderCapability({
    provider: stage.provider,
    model: stage.model,
    adapterVersion: stage.adapterVersion,
  });
  return {
    stage: String(stage.stage || `stage-${index + 1}`),
    provider: capability.provider,
    model: capability.model,
    adapterVersion: capability.adapterVersion,
    available: stage.available !== false,
    workShare,
    sampleCount: boundedInteger(stage.sampleCount ?? 0, `providerStages[${index}].sampleCount`, 0, Number.MAX_SAFE_INTEGER),
    medianPageOperationsPerSecond: Math.min(median, quota),
    optimisticPageOperationsPerSecond: Math.min(optimistic, quota),
    effectivePageOperationsPerSecond: Math.min(conservative, quota) * safetyFactor * (1 - throttleRate),
    quotaPageOperationsPerSecond: quota,
    targetSeconds: positiveNumber(stage.targetSeconds, `providerStages[${index}].targetSeconds`, 55),
  };
}

function normalizeCorpusEstimate(input) {
  const median = positiveNumber(input.pagesPerByte?.median, "corpusEstimate.pagesPerByte.median", 1 / (256 * 1024));
  const low = positiveNumber(input.pagesPerByte?.low, "corpusEstimate.pagesPerByte.low", median * 0.5);
  const high = positiveNumber(input.pagesPerByte?.high, "corpusEstimate.pagesPerByte.high", median * 2);
  if (low > median || median > high) throw new Error("corpusEstimate pages-per-byte bounds must be ordered low <= median <= high");
  return {
    sampleCount: boundedInteger(input.sampleCount ?? 0, "corpusEstimate.sampleCount", 0, Number.MAX_SAFE_INTEGER),
    pagesPerByte: { low, median, high },
    ocrShare: clamp(nonNegativeNumber(input.ocrShare, "corpusEstimate.ocrShare", 1), 0, 1),
    repairShare: clamp(nonNegativeNumber(input.repairShare, "corpusEstimate.repairShare", 0.05), 0, 1),
  };
}

function confidenceLabel({ progress, corpusSamples, providerSamples }) {
  if (progress >= 0.8 && corpusSamples >= 20 && providerSamples >= 20) return "high";
  if (progress >= 0.25 && corpusSamples >= 5 && providerSamples >= 5) return "medium";
  return "low";
}

function roundEta(seconds, direction) {
  if (!Number.isFinite(seconds)) return null;
  const increment = seconds <= 60 ? 5 : seconds <= 300 ? 15 : 60;
  const value = direction === "down" ? Math.floor(seconds / increment) * increment : Math.ceil(seconds / increment) * increment;
  return Math.max(direction === "down" ? 0 : increment, value);
}

function blend(prior, observation, observationWeight) {
  return prior * (1 - observationWeight) + observation * observationWeight;
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

function positiveNumber(value, field, fallback) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const number = Number(value);
  if ((!Number.isFinite(number) && number !== Infinity) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}

function nonNegativeNumber(value, field, fallback) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be non-negative`);
  return number;
}

function clampInteger(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

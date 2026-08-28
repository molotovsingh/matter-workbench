import { assertPinnedProviderCapability } from "../../../packages/extraction-contracts/index.mjs";

const REQUIRED_CLASSES = Object.freeze({ repair_disagreement: 15, native: 10, difficult: 10 });

export function evaluateQualityCertification({ policy = {}, samples = [], arms = [] } = {}) {
  const reasons = [];
  const thresholdApprovalId = realIdentifier(policy.thresholdApprovalId, "policy.thresholdApprovalId");
  const maximumWer = rate(policy.maximumWer, "policy.maximumWer");
  const maximumCer = rate(policy.maximumCer, "policy.maximumCer");
  const qualityWeight = rate(policy.qualityWeight ?? 0.7, "policy.qualityWeight");
  const speedWeight = rate(policy.speedWeight ?? 0.3, "policy.speedWeight");
  if (Math.abs(qualityWeight + speedWeight - 1) > 1e-9) throw new Error("quality and speed weights must total 1");
  const normalizedSamples = samples.map(normalizeSample);
  const sampleMap = new Map(normalizedSamples.map((sample) => [sample.sampleId, sample]));
  if (sampleMap.size !== normalizedSamples.length) reasons.push("duplicate_golden_sample");
  const classCounts = Object.fromEntries(Object.keys(REQUIRED_CLASSES).map((sampleClass) => [
    sampleClass, normalizedSamples.filter((sample) => sample.sampleClass === sampleClass).length,
  ]));
  const missingClasses = Object.entries(REQUIRED_CLASSES)
    .filter(([sampleClass, minimum]) => classCounts[sampleClass] < minimum)
    .map(([sampleClass]) => sampleClass);
  if (missingClasses.length) reasons.push("golden_class_minimum_not_met");
  if (normalizedSamples.some((sample) => !sample.humanVerified || sample.adjudicationStatus !== "final")) reasons.push("golden_sample_not_final");
  if (normalizedSamples.some((sample) => sample.sampleClass === "repair_disagreement" && sample.adjudicatorCount < 2)) reasons.push("repair_disagreement_not_dual_adjudicated");
  const armResults = arms.map((arm, index) => evaluateArm(arm, index, sampleMap, { maximumWer, maximumCer }));
  if (!armResults.length) reasons.push("no_candidate_arms");
  const eligible = armResults.filter((arm) => arm.hardGatesPassed);
  if (!eligible.length) reasons.push("no_candidate_passed_hard_gates");
  const fastest = Math.max(0, ...eligible.map((arm) => arm.pagesPerSecond));
  for (const arm of armResults) {
    arm.qualityScore = Math.max(0, 1 - ((arm.wer + arm.cer) / 2));
    arm.speedScore = fastest > 0 ? arm.pagesPerSecond / fastest : 0;
    arm.compositeScore = arm.hardGatesPassed ? qualityWeight * arm.qualityScore + speedWeight * arm.speedScore : null;
  }
  eligible.sort((left, right) => right.compositeScore - left.compositeScore || left.wer - right.wer || right.pagesPerSecond - left.pagesPerSecond);
  return {
    schemaVersion: "document-intake-extraction.quality-certification/v1",
    certified: reasons.length === 0,
    thresholdApprovalId,
    policy: { maximumWer, maximumCer, qualityWeight, speedWeight, requiredClasses: { ...REQUIRED_CLASSES } },
    evidence: { samples: normalizedSamples.length, classCounts, missingClasses },
    recommendedCapability: eligible[0]?.capability || null,
    arms: armResults,
    reasons,
  };
}

function evaluateArm(input = {}, index, sampleMap, policy) {
  const capability = assertPinnedProviderCapability(input.capability);
  const measurements = Array.isArray(input.measurements) ? input.measurements.map(normalizeMeasurement) : [];
  const bySample = new Map(measurements.map((measurement) => [measurement.sampleId, measurement]));
  const reasons = [];
  if (bySample.size !== measurements.length) reasons.push("duplicate_measurement");
  const missingSamples = Array.from(sampleMap.keys()).filter((sampleId) => !bySample.has(sampleId));
  const extraSamples = Array.from(bySample.keys()).filter((sampleId) => !sampleMap.has(sampleId));
  if (missingSamples.length) reasons.push("golden_samples_missing");
  if (extraSamples.length) reasons.push("unknown_samples_present");
  const relevant = Array.from(sampleMap.keys(), (sampleId) => bySample.get(sampleId)).filter(Boolean);
  const totalWords = relevant.reduce((sum, measurement) => sum + measurement.totalWords, 0);
  const totalCharacters = relevant.reduce((sum, measurement) => sum + measurement.totalCharacters, 0);
  const wordErrors = relevant.reduce((sum, measurement) => sum + measurement.wordErrors, 0);
  const characterErrors = relevant.reduce((sum, measurement) => sum + measurement.characterErrors, 0);
  const criticalExpected = relevant.reduce((sum, measurement) => sum + measurement.criticalExpected, 0);
  const criticalMatched = relevant.reduce((sum, measurement) => sum + measurement.criticalMatched, 0);
  const durationMs = relevant.reduce((sum, measurement) => sum + measurement.durationMs, 0);
  const wer = totalWords > 0 ? wordErrors / totalWords : 1;
  const cer = totalCharacters > 0 ? characterErrors / totalCharacters : 1;
  if (criticalMatched !== criticalExpected) reasons.push("legal_critical_field_loss");
  if (wer > policy.maximumWer) reasons.push("wer_threshold_missed");
  if (cer > policy.maximumCer) reasons.push("cer_threshold_missed");
  if (relevant.some((measurement) => measurement.omitted || measurement.finishReason !== "complete")) reasons.push("page_completeness_failed");
  return {
    armId: realIdentifier(input.armId, `arms[${index}].armId`),
    capability,
    measurements: measurements.length,
    missingSamples,
    extraSamples,
    wer,
    cer,
    criticalMatched,
    criticalExpected,
    durationMs,
    pagesPerSecond: durationMs > 0 ? relevant.length / (durationMs / 1000) : 0,
    hardGatesPassed: reasons.length === 0,
    reasons,
  };
}

function normalizeSample(input = {}, index) {
  const sampleClass = String(input.sampleClass || "");
  if (!Object.hasOwn(REQUIRED_CLASSES, sampleClass)) throw new Error(`samples[${index}].sampleClass is invalid`);
  const sourcePageSha256 = String(input.sourcePageSha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sourcePageSha256)) throw new Error(`samples[${index}].sourcePageSha256 is invalid`);
  return {
    sampleId: realIdentifier(input.sampleId, `samples[${index}].sampleId`),
    sampleClass,
    sourcePageSha256,
    humanVerified: input.humanVerified === true,
    adjudicationStatus: String(input.adjudicationStatus || ""),
    adjudicatorCount: positiveInteger(input.adjudicatorCount, `samples[${index}].adjudicatorCount`),
  };
}

function normalizeMeasurement(input = {}, index) {
  const totalWords = positiveInteger(input.totalWords, `measurements[${index}].totalWords`);
  const totalCharacters = positiveInteger(input.totalCharacters, `measurements[${index}].totalCharacters`);
  const criticalExpected = nonNegativeInteger(input.criticalExpected, `measurements[${index}].criticalExpected`);
  const criticalMatched = nonNegativeInteger(input.criticalMatched, `measurements[${index}].criticalMatched`);
  if (criticalMatched > criticalExpected) throw new Error(`measurements[${index}].criticalMatched exceeds expected`);
  return {
    sampleId: realIdentifier(input.sampleId, `measurements[${index}].sampleId`),
    totalWords,
    wordErrors: nonNegativeInteger(input.wordErrors, `measurements[${index}].wordErrors`),
    totalCharacters,
    characterErrors: nonNegativeInteger(input.characterErrors, `measurements[${index}].characterErrors`),
    criticalExpected,
    criticalMatched,
    durationMs: positiveNumber(input.durationMs, `measurements[${index}].durationMs`),
    omitted: input.omitted === true,
    finishReason: String(input.finishReason || ""),
  };
}

function realIdentifier(value, field) {
  const normalized = String(value || "").trim().slice(0, 240);
  if (!normalized || /(?:todo|tbd|unknown|placeholder)/i.test(normalized)) throw new Error(`${field} requires a real identifier`);
  return normalized;
}

function rate(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${field} must be from 0 to 1`);
  return number;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${field} must be a non-negative integer`);
  return number;
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}

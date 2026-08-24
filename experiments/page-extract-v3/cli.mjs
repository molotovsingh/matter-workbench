#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

import { captureCurrentV3Baseline } from "./lib/baseline.mjs";
import { runCurrentProviderCandidate } from "./lib/current-candidate-runner.mjs";
import { buildV3RoutePlan } from "./lib/route-plan.mjs";

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const [command = "help", ...rest] = argv;
  const options = parseOptions(rest);

  if (command === "help") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  if (command === "baseline") {
    const baseline = await captureCurrentV3Baseline({
      v2Root: required(options, "v2-root"),
      sessionId: required(options, "session-id"),
      outFile: required(options, "out"),
    });
    print({
      command,
      schemaVersion: baseline.schemaVersion,
      workload: baseline.workload,
      criticalPath: baseline.timing.exactCriticalPathSample,
      repair: {
        statuses: baseline.pipeline.repairStatuses,
        solelyUnknownConfidence: baseline.pipeline.repairUsedSolelyForUnknownConfidenceFiles,
        failures: baseline.pipeline.repairFailures,
      },
    });
    return 0;
  }

  if (command === "plan") {
    const report = await buildV3RoutePlan({
      v2Root: required(options, "v2-root"),
      sessionId: required(options, "session-id"),
      outFile: required(options, "out"),
      concurrency: positiveInteger(options.concurrency, 2, 8),
      policy: {
        minimumCharacters: optionalNumber(options["minimum-characters"]),
        minimumWords: optionalNumber(options["minimum-words"]),
        minimumCharactersForShortPage: optionalNumber(options["minimum-short-page-characters"]),
        minimumLargeImagePixels: optionalNumber(options["minimum-large-image-pixels"]),
        maximumRepeatedNgramRatio: optionalNumber(options["maximum-repeated-ngram-ratio"]),
      },
      onProgress: progressPrinter("plan"),
    });
    print({
      command,
      schemaVersion: report.schemaVersion,
      workload: report.workload,
      routing: report.routing,
      referenceComparison: report.referenceComparison,
      projectedPrimaryOcrCost: report.projectedPrimaryOcrCost,
      measurement: report.measurement,
    });
    return 0;
  }

  if (command === "run-current") {
    const report = await runCurrentProviderCandidate({
      v2Root: required(options, "v2-root"),
      routePlanFile: required(options, "route-plan"),
      root: required(options, "root"),
      candidateId: required(options, "candidate-id"),
      preflightConcurrency: positiveInteger(options["preflight-concurrency"], 2, 8),
      primaryConcurrency: positiveInteger(options["primary-concurrency"], 4, 32),
      repairConcurrency: positiveInteger(options["repair-concurrency"], 4, 32),
      primaryMaxPages: positiveInteger(options["primary-max-pages"], 16, 64),
      repairMaxPages: positiveInteger(options["repair-max-pages"], 4, 16),
      repairModel: String(options["repair-model"] || "gemini-2.5-pro"),
      repairThinkingLevel: String(options["repair-thinking-level"] || ""),
      prepareOnly: Boolean(options["prepare-only"]),
      env,
      onProgress: progressPrinter("run"),
    });
    print(report.state === "prepared" ? {
      command,
      candidateId: report.candidateId,
      state: report.state,
      workload: report.workload,
      primaryBatches: report.primaryBatches,
      measurement: report.measurement,
    } : {
      command,
      candidateId: report.candidateId,
      verdict: report.verdict,
      workload: report.workload,
      routing: report.routing,
      tasks: report.tasks,
      provider: report.provider,
      qualityAgainstCurrentReference: report.qualityAgainstCurrentReference,
      measurement: report.measurement,
    });
    return 0;
  }

  throw new Error(`Unknown V3 experiment command: ${command}`);
}

function parseOptions(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function required(options, key) {
  const value = String(options[key] || "").trim();
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function progressPrinter(label) {
  let lastPrinted = 0;
  return ({ completedFiles, attemptedFiles }) => {
    const completed = Number(completedFiles) || 0;
    const total = Number(attemptedFiles) || 0;
    if (completed !== total && completed - lastPrinted < 10) return;
    lastPrinted = completed;
    process.stderr.write(`[v3:${label}] ${completed}/${total}\n`);
  };
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, Math.trunc(parsed)) : fallback;
}

function optionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function usage() {
  return [
    "Page Extract V3 isolated experiment",
    "",
    "Commands:",
    "  baseline --v2-root DIR --session-id ID --out FILE",
    "  plan --v2-root DIR --session-id ID --out FILE [--concurrency 2]",
    "       [--minimum-characters 120] [--minimum-words 8] [--minimum-short-page-characters 240]",
    "       [--minimum-large-image-pixels 200000] [--maximum-repeated-ngram-ratio 0.08]",
    "  run-current --v2-root DIR --route-plan FILE --root DIR --candidate-id ID",
    "       [--preflight-concurrency 2] [--primary-concurrency 4] [--repair-concurrency 4]",
    "       [--primary-max-pages 16] [--repair-max-pages 4] [--prepare-only]",
    "       [--repair-model gemini-2.5-pro] [--repair-thinking-level LEVEL]",
    "",
    "The baseline and plan commands are read-only and make no provider calls.",
    "The run-current command makes real billed Mistral and Gemini calls.",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

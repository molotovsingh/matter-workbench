#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

import { captureCurrentV3Baseline } from "./lib/baseline.mjs";

export async function runCli(argv = process.argv.slice(2)) {
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

function usage() {
  return [
    "Page Extract V3 isolated experiment",
    "",
    "Commands:",
    "  baseline --v2-root DIR --session-id ID --out FILE",
    "",
    "The baseline command is read-only and makes no provider calls.",
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

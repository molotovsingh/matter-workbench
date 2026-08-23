#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

import { runV2Extraction } from "./lib/extract-runner.mjs";
import { buildV2BenchmarkReport } from "./lib/report.mjs";
import { captureRuntimeBaseline } from "./lib/runtime-baseline.mjs";
import { exportRuntimeUploadFixture } from "./lib/runtime-fixture.mjs";
import { uploadFixture } from "./lib/upload-client.mjs";
import { createV2UploadServer } from "./lib/upload-server.mjs";
import { positiveInteger } from "./lib/util.mjs";

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const [command = "help", ...rest] = argv;
  const options = parseOptions(rest);

  if (command === "help") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  if (command === "snapshot") {
    const fixture = await exportRuntimeUploadFixture({
      databaseUrl: env.MWB_RUNTIME_DATABASE_URL || env.DATABASE_URL || "",
      tenantId: required(options, "tenant-id"),
      sessionId: required(options, "session-id"),
      batchId: required(options, "batch-id"),
      outDir: required(options, "out"),
      force: Boolean(options.force),
    });
    print({ command, summary: fixture.summary, fixtureId: fixture.fixtureId });
    return 0;
  }

  if (command === "serve") {
    const token = env.V2_UPLOAD_TOKEN || "";
    const service = createV2UploadServer({ root: required(options, "root"), token });
    const address = await service.listen({
      host: String(options.host || "127.0.0.1"),
      port: positiveInteger(options.port, 4299, { max: 65535 }),
    });
    print({ command, status: "ready", ...address });
    await waitForSignal();
    await service.close();
    return 0;
  }

  if (command === "upload") {
    const summary = await uploadFixture({
      fixtureDir: required(options, "fixture"),
      baseUrl: required(options, "base-url"),
      token: env.V2_UPLOAD_TOKEN || "",
      sessionId: required(options, "session-id"),
      concurrency: positiveInteger(options.concurrency, 4, { max: 16 }),
      stopAfter: options["stop-after"] ? positiveInteger(options["stop-after"], 0) : 0,
      onProgress: progressPrinter("upload"),
    });
    print({ command, sessionId: summary.id, state: summary.state, counts: summary.counts });
    return 0;
  }

  if (command === "extract") {
    const summary = await runV2Extraction({
      root: required(options, "root"),
      sessionId: required(options, "session-id"),
      concurrency: positiveInteger(options.concurrency, 2, { max: 8 }),
      stopAfter: options["stop-after"] ? positiveInteger(options["stop-after"], 0) : 0,
      env,
      requireRealProvider: !options["allow-no-provider"],
      onProgress: progressPrinter("extract"),
    });
    print({ command, sessionId: summary.sessionId, state: summary.state, counts: summary.counts });
    return 0;
  }

  if (command === "baseline") {
    const baseline = await captureRuntimeBaseline({
      databaseUrl: env.MWB_RUNTIME_DATABASE_URL || env.DATABASE_URL || "",
      tenantId: required(options, "tenant-id"),
      matterId: required(options, "matter-id"),
      jobId: required(options, "job-id"),
      extractionLogKey: required(options, "extraction-log-key"),
      outFile: required(options, "out"),
    });
    print({ command, upload: baseline.upload, extraction: baseline.extraction });
    return 0;
  }

  if (command === "report") {
    const report = await buildV2BenchmarkReport({
      root: required(options, "root"),
      sessionId: required(options, "session-id"),
      baselineFile: required(options, "baseline"),
      outFile: required(options, "out"),
    });
    print({ command, verdict: report.verdict, comparison: report.comparison });
    return 0;
  }

  throw new Error(`Unknown v2 experiment command: ${command}`);
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

function progressPrinter(label) {
  let lastPrinted = 0;
  return (progress) => {
    const completed = Number(progress.completedFiles) || 0;
    const total = Number(progress.attemptedFiles) || 0;
    if (completed !== total && completed - lastPrinted < 10) return;
    lastPrinted = completed;
    process.stderr.write(`[v2:${label}] ${completed}/${total}\n`);
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function waitForSignal() {
  return new Promise((resolve) => {
    const done = () => resolve();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

function usage() {
  return [
    "Upload + Extract v2 isolated experiment",
    "",
    "Commands:",
    "  snapshot --tenant-id ID --session-id ID --batch-id ID --out DIR [--force]",
    "  serve --root DIR [--host 127.0.0.1] [--port 4299]   (requires V2_UPLOAD_TOKEN)",
    "  upload --fixture DIR --base-url URL --session-id ID [--concurrency 4] [--stop-after N]",
    "  extract --root DIR --session-id ID [--concurrency 2] [--stop-after N]",
    "  baseline --tenant-id ID --matter-id ID --job-id ID --extraction-log-key KEY --out FILE",
    "  report --root DIR --session-id ID --baseline FILE --out FILE",
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

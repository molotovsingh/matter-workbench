#!/usr/bin/env node
// Isolated V4 document-intake-extraction runner.
//
// Drives the full V4 pipeline for a folder of PDFs against a local PostgreSQL
// database and a filesystem object store, using the real composition root and
// real (or mock) provider adapters. It exercises the same code paths certified
// by the acceptance matrix but stays entirely outside production routes,
// builds, and deployments.
//
//   node services/document-intake-extraction/dev/isolated-run.mjs --dir ./sample-pdfs
//   node services/document-intake-extraction/dev/isolated-run.mjs --dir ./sample-pdfs --mock-providers
//
// Options:
//   --dir <path>            Folder of PDFs to process (searched recursively). Required.
//   --mock-providers        Deterministic no-cost providers instead of Mistral/Gemini.
//   --env-file <path>       Env file for MISTRAL_API_KEY / GEMINI_API_KEY / GOOGLE_API_KEY.
//                           Defaults to ./.env, then /Users/aksingh/matter-workbench/.env.
//   --db-admin <url>        Admin PostgreSQL URL (default postgres://127.0.0.1:5432/postgres).
//   --db-name <name>        Isolated database name (default mwb_v4_isolated).
//   --lanes <n>             Range-worker lanes (default 4).
//   --repair-lanes <n>      Repair-worker lanes (default 1).
//   --timeout-minutes <n>   Overall processing timeout (default 30).
//   --out <path>            Output directory (default ./v4-isolated-results/run-<stamp>).

import { constants as fsConstants, createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";

import { createDocumentIntakeExtractionV4Composition } from "../composition/create-v4-composition.mjs";
import { runDocumentIntakeExtractionMigrations } from "../postgres/migrate.mjs";
import { buildDocumentIntakeExtractionRuntimeRoleSql } from "../postgres/runtime-role-sql.mjs";
import { S3CompatibleObjectStore } from "../adapters/s3-compatible-object-store.mjs";
import { PdfInfoDocumentInspector } from "../../../workers/document-processing/pdfinfo-document-inspector.mjs";
import { PdfNativeTextInspector } from "../../../workers/document-processing/pdf-native-text-inspector.mjs";
import { createNativeTextPageProvider } from "../../../workers/document-processing/native-text-page-provider.mjs";
import { createMistralOcr41PageAdapter } from "../providers/mistral-ocr41-adapter.mjs";
import { PdfPageMaterializer } from "../../../workers/document-processing/pdf-page-materializer.mjs";
import { WorkerScratchSpace } from "../../../workers/document-processing/worker-scratch-space.mjs";
import {
  MISTRAL_OCR41_RANGE_CAPABILITY,
  createMistralOcr41RangeAdapter,
} from "../providers/mistral-ocr41-range-adapter.mjs";
import {
  GEMINI37_REPAIR_CAPABILITY,
  createGemini37RepairPageAdapter,
} from "../providers/gemini37-repair-adapter.mjs";
import { createGemini37RangeAdapter } from "../providers/gemini37-range-adapter.mjs";
import { AdaptiveProviderAdmissionController } from "../capacity/adaptive-provider-admission.mjs";
import { startWatchDashboard } from "./watch-dashboard.mjs";
import {
  buildAdmissionController,
  buildProviderSuite,
  createLocalDiskS3,
  startWorkerFleet,
  suiteProviderStages,
} from "../integration/local-composition.mjs";
import { CONTRACT_VERSIONS } from "../../../packages/extraction-contracts/index.mjs";

const TERMINAL_INTAKE_STATUSES = new Set(["ready", "ready_with_review"]);


async function main() {
  const options = parseArguments(process.argv.slice(2));
  await loadEnvFile(options);
  const files = await scanPdfFiles(options.dir);
  if (!files.length) fail(`no PDF files found under ${options.dir}`);
  log(`found ${files.length} PDF file(s), ${formatBytes(files.reduce((sum, file) => sum + file.expectedBytes, 0))} total`);

  const homeRoot = path.join(os.homedir(), ".mwb-v4-isolated");
  const adminPool = new pg.Pool({ connectionString: options.dbAdminUrl, max: 3 });
  let runtimePool = null;
  const abort = new AbortController();
  const timings = { startedAt: Date.now() };
  try {
    const databaseUrl = await ensureDatabase(adminPool, options);
    const databaseAdminPool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
    let runtimeUrl;
    try {
      const migrated = await runDocumentIntakeExtractionMigrations({ pool: databaseAdminPool });
      const fresh = migrated.migrations.filter((migration) => migration.status === "applied").length;
      log(`database ${options.dbName}: ${migrated.migrations.length} V4 migrations (${fresh} newly applied)`);
      runtimeUrl = await ensureRuntimeRole(adminPool, databaseAdminPool, databaseUrl, homeRoot);
    } finally {
      await databaseAdminPool.end();
    }
    runtimePool = new pg.Pool({ connectionString: runtimeUrl, max: Math.max(8, options.lanes + options.repairLanes + 4) });

    const localS3 = createLocalDiskS3({ root: path.join(homeRoot, "object-store") });
    const inspectorScratch = new WorkerScratchSpace({ root: path.join(homeRoot, "scratch", "inspector") });
    const { primaryProvider, repairProvider, ladder = null, providerLabel } = buildProviders(options);
    const repairLadder = ladder && ladder.length ? ladder : [repairProvider];
    const nativeProvider = options.native ? createNativeTextPageProvider() : null;
    log(`providers: ${providerLabel}${nativeProvider ? " + free native-text lane" : ""}`);

    // Backpressure instead of futile calls, with dynamic slow-start lanes —
    // the same shared shape the flag-gated app mount uses.
    const suite = { primaryProvider, repairProvider, repairLadder, nativeProvider, label: providerLabel };
    const admissionController = buildAdmissionController({
      suite,
      lanes: options.lanes,
      minLanes: options.minLanes,
      repairLanes: options.repairLanes,
      rangePages: options.rangePages,
      admissionRate: options.admissionRate,
    });

    const composition = createDocumentIntakeExtractionV4Composition({
      admissionController,
      pool: runtimePool,
      objectStoreFactory: ({ authorizationStore }) => new S3CompatibleObjectStore({
        bucket: "mwb-v4-isolated",
        region: "local-disk",
        presigner: localS3.presigner,
        client: localS3.client,
        authorizationStore,
      }),
      documentInspectorFactory: ({ objectStore: store }) => (options.native
        ? new PdfNativeTextInspector({ objectStore: store, scratchSpace: inspectorScratch })
        : new PdfInfoDocumentInspector({ objectStore: store, scratchSpace: inspectorScratch })),
      primaryProvider,
      repairProvider,
      repairProviders: repairLadder.length > 1 ? repairLadder : undefined,
      nativeProvider,
      providerStages: [
        ...(nativeProvider ? [{ stage: "native_text", ...nativeProvider.capability, workShare: 0.4, fallback: { pageOperationsPerSecond: 50 } }] : []),
        { stage: "primary_ocr", ...primaryProvider.capability, workShare: 0.9, fallback: { pageOperationsPerSecond: 4 } },
        { stage: "selective_repair", ...repairProvider.capability, workShare: 0.1, fallback: { pageOperationsPerSecond: 0.5 } },
      ],
      workerCapacity: {
        activeWorkers: options.lanes,
        warmWorkers: options.lanes,
        maximumWorkers: options.lanes * 2,
        pageOperationsPerSecondPerWorker: 4,
      },
    });
    const service = composition.service;
    await service.initialize();

    let currentIntakeId = "";
    const dashboard = options.watch
      ? startWatchDashboard({
        port: options.watchPort,
        service,
        tenantId: options.tenantId,
        getIntakeId: () => currentIntakeId,
        admissionController,
        pool: runtimePool,
      })
      : null;
    if (dashboard) log(`watch dashboard live at ${dashboard.url}`);

    const workerRuns = startWorkers({ composition, options, homeRoot, signal: abort.signal, dashboard, repairLadder, nativeProvider });

    const tenantId = options.tenantId;
    timings.uploadStartedAt = Date.now();
    const intake = await service.createIntake({
      schemaVersion: CONTRACT_VERSIONS.createIntakeCommand,
      tenantId,
      matterId: options.matterId,
      idempotencyKey: `isolated-run-${timings.startedAt}`,
      workloadClass: "mixed_legal",
      files: files.map((file) => ({
        originalName: file.originalName,
        relativePath: file.relativePath,
        expectedBytes: file.expectedBytes,
      })),
    });
    currentIntakeId = intake.intakeId;
    log(`intake ${intake.intakeId} created (${intake.files.length} files); workers are live — upload/OCR overlap is on`);

    const uploaded = await mapWithConcurrency(intake.files, options.uploadConcurrency, async (intakeFile) => {
      const local = files.find((file) => file.relativePath === intakeFile.relativePath);
      const bytes = await readFile(local.absolutePath);
      await localS3.performPresignedPut(intakeFile.uploadAuthorization, bytes);
      const receipt = await service.commitFileCustody({
        tenantId,
        intakeId: intake.intakeId,
        fileId: intakeFile.fileId,
        uploadToken: intakeFile.uploadAuthorization.token,
      });
      log(`  committed ${local.relativePath} — ${receipt.pageCount} page(s), sha ${receipt.sha256.slice(0, 12)}…${receipt.objectReused ? " (duplicate bytes reused)" : ""}`);
      return receipt;
    });
    timings.uploadFinishedAt = Date.now();

    const committed = await service.commitBatchCustody({ tenantId, intakeId: intake.intakeId });
    timings.custodyCommittedAt = Date.now();
    const totalPages = Number(committed.observedPageCount || uploaded.reduce((sum, receipt) => sum + receipt.pageCount, 0));
    admissionController.setDemandCeiling(primaryProvider.capability, Math.ceil(totalPages / options.rangePages));
    log(`batch custody committed: ${committed.committedFileCount ?? files.length} files, ${totalPages} logical pages — processing SLO clock starts now`);

    const finalIntake = await pollUntilReady({ service, tenantId, intakeId: intake.intakeId, options, timings });
    abort.abort();
    await Promise.allSettled(workerRuns);

    const result = finalIntake.resultId
      ? await service.getResult({ tenantId, resultId: finalIntake.resultId })
      : null;
    const evidence = await collectEvidence(databaseUrl, tenantId, intake.intakeId);
    await writeOutputs({ options, timings, files, finalIntake, result, evidence, totalPages });
    printSummary({ timings, files, finalIntake, result, evidence, totalPages, options });
    if (dashboard) {
      log("watch dashboard stays live for 3 more minutes (Ctrl-C to end sooner)");
      await sleep(180_000);
      await dashboard.close();
    }
  } finally {
    abort.abort();
    await runtimePool?.end().catch(() => {});
    await adminPool.end().catch(() => {});
  }
}

function parseArguments(argv) {
  const options = {
    dir: "",
    mockProviders: false,
    envFile: "",
    dbAdminUrl: "postgres://127.0.0.1:5432/postgres",
    dbName: "mwb_v4_isolated",
    lanes: 4,
    repairLanes: 1,
    uploadConcurrency: 3,
    timeoutMinutes: 30,
    out: "",
    tenantId: "isolated-dev-tenant",
    matterId: "isolated-dev-matter",
    primary: "gemini",
    rangePages: 8,
    admissionRate: 40,
    minLanes: 2,
    watch: false,
    watchPort: 4499,
    apex: true,
    native: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) fail(`${flag} requires a value`);
      return argv[index];
    };
    if (flag === "--dir") options.dir = path.resolve(next());
    else if (flag === "--mock-providers") options.mockProviders = true;
    else if (flag === "--env-file") options.envFile = path.resolve(next());
    else if (flag === "--db-admin") options.dbAdminUrl = next();
    else if (flag === "--db-name") options.dbName = requireIdentifier(next(), "--db-name");
    else if (flag === "--lanes") options.lanes = requireInteger(next(), "--lanes", 1, 128);
    else if (flag === "--repair-lanes") options.repairLanes = requireInteger(next(), "--repair-lanes", 1, 8);
    else if (flag === "--timeout-minutes") options.timeoutMinutes = requireInteger(next(), "--timeout-minutes", 1, 240);
    else if (flag === "--out") options.out = path.resolve(next());
    else if (flag === "--tenant") options.tenantId = next();
    else if (flag === "--primary") {
      options.primary = next();
      if (!["mistral", "gemini"].includes(options.primary)) fail("--primary must be mistral or gemini");
    } else if (flag === "--range-pages") options.rangePages = requireInteger(next(), "--range-pages", 1, 32);
    else if (flag === "--admission-rate") options.admissionRate = requireInteger(next(), "--admission-rate", 1, 1000);
    else if (flag === "--min-lanes") options.minLanes = requireInteger(next(), "--min-lanes", 1, 128);
    else if (flag === "--watch") options.watch = true;
    else if (flag === "--no-apex") options.apex = false;
    else if (flag === "--no-native") options.native = false;
    else if (flag === "--watch-port") options.watchPort = requireInteger(next(), "--watch-port", 1024, 65535);
    else if (flag === "--range-timeout-ms") options.rangeTimeoutMs = requireInteger(next(), "--range-timeout-ms", 5_000, 600_000);
    else if (flag === "--range-first-timeout-ms") options.rangeFirstAttemptTimeoutMs = requireInteger(next(), "--range-first-timeout-ms", 5_000, 600_000);
    else fail(`unknown option ${flag}`);
  }
  if (options.minLanes > options.lanes) fail("--min-lanes must not exceed --lanes (the maximum lane pool)");
  return finishOptions(options);
}

function finishOptions(options) {
  if (!options.dir) fail("--dir <pdf folder> is required");
  if (!options.out) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    options.out = path.resolve(`v4-isolated-results/run-${stamp}`);
  }
  return options;
}

async function loadEnvFile(options) {
  if (options.mockProviders) return;
  const candidates = options.envFile
    ? [options.envFile]
    : [path.resolve(".env"), "/Users/aksingh/matter-workbench/.env"];
  for (const candidate of candidates) {
    let content;
    try {
      content = await readFile(candidate, "utf8");
    } catch {
      continue;
    }
    let loaded = 0;
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      if (!value || process.env[key]) continue;
      process.env[key] = value.trim();
      loaded += 1;
    }
    log(`loaded ${loaded} env value(s) from ${candidate}`);
    return;
  }
}

function buildProviders(options) {
  if (options.mockProviders) {
    // Distinct adapterVersion so mock page computations can never satisfy
    // real-provider demands through single-flight fingerprint reuse.
    return {
      providerLabel: "MOCK (no provider calls, no cost)",
      primaryProvider: {
        capability: { ...MISTRAL_OCR41_RANGE_CAPABILITY, adapterVersion: "isolated-mock-range-adapter/1.0.0" },
        extractPages: async ({ pageNumbers }) => pageNumbers.map((pageNumber) => ({
          pageNumber,
          text: `Mock OCR transcription for page ${pageNumber}. This deterministic text exists only to exercise the isolated V4 pipeline without paid provider calls.`,
          finishReason: "complete",
          requestId: `mock-primary-${pageNumber}`,
          usage: { inputUnits: 1, outputUnits: 1 },
          billedCostUsd: 0,
          diagnostics: [],
        })),
      },
      repairProvider: {
        capability: { ...GEMINI37_REPAIR_CAPABILITY, adapterVersion: "isolated-mock-repair-adapter/1.0.0" },
        extractPage: async ({ pageNumber }) => ({
          pageNumber,
          text: `Mock repair transcription for page ${pageNumber}.`,
          finishReason: "complete",
          requestId: `mock-repair-${pageNumber}`,
          usage: { inputUnits: 1, outputUnits: 1 },
          billedCostUsd: 0,
          diagnostics: [],
        }),
      },
      ladder: null,
    };
  }
  const geminiKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!geminiKey) fail("GEMINI_API_KEY or GOOGLE_API_KEY is required (or use --mock-providers)");
  if (options.apex && !String(process.env.OPENAI_API_KEY || "").trim()) log("apex rung disabled: OPENAI_API_KEY is not configured");
  // The same suite builder the flag-gated app mount uses — one wiring, no twins.
  let suite;
  try {
    suite = buildProviderSuite({
      geminiKey,
      mistralKey: process.env.MISTRAL_API_KEY,
      openaiKey: options.apex ? process.env.OPENAI_API_KEY : "",
      primary: options.primary,
      apex: options.apex,
      native: false,
      gptInputUsdPerMillionTokens: Number(process.env.GPT54_REPAIR_INPUT_USD_PER_M || 1.25),
      gptOutputUsdPerMillionTokens: Number(process.env.GPT54_REPAIR_OUTPUT_USD_PER_M || 7.5),
      // Per-corpus ceiling: dense archival scans need more than the office-doc
      // sized defaults (see the load-certification doc's storm-run findings).
      rangeTimeoutMs: options.rangeTimeoutMs,
      rangeFirstAttemptTimeoutMs: options.rangeFirstAttemptTimeoutMs,
    });
  } catch (error) {
    fail(`${error.message} (or use --mock-providers)`);
  }
  return {
    providerLabel: `${suite.label} (paid calls)`,
    primaryProvider: suite.primaryProvider,
    repairProvider: suite.repairProvider,
    ladder: suite.repairLadder,
  };
}

async function ensureDatabase(adminPool, options) {
  const existing = await adminPool.query("select 1 from pg_database where datname = $1", [options.dbName]);
  if (!existing.rows.length) {
    await adminPool.query(`create database "${options.dbName.replaceAll('"', '""')}"`);
    log(`created database ${options.dbName}`);
  }
  const url = new URL(options.dbAdminUrl);
  url.pathname = `/${options.dbName}`;
  return url.toString();
}

async function ensureRuntimeRole(adminPool, databaseAdminPool, databaseUrl, homeRoot) {
  const roleName = "mwb_v4_isolated_runtime";
  const credentialsPath = path.join(homeRoot, "runtime-role.json");
  let password = "";
  try {
    password = JSON.parse(await readFile(credentialsPath, "utf8")).password || "";
  } catch {}
  const existing = await adminPool.query("select 1 from pg_roles where rolname = $1", [roleName]);
  if (!existing.rows.length || !password) {
    password = randomBytes(24).toString("base64url");
    if (existing.rows.length) {
      await adminPool.query(`alter role "${roleName}" login password '${password.replaceAll("'", "''")}'`);
    } else {
      await adminPool.query(`create role "${roleName}" login password '${password.replaceAll("'", "''")}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    }
    await mkdir(homeRoot, { recursive: true, mode: 0o700 });
    await writeFile(credentialsPath, `${JSON.stringify({ roleName, password }, null, 2)}\n`, { mode: 0o600 });
  }
  await databaseAdminPool.query(buildDocumentIntakeExtractionRuntimeRoleSql({ roleName }));
  const url = new URL(databaseUrl);
  url.username = roleName;
  url.password = password;
  return url.toString();
}

function startWorkers({ composition, options, homeRoot, signal, dashboard = null, repairLadder = [], nativeProvider = null }) {
  const pageMaterializer = new PdfPageMaterializer();
  const onOutcome = (label) => async (event) => {
    if (event.type === "completed") {
      const outcome = event.outcome;
      log(`  [${label}] pages ${outcome.firstPage ?? "?"}–${outcome.lastPage ?? "?"} → ${outcome.status}${outcome.errorCode ? ` (${outcome.errorCode})` : ""}`);
      if (label === "repair") dashboard?.pushEvent("failover", "🔧 hard page recovered by the second engine");
      else if (outcome.status === "repair_queued" || outcome.errorCode) dashboard?.pushEvent("failover", `page range hit ${outcome.errorCode || "a hard page"} — rerouting`);
      else dashboard?.pushEvent("range", `pages ${outcome.firstPage ?? "?"}–${outcome.lastPage ?? "?"} read`);
    } else if (event.type === "error") {
      log(`  [${label}] worker error ${event.errorCode}; backing off ${event.delayMs}ms`);
      dashboard?.pushEvent("throttle", `worker error ${event.errorCode}`);
    } else if (event.type === "deferred") {
      log(`  [${label}] deferred (${event.outcome.admissionReason || "capacity"})`);
    }
  };
  const rangeLoop = composition.createWorkerLoop({
    worker: composition.createRangeWorker({
      scratchSpace: new WorkerScratchSpace({ root: path.join(homeRoot, "scratch", "range") }),
      pageMaterializer,
      maximumPages: options.rangePages,
    }),
    tenantId: options.tenantId,
    workerIdPrefix: "isolated-range",
    concurrency: options.lanes,
    idlePollMs: 200,
    onOutcome: onOutcome("range"),
  });
  const runs = [rangeLoop.run({ signal })];
  const rungs = repairLadder.length ? repairLadder : [null];
  rungs.forEach((rung, index) => {
    const label = index === 0 ? "repair" : `rung${index + 1}:${rung?.capability?.provider || "?"}`;
    const loop = composition.createWorkerLoop({
      worker: composition.createRepairWorker({
        scratchSpace: new WorkerScratchSpace({ root: path.join(homeRoot, "scratch", `repair-${index}`) }),
        pageMaterializer,
        ...(rung ? { provider: rung } : {}),
      }),
      tenantId: options.tenantId,
      workerIdPrefix: `isolated-repair-${index}`,
      concurrency: index === 0 ? options.repairLanes : 2,
      idlePollMs: 400,
      onOutcome: onOutcome(label),
    });
    runs.push(loop.run({ signal }));
  });
  if (nativeProvider) {
    const nativeLoop = composition.createWorkerLoop({
      worker: composition.createRepairWorker({
        scratchSpace: new WorkerScratchSpace({ root: path.join(homeRoot, "scratch", "native") }),
        pageMaterializer,
        provider: nativeProvider,
      }),
      tenantId: options.tenantId,
      workerIdPrefix: "isolated-native",
      concurrency: 8,
      idlePollMs: 100,
      onOutcome: onOutcome("native"),
    });
    runs.push(nativeLoop.run({ signal }));
  }
  log(`workers started: ${options.lanes} range lane(s), ${rungs.length} repair rung(s)${nativeProvider ? ", 8 native lane(s)" : ""}`);
  return runs;
}

async function pollUntilReady({ service, tenantId, intakeId, options, timings }) {
  const deadline = Date.now() + options.timeoutMinutes * 60_000;
  let lastLine = "";
  while (Date.now() < deadline) {
    const intake = await service.getIntake({ tenantId, intakeId });
    if (TERMINAL_INTAKE_STATUSES.has(intake.status)) {
      timings.readyAt = Date.now();
      log(`intake is ${intake.status}`);
      return intake;
    }
    let line = `status ${intake.status}`;
    try {
      const progress = await service.getProgress({ tenantId, intakeId });
      const processing = progress.processing;
      const ratio = Math.round((processing.completionRatio || 0) * 100);
      const eta = processing.eta || {};
      const etaText = Number.isFinite(eta.lowerSeconds) && Number.isFinite(eta.upperSeconds)
        ? `, ETA ${Math.round(eta.lowerSeconds)}–${Math.round(eta.upperSeconds)}s`
        : "";
      line = `progress ${ratio}% (${processing.completedWeightedOperations}/${processing.currentWeightedOperations} page ops, ${processing.runningWeightedOperations} running${etaText})`;
      if (progress.exception?.active) line += ` [exception: ${progress.exception.reasons.join(", ")}]`;
    } catch (error) {
      line += ` (progress projection unavailable: ${error?.code || error?.message})`;
    }
    if (line !== lastLine) {
      log(`  ${line}`);
      lastLine = line;
    }
    await sleep(2_000);
  }
  fail(`intake did not reach a terminal status within ${options.timeoutMinutes} minutes`);
}

async function collectEvidence(databaseUrl, tenantId, intakeId) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const intakeComputations = [
      "select distinct dp.computation_id",
      "from document_intake_extraction.documents d",
      "join document_intake_extraction.document_pages dp on dp.tenant_id = d.tenant_id and dp.document_id = d.document_id",
      "where d.tenant_id = $1 and d.intake_id = $2",
    ].join("\n");
    const attempts = await pool.query([
      "select provider, model, status, count(*)::int as attempts,",
      "       coalesce(sum(billed_cost_usd), 0)::float as billed_cost_usd",
      "from document_intake_extraction.provider_attempts",
      `where tenant_id = $1 and computation_id in (${intakeComputations})`,
      "group by provider, model, status",
      "order by provider, model, status",
    ].join("\n"), [tenantId, intakeId]);
    const costs = await pool.query([
      "select coalesce(sum(billed_cost_usd), 0)::float as total_billed_cost_usd,",
      "       count(*)::int as cost_events,",
      "       count(*) filter (where measurement_status <> 'measured')::int as unmeasured",
      "from document_intake_extraction.cost_events",
      `where tenant_id = $1 and computation_id in (${intakeComputations})`,
    ].join("\n"), [tenantId, intakeId]);
    const outbox = await pool.query(
      "select count(*) filter (where delivered_at is null)::int as pending, count(*)::int as total from document_intake_extraction.outbox_events where tenant_id = $1 and intake_id = $2",
      [tenantId, intakeId],
    );
    return {
      attemptsByProviderAndStatus: attempts.rows,
      cost: costs.rows[0],
      outbox: outbox.rows[0],
    };
  } catch (error) {
    return { error: String(error?.message || error) };
  } finally {
    await pool.end();
  }
}

async function writeOutputs({ options, timings, files, finalIntake, result, evidence, totalPages }) {
  await mkdir(options.out, { recursive: true });
  const summary = buildSummary({ timings, files, finalIntake, result, evidence, totalPages });
  await writeFile(path.join(options.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (result) {
    await writeFile(path.join(options.out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    const documents = Array.isArray(result.documents) ? result.documents : [];
    const textRoot = path.join(options.out, "extracted");
    await mkdir(textRoot, { recursive: true });
    for (const document of documents) {
      const name = `${String(document.relativePath || document.originalName || document.documentId || "document").replaceAll("/", "__")}.md`;
      const pages = Array.isArray(document.pages) ? document.pages : [];
      const body = pages.map((page) => {
        const marker = page.outcome === "review_required" ? " — ⚠ REVIEW REQUIRED" : "";
        return `## Page ${page.pageNumber}${marker}\n\n${page.text || "_(no text)_"}\n`;
      }).join("\n");
      await writeFile(path.join(textRoot, name), `# ${document.originalName || name}\n\n${body}`);
    }
  }
  log(`outputs written to ${options.out}`);
}

function buildSummary({ timings, files, finalIntake, result, evidence, totalPages }) {
  const uploadSeconds = round((timings.uploadFinishedAt - timings.uploadStartedAt) / 1000);
  const processingSeconds = timings.readyAt ? round((timings.readyAt - timings.custodyCommittedAt) / 1000) : null;
  const wallSeconds = timings.readyAt ? round((timings.readyAt - timings.uploadStartedAt) / 1000) : null;
  return {
    schemaVersion: "v4-isolated-run-summary/v1",
    finishedAt: new Date().toISOString(),
    files: files.length,
    totalPages,
    finalStatus: finalIntake.status,
    resultId: finalIntake.resultId || null,
    reviewPageCount: result?.reviewPageCount ?? null,
    timings: {
      uploadAndPerFileCustodySeconds: uploadSeconds,
      custodyCommitToReadySeconds: processingSeconds,
      totalWallClockSeconds: wallSeconds,
      sloTargetSeconds: 120,
      withinSlo: processingSeconds === null ? null : processingSeconds <= 120,
      note: "Workers run during upload, so much of the OCR overlaps the upload phase; custodyCommitToReady is the formal SLO clock.",
    },
    evidence,
  };
}

function printSummary({ timings, files, finalIntake, result, evidence, totalPages, options }) {
  const summary = buildSummary({ timings, files, finalIntake, result, evidence, totalPages });
  log("");
  log("================ V4 ISOLATED RUN SUMMARY ================");
  log(`files:            ${summary.files} (${totalPages} pages)`);
  log(`final status:     ${summary.finalStatus}${summary.reviewPageCount ? ` (${summary.reviewPageCount} page(s) marked for review)` : ""}`);
  log(`upload phase:     ${summary.timings.uploadAndPerFileCustodySeconds}s (OCR overlapped this window)`);
  log(`custody→ready:    ${summary.timings.custodyCommitToReadySeconds}s (SLO objective ≤120s: ${summary.timings.withinSlo ? "MET" : "MISSED"})`);
  log(`total wall clock: ${summary.timings.totalWallClockSeconds}s`);
  if (evidence?.cost) {
    log(`provider cost:    $${Number(evidence.cost.total_billed_cost_usd).toFixed(4)} across ${evidence.cost.cost_events} cost events (${evidence.cost.unmeasured} unmeasured)`);
  }
  for (const row of evidence?.attemptsByProviderAndStatus || []) {
    log(`  ${row.provider}/${row.model}: ${row.attempts} attempt(s) ${row.status}, $${Number(row.billed_cost_usd).toFixed(4)}`);
  }
  if (evidence?.outbox) log(`outbox events:    ${evidence.outbox.total} total, ${evidence.outbox.pending} pending delivery (no dispatcher runs in this harness)`);
  log(`outputs:          ${options.out}`);
  log("=========================================================");
}

async function scanPdfFiles(root) {
  const results = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        const details = await stat(absolute);
        if (!details.size) continue;
        results.push({
          absolutePath: absolute,
          originalName: entry.name,
          relativePath: path.relative(root, absolute).replaceAll(path.sep, "/"),
          expectedBytes: details.size,
        });
      }
    }
  }
  await walk(root);
  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  async function lane() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

function requireInteger(value, flag, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) fail(`${flag} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

function requireIdentifier(value, flag) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(String(value || ""))) fail(`${flag} must be a lowercase PostgreSQL identifier`);
  return value;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function log(message) {
  console.log(message);
}

function fail(message) {
  console.error(`v4-isolated-run: ${message}`);
  process.exit(1);
}

main().catch((error) => {
  console.error("v4-isolated-run failed:", error?.stack || error);
  process.exit(1);
});

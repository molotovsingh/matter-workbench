// Flag-gated Matter Workbench mount for the V4 document intake/extraction
// service — the "integrated but disabled" milestone from the alignment
// interview. Nothing here runs unless MWB_V4_INTAKE=1: the app entry imports
// this module dynamically behind that flag, so deployments that exclude V4
// source never load it and default local runs never mount it.
//
// Configuration (all env):
//   MWB_V4_INTAKE=1            enable the mount (required)
//   MWB_V4_DB_URL              PostgreSQL connection string for the V4 schema (required)
//   MWB_V4_TENANT_ID           tenant for this deployment (default private-beta)
//   MWB_V4_STORE_ROOT          local object-store root (default ~/.mwb-v4-app/object-store)
//   MWB_V4_SCRATCH_ROOT        worker scratch root (default ~/.mwb-v4-app/scratch)
//   MWB_V4_PRIMARY             gemini | mistral (default gemini)
//   MWB_V4_LANES / MWB_V4_MIN_LANES / MWB_V4_REPAIR_LANES / MWB_V4_RANGE_PAGES
//   GEMINI_API_KEY / GOOGLE_API_KEY, MISTRAL_API_KEY, OPENAI_API_KEY (ladder)

import os from "node:os";
import path from "node:path";

import pg from "pg";

import { S3CompatibleObjectStore } from "../adapters/s3-compatible-object-store.mjs";
import { createDocumentIntakeExtractionV4Composition } from "../composition/create-v4-composition.mjs";
import { runDocumentIntakeExtractionMigrations } from "../postgres/migrate.mjs";
import { PdfNativeTextInspector } from "../../../workers/document-processing/pdf-native-text-inspector.mjs";
import { WorkerScratchSpace } from "../../../workers/document-processing/worker-scratch-space.mjs";
import {
  buildAdmissionController,
  buildProviderSuite,
  createLocalDiskS3,
  startWorkerFleet,
  suiteProviderStages,
  writeLocalObject,
} from "./local-composition.mjs";

export const V4_INTAKE_FLAG = "MWB_V4_INTAKE";

export async function createV4IntakeMount({
  env = process.env,
  prefix = "/api/v4",
  pool = null,
  log = () => {},
  autoMigrate = env.MWB_V4_AUTO_MIGRATE !== "0",
} = {}) {
  if (String(env[V4_INTAKE_FLAG] || "") !== "1") return null;
  const databaseUrl = String(env.MWB_V4_DB_URL || "").trim();
  if (!databaseUrl && !pool) throw new Error("MWB_V4_INTAKE=1 requires MWB_V4_DB_URL");
  const tenantId = String(env.MWB_V4_TENANT_ID || "private-beta").trim();
  const storeRoot = String(env.MWB_V4_STORE_ROOT || path.join(os.homedir(), ".mwb-v4-app", "object-store"));
  const scratchRoot = String(env.MWB_V4_SCRATCH_ROOT || path.join(os.homedir(), ".mwb-v4-app", "scratch"));
  const lanes = boundedInteger(env.MWB_V4_LANES, 24, 1, 128);
  const minLanes = boundedInteger(env.MWB_V4_MIN_LANES, 2, 1, 128);
  const repairLanes = boundedInteger(env.MWB_V4_REPAIR_LANES, 4, 1, 32);
  const rangePages = boundedInteger(env.MWB_V4_RANGE_PAGES, 8, 1, 32);

  const suite = buildProviderSuite({
    geminiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
    mistralKey: env.MISTRAL_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    primary: String(env.MWB_V4_PRIMARY || "gemini"),
    apex: env.MWB_V4_APEX !== "0",
    native: env.MWB_V4_NATIVE !== "0",
    gptInputUsdPerMillionTokens: Number(env.GPT54_REPAIR_INPUT_USD_PER_M || 1.25),
    gptOutputUsdPerMillionTokens: Number(env.GPT54_REPAIR_OUTPUT_USD_PER_M || 7.5),
  });
  const admissionController = buildAdmissionController({ suite, lanes, minLanes, repairLanes, rangePages });
  const effectivePool = pool || new pg.Pool({ connectionString: databaseUrl, max: lanes + repairLanes + 8 });
  const localS3 = createLocalDiskS3({ root: storeRoot });
  const bucket = "mwb-v4-app";
  const storePrefix = `${prefix}-store`;
  const inspectorScratch = new WorkerScratchSpace({ root: path.join(scratchRoot, "inspector") });
  const composition = createDocumentIntakeExtractionV4Composition({
    pool: effectivePool,
    objectStoreFactory: ({ authorizationStore }) => new S3CompatibleObjectStore({
      bucket,
      region: String(env.MWB_V4_DATA_REGION || "local-disk"),
      // Browsers cannot PUT to file:// — presign to an app-served staging
      // path; handleRequest below plays the bucket for those PUTs.
      presigner: {
        async presignPut({ bucket: presignBucket, key }) {
          await localS3.presigner.presignPut({ bucket: presignBucket, key });
          return { url: `${storePrefix}/${key}` };
        },
      },
      client: localS3.client,
      authorizationStore,
    }),
    documentInspectorFactory: ({ objectStore: store }) => new PdfNativeTextInspector({ objectStore: store, scratchSpace: inspectorScratch }),
    primaryProvider: suite.primaryProvider,
    repairProvider: suite.repairProvider,
    repairProviders: suite.repairLadder.length > 1 ? suite.repairLadder : undefined,
    nativeProvider: suite.nativeProvider,
    providerStages: suiteProviderStages(suite),
    workerCapacity: { activeWorkers: lanes, warmWorkers: minLanes, maximumWorkers: lanes * 2, pageOperationsPerSecondPerWorker: 4 },
    admissionController,
  });
  const handler = composition.createHttpHandler({
    // The workbench pipeline has already enforced private-beta auth before
    // this mount is reached; the single-tenant beta principal is fixed here.
    authenticate: async () => ({ tenantId }),
    authorizeMatter: async () => true,
  });

  let abort = null;
  let fleet = [];
  return {
    prefix,
    tenantId,
    label: suite.label,
    admissionController,
    async handleRequest({ request, requestUrl, response }) {
      if (request.method === "PUT" && requestUrl.pathname.startsWith(`${storePrefix}/`)) {
        const key = decodeURIComponent(requestUrl.pathname.slice(storePrefix.length + 1));
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        await writeLocalObject({ root: storeRoot, bucket, key, bytes: Buffer.concat(chunks) });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{\"ok\":true}");
        return true;
      }
      if (!requestUrl.pathname.startsWith(`${prefix}/`)) return false;
      request.url = requestUrl.pathname.slice(prefix.length) + (requestUrl.search || "");
      await handler(request, response);
      return true;
    },
    async start() {
      if (autoMigrate) {
        const migrated = await runDocumentIntakeExtractionMigrations({ pool: effectivePool });
        log(`V4 intake: ${migrated.migrations.length} migrations verified`);
      }
      abort = new AbortController();
      fleet = startWorkerFleet({
        composition,
        suite,
        tenantId,
        scratchRoot,
        lanes,
        repairLanes,
        rangePages,
        signal: abort.signal,
        onOutcome: (label) => async (event) => {
          if (event.type === "error") log(`V4 intake [${label}] worker error ${event.errorCode}`);
        },
      });
      log(`V4 intake mounted at ${prefix} (${suite.label}; tenant ${tenantId}; ${lanes} max lanes)`);
    },
    async stop() {
      abort?.abort();
      await Promise.allSettled(fleet);
      if (!pool) await effectivePool.end().catch(() => {});
    },
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

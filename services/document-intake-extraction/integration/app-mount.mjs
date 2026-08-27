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
//   MWB_V4_RANGE_TIMEOUT_MS / MWB_V4_RANGE_FIRST_TIMEOUT_MS  primary range
//     per-attempt timeout budget (defaults are evidence-based hang detection)
//   MWB_V4_MAX_UPLOAD_BYTES    per-object staging cap (default: service limit)
//   MWB_V4_RUNTIME_ROLE        re-grant claim privileges to this role on start
//   GEMINI_API_KEY / GOOGLE_API_KEY, MISTRAL_API_KEY, OPENAI_API_KEY (ladder)
//
// Clients uploading through the emulated staging endpoint must send the
// upload authorization's own token as the `x-mwb-upload-token` header; the
// endpoint proves possession against the staged key before writing.
// `GET <prefix>/status` is the mount's discovery surface: the workbench UI
// probes it to decide whether to render the V4 uploader (404 = flag off), and
// it advertises the upload token header name and service limits.

import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import pg from "pg";

import { SERVICE_LIMITS } from "../../../packages/extraction-contracts/index.mjs";
import { S3CompatibleObjectStore } from "../adapters/s3-compatible-object-store.mjs";
import { createDocumentIntakeExtractionV4Composition } from "../composition/create-v4-composition.mjs";
import { runDocumentIntakeExtractionMigrations } from "../postgres/migrate.mjs";
import { buildDocumentIntakeExtractionRuntimeRoleSql } from "../postgres/runtime-role-sql.mjs";
import { PostgresUploadAuthorizationStore } from "../postgres/postgres-upload-authorization-store.mjs";
import { BoundedDocumentWorkerLoop } from "../../../workers/document-processing/bounded-worker-loop.mjs";
import { PdfNativeTextInspector } from "../../../workers/document-processing/pdf-native-text-inspector.mjs";
import { WorkerScratchSpace } from "../../../workers/document-processing/worker-scratch-space.mjs";
import {
  buildAdmissionController,
  buildProviderSuite,
  createLocalDiskS3,
  startWorkerFleet,
  suiteProviderStages,
  writeLocalObjectStream,
} from "./local-composition.mjs";

export const V4_INTAKE_FLAG = "MWB_V4_INTAKE";
const OBJECT_KEY_PREFIX = "document-intake-extraction/v1";
const UPLOAD_TOKEN_HEADER = "x-mwb-upload-token";
// Staged keys are minted as `<prefix>/staging/<intakeId>/<fileId>/<first 16 of
// sha256(uploadToken)>`. Only that namespace is writable through the emulated
// endpoint — never the content-addressed `blobs/` namespace, whose contents
// custody promotion trusts. The captured intakeId/fileId/digest are checked
// against a real outstanding authorization before any write.
const SEGMENT = "[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,239}";
const STAGING_KEY = new RegExp(`^${OBJECT_KEY_PREFIX}/staging/(${SEGMENT})/(${SEGMENT})/([a-f0-9]{16})$`);

export async function createV4IntakeMount({
  env = process.env,
  prefix = "/api/v4",
  pool = null,
  log = () => {},
  autoMigrate = env.MWB_V4_AUTO_MIGRATE !== "0",
  // Optional bridge to the host app: called once per ready extraction result
  // with plain JSON ({matterFolderName, matterIdSlug, intakeId, resultId,
  // resultStatus, documents}) via the durable outbox — at-least-once, so it
  // must be idempotent. Throw with error.retryable === false to dead-letter
  // an event instead of retrying it. The mount never imports host code; the
  // host injects this at the single sanctioned seam in server.mjs.
  resultConsumer = null,
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
  const maximumUploadBytes = boundedInteger(env.MWB_V4_MAX_UPLOAD_BYTES, SERVICE_LIMITS.maximumFileBytes, 1, SERVICE_LIMITS.maximumFileBytes);
  const runtimeRoleName = String(env.MWB_V4_RUNTIME_ROLE || "").trim();

  const suite = buildProviderSuite({
    geminiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
    mistralKey: env.MISTRAL_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    primary: String(env.MWB_V4_PRIMARY || "gemini"),
    apex: env.MWB_V4_APEX !== "0",
    native: env.MWB_V4_NATIVE !== "0",
    gptInputUsdPerMillionTokens: Number(env.GPT54_REPAIR_INPUT_USD_PER_M || 1.25),
    gptOutputUsdPerMillionTokens: Number(env.GPT54_REPAIR_OUTPUT_USD_PER_M || 7.5),
    rangeTimeoutMs: optionalBoundedInteger(env.MWB_V4_RANGE_TIMEOUT_MS, 5_000, 10 * 60_000),
    rangeFirstAttemptTimeoutMs: optionalBoundedInteger(env.MWB_V4_RANGE_FIRST_TIMEOUT_MS, 5_000, 10 * 60_000),
  });
  const admissionController = buildAdmissionController({ suite, lanes, minLanes, repairLanes, rangePages });
  const effectivePool = pool || new pg.Pool({ connectionString: databaseUrl, max: lanes + repairLanes + 8 });
  const localS3 = createLocalDiskS3({ root: storeRoot });
  const bucket = "mwb-v4-app";
  const storePrefix = `${prefix}-store`;
  const inspectorScratch = new WorkerScratchSpace({ root: path.join(scratchRoot, "inspector") });
  // The endpoint below validates staged writes against real authorizations,
  // matching production's presigned-URL trust model instead of self-consistency.
  const uploadAuthorizationStore = new PostgresUploadAuthorizationStore({ pool: effectivePool });
  const composition = createDocumentIntakeExtractionV4Composition({
    pool: effectivePool,
    objectStoreFactory: ({ authorizationStore }) => new S3CompatibleObjectStore({
      bucket,
      keyPrefix: OBJECT_KEY_PREFIX,
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
  let started = false;
  return {
    prefix,
    tenantId,
    label: suite.label,
    admissionController,
    config: Object.freeze({ lanes, minLanes, repairLanes, rangePages, maximumUploadBytes }),
    isStarted: () => started,
    async handleRequest({ request, requestUrl, response }) {
      if (request.method === "GET" && requestUrl.pathname === `${prefix}/status`) {
        // Mount-owned discovery surface (outside the versioned service API):
        // the workbench UI probes this to decide whether to render the V4
        // uploader at all. When the flag is off the mount never exists, the
        // probe falls through to the legacy API's 404, and the UI stays
        // legacy-only — no client build or legacy server change ever needs to
        // know about the flag.
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({
          ok: true,
          enabled: true,
          started,
          tenantId,
          label: suite.label,
          prefix,
          storePrefix,
          uploadTokenHeader: UPLOAD_TOKEN_HEADER,
          resultImport: Boolean(resultConsumer),
          limits: {
            maximumFiles: SERVICE_LIMITS.maximumFiles,
            maximumFileBytes: Math.min(SERVICE_LIMITS.maximumFileBytes, maximumUploadBytes),
            maximumIntakeBytes: SERVICE_LIMITS.maximumBytes,
          },
        }));
        return true;
      }
      if (request.method === "PUT" && requestUrl.pathname.startsWith(`${storePrefix}/`)) {
        // Emulated presigned PUT. A presigned URL is a bearer credential, so
        // this endpoint must prove the caller holds the upload token that
        // minted the key: the key's last segment is the token digest prefix.
        // Without this, any authenticated caller could write any key —
        // including a content-addressed blob and its metadata sidecar, which
        // custody promotion trusts without re-hashing.
        let key;
        try {
          key = decodeURIComponent(requestUrl.pathname.slice(storePrefix.length + 1));
        } catch {
          return sendStoreError(response, 400, "object.key_invalid", "Malformed staging object key");
        }
        const staging = STAGING_KEY.exec(key);
        if (!staging) return sendStoreError(response, 403, "object.key_not_writable", "Only authorized staging keys accept uploads");
        const [, keyIntakeId, keyFileId, keyDigest] = staging;
        const token = headerValue(request.headers[UPLOAD_TOKEN_HEADER]);
        const tokenDigest = token ? createHash("sha256").update(token).digest("hex") : "";
        if (!token || tokenDigest.slice(0, 16) !== keyDigest) {
          return sendStoreError(response, 403, "object.upload_token_invalid", "A matching upload token is required");
        }
        // Real authorization, not self-consistency: the token digest must
        // resolve to an outstanding authorization this tenant created for this
        // exact intake and file, and the cap is that authorization's own
        // expected size — a caller cannot mint their own key or overrun it.
        let authorization;
        try {
          authorization = await uploadAuthorizationStore.readByTokenDigest(tokenDigest, { tenantId });
        } catch {
          return sendStoreError(response, 503, "object.authorization_unavailable", "Upload authorization could not be checked");
        }
        if (!authorization
          || authorization.intakeId !== keyIntakeId
          || authorization.fileId !== keyFileId
          || authorization.status === "committed") {
          return sendStoreError(response, 403, "object.upload_not_authorized", "No matching outstanding upload authorization");
        }
        const cap = Math.max(1, Math.min(maximumUploadBytes, Number(authorization.expectedBytes) || maximumUploadBytes));
        try {
          const written = await writeLocalObjectStream({ root: storeRoot, bucket, key, stream: request, maximumBytes: cap });
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true, bytes: written.bytes }));
        } catch (error) {
          const code = String(error?.code || "object.write_failed");
          return sendStoreError(response, code === "object.too_large" ? 413 : 400, code, "Staged upload was rejected");
        }
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
      // Recreating a function drops its grants, so a migration that replaces
      // the claim functions strips a restricted runtime role of EXECUTE. Both
      // steps run regardless of autoMigrate: the out-of-band-migration
      // deployment (admin applies migrations, app connects as a restricted
      // role) is exactly the shape that loses grants and must be re-checked.
      if (runtimeRoleName) {
        await effectivePool.query(buildDocumentIntakeExtractionRuntimeRoleSql({ roleName: runtimeRoleName }));
        log(`V4 intake: runtime role grants re-applied to ${runtimeRoleName}`);
      }
      await assertClaimPrivileges(effectivePool, runtimeRoleName);
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
      if (resultConsumer) {
        const dispatcher = composition.createOutboxDispatcher({
          deliver: createExtractionResultDeliver({ service: composition.service, resultConsumer }),
        });
        const outboxLoop = new BoundedDocumentWorkerLoop({
          tenantId,
          workerIdPrefix: "v4-outbox-consumer",
          concurrency: 1,
          idlePollMs: 1_000,
          worker: {
            async runOnce({ workerId }) {
              const outcomes = await dispatcher.drainTenant({ tenantId, workerId });
              if (!outcomes.length) return null;
              return { status: "accepted", workUnitIds: outcomes.map((outcome) => outcome.eventId) };
            },
          },
          onOutcome: async (event) => {
            if (event.type === "error") log(`V4 intake [outbox] consumer error ${event.errorCode}`);
          },
        });
        fleet.push(outboxLoop.run({ signal: abort.signal }));
        log("V4 intake: extraction results will be imported into the matter record (outbox consumer active)");
      }
      started = true;
      log(`V4 intake mounted at ${prefix} (${suite.label}; tenant ${tenantId}; ${lanes} max lanes)`);
    },
    async stop() {
      abort?.abort();
      await Promise.allSettled(fleet);
      if (!pool) await effectivePool.end().catch(() => {});
    },
  };
}

// One outbox event -> one resultConsumer call. Only extraction.result.ready
// is bridged; other event types acknowledge without side effects. The matter
// is identified two ways: clientRequestId carries the workbench's exact
// folder name (set by the upload panel), and matterId carries the V4 slug as
// a fallback the consumer can reverse by scanning the matters home.
export function createExtractionResultDeliver({ service, resultConsumer }) {
  if (!service?.getResult || !service?.getIntake) throw new Error("result deliver requires the V4 service");
  if (typeof resultConsumer !== "function") throw new Error("result deliver requires a resultConsumer function");
  return async function deliver(event) {
    if (event?.type !== "extraction.result.ready") return;
    const payload = event.payload || {};
    const result = await service.getResult({ tenantId: payload.tenantId, resultId: payload.resultId });
    const intake = await service.getIntake({ tenantId: payload.tenantId, intakeId: payload.intakeId });
    await resultConsumer({
      matterFolderName: String(intake.clientRequestId || ""),
      matterIdSlug: String(result.matterId || ""),
      intakeId: String(result.intakeId || ""),
      resultId: String(result.resultId || ""),
      resultStatus: String(result.status || ""),
      documents: Array.isArray(result.documents) ? result.documents : [],
    });
  };
}

async function assertClaimPrivileges(pool, runtimeRoleName) {
  const result = await pool.query([
    "select",
    "  has_function_privilege(current_user, 'document_intake_extraction.claim_page_work(text, integer, jsonb)', 'execute') as page,",
    "  has_function_privilege(current_user, 'document_intake_extraction.claim_document_local_page_work(text, integer, integer, jsonb)', 'execute') as batch",
  ].join("\n"));
  if (result.rows[0]?.page && result.rows[0]?.batch) return;
  const error = new Error([
    "the connected V4 role cannot execute the work-claim functions.",
    "Migrations that replace those functions drop their grants:",
    runtimeRoleName
      ? `re-apply buildDocumentIntakeExtractionRuntimeRoleSql({ roleName: "${runtimeRoleName}" }) with a privileged connection.`
      : "set MWB_V4_RUNTIME_ROLE so the mount re-grants automatically, or apply the runtime role SQL manually.",
  ].join(" "));
  error.code = "v4_intake.claim_privileges_missing";
  throw error;
}

function headerValue(value) {
  const normalized = Array.isArray(value) ? value[0] : value;
  return String(normalized || "").replace(/[\r\n ]/g, "").trim();
}

function sendStoreError(response, status, code, message) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ ok: false, error: { code, message } }));
  return true;
}

// Unset (or empty) stays undefined so the provider adapters keep their own
// evidence-based defaults; only an explicit value overrides.
function optionalBoundedInteger(value, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return undefined;
  return Math.max(minimum, Math.min(maximum, number));
}

function boundedInteger(value, fallback, minimum, maximum) {
  // An empty-but-set env var (`MWB_V4_LANES=`) is a configuration template
  // artifact, not a request for the minimum: Number("") is 0 and a safe
  // integer, so it must fall back rather than clamp.
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

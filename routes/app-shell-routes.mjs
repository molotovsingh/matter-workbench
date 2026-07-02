import { pipeline } from "node:stream/promises";
import { readRequestJson, sendJson } from "./http-utils.mjs";
import { readMatterSummary } from "./active-matter-summary.mjs";
import { dispatchRoutes, exactRoute, patternRoute } from "./route-dispatcher.mjs";
import { currentRequestContext } from "../services/request-context.mjs";
import { deriveNativeSkillRunReceipt } from "../shared/native-skill-run-receipts.mjs";
import {
  filterByVisibleMatterNames,
  isPrivateBetaScopedUser,
  isPrivateBetaSuperuserOrLocal,
  matterRootForQuery,
  runtimeDbMatterForQuery,
  safeCaptureBetaSignal,
  usesRuntimeDbStorage,
  visibleMatterNameSet,
} from "./route-utils.mjs";
import {
  filterWorkspaceTreeForOperatorVisibility,
  isOperatorOnlyWorkspacePath,
} from "../services/workspace-path-policy.mjs";
import { presentAiSettingsForScopedUser } from "./user-facing-presenters.mjs";

export async function handleAppShellApiRequest({ request, requestUrl, response, services }) {
  const {
    aiSettingsService,
    commandInteractionLogService,
    configService,
    copilotInteractionReceiptService,
    copilotWebResearchService,
    env = process.env,
    jobStatusService,
    matterLogService,
    matterStore,
    maxUploadBytes,
    maxUploadFiles,
    privateBetaFeedbackService,
    privateBetaObservabilityService,
    privateBetaSignalService,
    runtimeDbStorageService,
    systemHealthService,
    userReadinessService,
    uploadService,
    workspaceService,
  } = services;

  return dispatchRoutes({
    request,
    requestUrl,
    response,
    routes: [
      exactRoute("GET", "/api/ai-settings", async () => {
        const settings = aiSettingsService.readSettings();
        if (isPrivateBetaScopedUser()) {
          sendJson(response, 200, presentAiSettingsForScopedUser(settings));
          return;
        }
        sendJson(response, 200, settings);
      }),
      exactRoute("POST", "/api/ai-settings", async () => {
        if (!isPrivateBetaSuperuserOrLocal()) {
          sendJson(response, 403, { error: "AI settings require a superuser account." });
          return;
        }
        const body = await readRequestJson(request);
        sendJson(response, 200, await aiSettingsService.saveSettings(body));
      }),
      exactRoute("POST", "/api/ai-settings/test", async () => {
        if (!isPrivateBetaSuperuserOrLocal()) {
          sendJson(response, 403, { error: "AI settings require a superuser account." });
          return;
        }
        sendJson(response, 200, await aiSettingsService.testConnection());
      }),
      exactRoute("POST", "/api/command-interactions", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await commandInteractionLogService.appendInteraction({
          ...body,
          matter: await readMatterSummary(matterStore, { matterName: body.matterName }),
        }));
      }),
      exactRoute("GET", "/api/copilot-interaction-receipts", async () => {
        if (!isPrivateBetaSuperuserOrLocal()) {
          sendJson(response, 403, { error: "Copilot interaction receipts require an operator account." });
          return;
        }
        sendJson(response, 200, await copilotInteractionReceiptService.listReceipts({
          matterName: requestUrl.searchParams.get("matter") || "",
          mode: requestUrl.searchParams.get("mode") || "",
          limit: requestUrl.searchParams.get("limit") || undefined,
        }));
      }),
      exactRoute("GET", "/api/jobs", async () => {
        const filters = {
          matterName: requestUrl.searchParams.get("matter") || "",
          kind: requestUrl.searchParams.get("kind") || "",
          status: requestUrl.searchParams.get("status") || "",
          limit: requestUrl.searchParams.get("limit") || undefined,
        };
        let jobs = await scopedMatterLedger({
          matterStore,
          list: () => jobStatusService.listJobs(filters),
          key: "jobs",
          fields: ["matterName"],
        });
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService) && typeof runtimeDbStorageService?.listProcessingJobs === "function") {
          const runtimeJobs = await scopedMatterLedger({
            matterStore,
            list: () => runtimeDbStorageService.listProcessingJobs(filters),
            key: "jobs",
            fields: ["matterName"],
          });
          jobs = mergeJobLedgers(jobs, runtimeJobs);
        }
        await safeCaptureBetaSignal(() => privateBetaSignalService?.captureJobSignals(jobs, {
          runtimeMode: usesRuntimeDbStorage(matterStore, runtimeDbStorageService) ? "postgres" : "filesystem",
        }));
        sendJson(response, 200, jobs);
      }),
      patternRoute("GET", /^\/api\/jobs\/([^/]+)$/, async ({ params }) => {
        const detail = await readScopedJobDetail({
          jobStatusService,
          matterStore,
          jobId: safeDecodePathParam(params[0]),
        });
        if (!detail) {
          sendJson(response, 404, { error: "Job not found", code: "job.not_found" });
          return;
        }
        sendJson(response, 200, detail);
      }),
      exactRoute("GET", "/api/matter-log", async () => {
        const log = await matterLogService.readMatterLog({
          matterName: requestUrl.searchParams.get("matter") || "",
          limit: requestUrl.searchParams.get("limit") || undefined,
        });
        sendJson(response, 200, await scopedMatterLog({ matterStore, log }));
      }),
      exactRoute("POST", "/api/private-beta/preparation-runs", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await recordPreparationRunTelemetry({
          body,
          jobStatusService,
          matterStore,
        }));
      }),
      exactRoute("GET", "/api/private-beta/feedback", async () => {
        const feedback = await privateBetaFeedbackService.listFeedback({
          status: requestUrl.searchParams.get("status") || "",
          classification: requestUrl.searchParams.get("classification") || "",
          limit: requestUrl.searchParams.get("limit") || undefined,
        });
        sendJson(response, 200, await scopedPrivateBetaFeedback({ matterStore, feedback }));
      }),
      exactRoute("POST", "/api/private-beta/feedback", async () => {
        const body = await readRequestJson(request);
        const requestContext = currentRequestContext();
        const matter = await readMatterSummary(matterStore, { matterName: body.matterName || body.context?.activeMatterName });
        const runtimeStorageMode = usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
          ? "postgres"
          : "filesystem";
        const feedback = await privateBetaFeedbackService.createFeedback({
          ...body,
          context: {
            ...(body.context || {}),
            username: requestContext.user?.username || body.context?.username || "",
            displayName: requestContext.user?.displayName || body.context?.displayName || "",
            userRole: requestContext.user?.role || body.context?.userRole || "",
            activeMatterName: matter?.folderName || body.context?.activeMatterName || "",
            runtimeMode: body.context?.runtimeMode || runtimeStorageMode,
            traceId: body.context?.traceId || requestContext.traceId || "",
            requestId: body.context?.requestId || requestContext.requestId || "",
          },
        });
        sendJson(response, 200, { schema_version: "private-beta-feedback-response/v1", feedback });
      }),
      exactRoute("GET", "/api/private-beta/observability", async () => {
        if (!isPrivateBetaSuperuserOrLocal()) {
          sendJson(response, 403, { error: "Private beta observability requires a superuser account." });
          return;
        }
        sendJson(response, 200, await privateBetaObservabilityService.readObservability({
          limit: requestUrl.searchParams.get("limit") || undefined,
        }));
      }),
      exactRoute("POST", "/api/private-beta/feedback/sync", async () => {
        if (!isPrivateBetaSuperuserOrLocal()) {
          sendJson(response, 200, emptyFeedbackSyncResult());
          return;
        }
        const body = await readRequestJson(request).catch(() => ({}));
        sendJson(response, 200, await privateBetaFeedbackService.syncQueuedFeedback({
          limit: body.limit,
        }));
      }),
      exactRoute("GET", "/api/private-beta/signals", async () => {
        if (!isPrivateBetaSuperuserOrLocal()) {
          sendJson(response, 200, { schema_version: "private-beta-signal-ledger/v1", signals: [] });
          return;
        }
        sendJson(response, 200, await privateBetaSignalService.listSignals({
          source: requestUrl.searchParams.get("source") || "",
          severity: requestUrl.searchParams.get("severity") || "",
          syncStatus: requestUrl.searchParams.get("sync") || "",
          limit: requestUrl.searchParams.get("limit") || undefined,
        }));
      }),
      exactRoute("POST", "/api/private-beta/signals/client-events", async () => {
        const body = await readRequestJson(request).catch(() => ({}));
        if (typeof privateBetaSignalService?.captureClientEvent !== "function") {
          sendJson(response, 200, emptySignalCaptureResult());
          return;
        }
        const requestContext = currentRequestContext();
        const runtimeStorageMode = usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
          ? "postgres"
          : "filesystem";
        try {
          sendJson(response, 200, await privateBetaSignalService.captureClientEvent(body, {
            runtimeMode: runtimeStorageMode,
            username: requestContext.user?.username || "",
            displayName: requestContext.user?.displayName || "",
            userRole: requestContext.user?.role || "",
            traceId: requestContext.traceId || "",
            requestId: requestContext.requestId || "",
          }));
        } catch {
          sendJson(response, 200, emptySignalCaptureResult());
        }
      }),
      exactRoute("POST", "/api/private-beta/signals/sync", async () => {
        if (!isPrivateBetaSuperuserOrLocal()) {
          sendJson(response, 200, emptySignalSyncResult());
          return;
        }
        const body = await readRequestJson(request).catch(() => ({}));
        sendJson(response, 200, await privateBetaSignalService.syncQueuedSignals({
          limit: body.limit,
        }));
      }),
      exactRoute("GET", "/api/system-health", async () => {
        if (!isPrivateBetaSuperuserOrLocal()) {
          sendJson(response, 403, { error: "System health requires an operator account." });
          return;
        }
        sendJson(response, 200, await systemHealthService.readSystemHealth());
      }),
      exactRoute("GET", "/api/user-readiness", async () => {
        sendJson(response, 200, await userReadinessService.readReadiness({
          forceAssistantRefresh: /^(1|true|yes)$/i.test(requestUrl.searchParams.get("refresh") || ""),
        }));
      }),
      exactRoute("GET", "/api/config", async () => {
        response.setHeader("cache-control", "no-store");
        const activeMatterName = matterStore.activeMatterNameWithinHome();
        const runtimeStorageMode = usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
          ? "postgres"
          : "filesystem";
        sendJson(response, 200, {
          mattersHome: configService.getMattersHome() || null,
          defaultMattersHome: configService.defaultMattersHome,
          hasActiveMatter: Boolean(matterStore.getMatterRoot()),
          activeMatterName,
          runtimeStorageMode,
          workspaceModeLabel: runtimeStorageMode === "postgres" ? "DB workspace" : "Local workspace",
          maxUploadBytes,
          maxUploadFiles,
          copilotWebResearchEnabled: Boolean(copilotWebResearchService?.isEnabled?.()),
          release: releaseConfig(env),
        });
      }),
      exactRoute("POST", "/api/config", async () => {
        const body = await readRequestJson(request);
        const result = await configService.setMattersHome(body.mattersHome);
        if (result.homeChanged) matterStore.clearMatterRoot();
        sendJson(response, 200, result);
      }),
      exactRoute("GET", "/api/matters", async () => {
        const isRuntimeDbStorage = usesRuntimeDbStorage(matterStore, runtimeDbStorageService);
        const includeArchived = /^(1|true|yes)$/i.test(requestUrl.searchParams.get("includeArchived") || "");
        sendJson(response, 200, {
          enabled: Boolean(configService.getMattersHome()) || isRuntimeDbStorage,
          mattersHome: configService.getMattersHome() || null,
          active: matterStore.activeMatterNameWithinHome(),
          matters: await matterStore.listMattersHomeChildren({ includeArchived }),
        });
      }),
      exactRoute("POST", "/api/active-matter/clear", async () => {
        matterStore.clearMatterRoot();
        sendJson(response, 200, { active: null });
      }),
      exactRoute("POST", "/api/switch-matter", async () => {
        const body = await readRequestJson(request);
        await matterStore.switchMatter(body.name);
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          sendJson(response, 200, presentWorkspaceForCurrentUser(await runtimeDbStorageService.readWorkspace(matterStore.getActiveMatterRecord())));
          return;
        }
        sendJson(response, 200, presentWorkspaceForCurrentUser(await workspaceService.readWorkspace()));
      }),
      exactRoute("POST", "/api/matters/archive", async () => {
        const body = await readRequestJson(request);
        const matter = await matterStore.archiveMatter(body.name, { reason: body.reason });
        sendJson(response, 200, {
          matter,
          active: matterStore.activeMatterNameWithinHome(),
          message: "Matter archived. Source files and generated artifacts were not deleted.",
        });
      }),
      exactRoute("POST", "/api/matters/reopen", async () => {
        const body = await readRequestJson(request);
        const matter = await matterStore.reopenMatter(body.name);
        sendJson(response, 200, {
          matter,
          active: matterStore.activeMatterNameWithinHome(),
          message: "Matter reopened. Existing source file IDs and history were preserved.",
        });
      }),
      exactRoute("POST", "/api/upload-sessions", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await uploadService.createUploadSession(body));
      }),
      patternRoute("GET", /^\/api\/upload-sessions\/([^/]+)$/, async ({ params }) => {
        sendJson(response, 200, await uploadService.readUploadSession(params[0]));
      }),
      patternRoute("POST", /^\/api\/upload-sessions\/([^/]+)\/files$/, async ({ params }) => {
        sendJson(response, 200, await uploadService.uploadSessionFiles(params[0], request));
      }),
      patternRoute("POST", /^\/api\/upload-sessions\/([^/]+)\/commit$/, async ({ params }) => {
        sendJson(response, 200, presentWorkspaceForCurrentUser(await uploadService.commitUploadSession(params[0])));
      }),
      patternRoute("POST", /^\/api\/upload-sessions\/([^/]+)\/cancel$/, async ({ params }) => {
        sendJson(response, 200, await uploadService.cancelUploadSession(params[0]));
      }),
      exactRoute("POST", "/api/matters/new", async () => {
        const workspace = await runTrackedUpload({
          jobStatusService,
          action: "create_matter",
          route: "/api/matters/new",
          label: "Upload Matter",
          operation: () => uploadService.createMatter(request),
        });
        sendJson(response, 200, presentWorkspaceForCurrentUser(workspace));
      }),
      exactRoute("POST", "/api/matters/add-files", async () => {
        const workspace = await runTrackedUpload({
          jobStatusService,
          action: "add_files",
          route: "/api/matters/add-files",
          label: "Upload Files",
          operation: () => uploadService.addFilesToMatter(request),
        });
        sendJson(response, 200, presentWorkspaceForCurrentUser(workspace));
      }),
      exactRoute("POST", "/api/matters/check-overlap", async () => {
        const isRuntimeDbStorage = usesRuntimeDbStorage(matterStore, runtimeDbStorageService);
        if (!configService.getMattersHome() && !isRuntimeDbStorage) {
          sendJson(response, 200, { warnings: [] });
          return;
        }
        const body = await readRequestJson(request);
        const incoming = Array.isArray(body.hashes)
          ? body.hashes.filter((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash))
          : [];
        if (!incoming.length) {
          sendJson(response, 200, { warnings: [] });
          return;
        }
        if (isRuntimeDbStorage && typeof runtimeDbStorageService.checkUploadedFileOverlap === "function") {
          sendJson(response, 200, await scopedOverlapWarnings({
            matterStore,
            result: await runtimeDbStorageService.checkUploadedFileOverlap(incoming),
          }));
          return;
        }
        const warnings = [];
        for (const matter of await matterStore.listMattersHomeChildren()) {
          const existing = await matterStore.extractRegisterHashes(matter.name);
          if (!existing.size) continue;
          let overlap = 0;
          for (const hash of incoming) if (existing.has(hash)) overlap += 1;
          if (!overlap) continue;
          warnings.push({
            matterName: matter.name,
            overlapCount: overlap,
            totalIncoming: incoming.length,
            matterTotalFiles: existing.size,
            overlapPercent: Math.round((overlap / incoming.length) * 100),
          });
        }
        warnings.sort((a, b) => b.overlapPercent - a.overlapPercent);
        sendJson(response, 200, { warnings });
      }),
      exactRoute("GET", "/api/workspace", async () => {
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          sendJson(response, 200, presentWorkspaceForCurrentUser(await runtimeDbStorageService.readWorkspace(matter)));
          return;
        }
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, presentWorkspaceForCurrentUser(await workspaceService.readWorkspace(root)));
      }),
      exactRoute("GET", "/api/file", async () => {
        const relativePath = requestUrl.searchParams.get("path") || "";
        if (isWorkspacePreviewDeniedForCurrentUser(relativePath)) {
          sendJson(response, 403, { error: "This technical file is not available to this account." });
          return;
        }
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          sendJson(response, 200, await runtimeDbStorageService.readFilePreview(relativePath, matter));
          return;
        }
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await workspaceService.readFilePreview(relativePath, root));
      }),
      exactRoute("GET", "/api/file-raw", async () => {
        const relativePath = requestUrl.searchParams.get("path") || "";
        if (isWorkspacePreviewDeniedForCurrentUser(relativePath)) {
          sendJson(response, 403, { error: "This technical file is not available to this account." });
          return;
        }
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          const raw = await runtimeDbStorageService.getRawFile(relativePath, matter);
          await sendRawFileStream(response, raw);
          return;
        }
        const root = await matterRootForQuery(matterStore, requestUrl);
        const raw = await workspaceService.getRawFile(relativePath, root);
        await sendRawFileStream(response, raw);
      }),
    ],
  });
}

async function sendRawFileStream(response, raw) {
  try {
    response.writeHead(200, {
      "content-type": raw.contentType,
      "content-length": raw.fileSize,
      "content-disposition": `inline; filename="${raw.safeFilename}"`,
      "cache-control": "no-store",
    });
    await pipeline(raw.stream, response);
  } catch (error) {
    raw.stream?.destroy?.();
    if (response.headersSent) {
      response.destroy?.(error);
      return;
    }
    throw error;
  }
}

function releaseConfig(env = process.env) {
  const version = cleanReleaseVersion(env.MWB_RELEASE_VERSION);
  const codename = cleanReleaseText(env.MWB_RELEASE_CODENAME, 40);
  const label = cleanReleaseText(env.MWB_RELEASE_LABEL, 40);
  const commit = cleanReleaseCommit(env.MWB_RELEASE_COMMIT);
  const date = cleanReleaseDate(env.MWB_RELEASE_DATE);
  const note = cleanReleaseText(env.MWB_RELEASE_NOTE, 180);
  if (!version && !codename && !label && !commit && !date && !note) return null;
  return { version, codename, label, commit, date, note };
}

function cleanReleaseText(value, maxLength) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanReleaseVersion(value) {
  const version = String(value || "").trim();
  return /^v\d+\.\d+\.\d+-beta\.\d+$/.test(version) ? version : "";
}

function cleanReleaseCommit(value) {
  const commit = String(value || "").trim();
  return /^[a-f0-9]{7,40}$/i.test(commit) ? commit : "";
}

function cleanReleaseDate(value) {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

const PREPARATION_RUN_RESPONSE_SCHEMA = "private-beta-preparation-run-response/v1";
function mergeJobLedgers(primary = {}, runtime = {}) {
  const primaryJobs = Array.isArray(primary.jobs) ? primary.jobs : [];
  const runtimeJobs = Array.isArray(runtime.jobs) ? runtime.jobs.map(presentRuntimeDbJob) : [];
  return {
    ...primary,
    jobs: [...runtimeJobs, ...primaryJobs]
      .sort((left, right) => Date.parse(right.updatedAt || right.startedAt || right.createdAt || "") - Date.parse(left.updatedAt || left.startedAt || left.createdAt || "")),
  };
}

function presentRuntimeDbJob(job = {}) {
  return {
    schema_version: "job-status/v1",
    id: `db_${job.id || ""}`,
    backendJobId: job.id || "",
    source: "runtime_db",
    kind: job.kind || "job",
    label: runtimeJobLabel(job.kind),
    status: job.status || "running",
    matterName: job.matterName || "",
    matterId: job.matterId || "",
    startedAt: job.startedAt || job.createdAt || "",
    updatedAt: job.updatedAt || job.startedAt || job.createdAt || "",
    finishedAt: job.finishedAt || "",
    summary: runtimeJobSummary(job),
    errorCode: job.errorCode || "",
    errorMessage: job.errorMessage || "",
    metadata: { runtimeDbJob: job.progress || {} },
  };
}

function runtimeJobLabel(kind = "") {
  if (kind === "extract") return "Reading Documents";
  if (kind === "source_labels") return "Label Sources";
  if (kind === "list_of_dates") return "Build Case Timeline";
  return String(kind || "Job").split("_").map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : "").join(" ");
}

function runtimeJobSummary(job = {}) {
  if (job.status === "succeeded") return `${runtimeJobLabel(job.kind)} completed.`;
  if (job.status === "failed") return job.errorMessage || `${runtimeJobLabel(job.kind)} failed.`;
  if (job.status === "retrying") return `${runtimeJobLabel(job.kind)} will retry.`;
  if (job.status === "queued") return `${runtimeJobLabel(job.kind)} queued.`;
  return `${runtimeJobLabel(job.kind)} running.`;
}

const PREPARATION_RUN_KIND = "preparation_run";

async function runTrackedUpload({ jobStatusService, action = "upload", route = "", label = "Upload", operation }) {
  if (typeof operation !== "function") throw new Error("upload operation is required");
  if (!jobStatusService?.createJob || !jobStatusService?.completeJob || !jobStatusService?.failJob) {
    return operation();
  }
  const job = await jobStatusService.createJob({
    kind: "upload",
    label,
    metadata: uploadJobMetadata({ action, route, label }),
  });
  try {
    const result = await operation({ job });
    const completed = await jobStatusService.completeJob(job.id, {
      matterName: uploadMatterNameFromWorkspace(result),
      summary: `${label} completed.`,
    });
    return attachUploadJob(result, completed);
  } catch (error) {
    await jobStatusService.failJob(job.id, error, {
      fallbackErrorCode: "upload.failed",
      metadata: uploadJobMetadata({ action, route, label }),
    });
    throw error;
  }
}

function uploadJobMetadata({ action = "upload", route = "", label = "Upload" } = {}) {
  return {
    upload: {
      action: sanitizeUploadMetadataText(action, 80),
      route: sanitizeUploadMetadataText(route, 120),
      label: sanitizeUploadMetadataText(label, 120),
    },
  };
}

function uploadMatterNameFromWorkspace(workspace = {}) {
  return sanitizeUploadMetadataText(
    workspace?.matterName
      || workspace?.activeMatterName
      || workspace?.activeMatter?.name
      || workspace?.matter?.name
      || workspace?.matter?.matterName
      || workspace?.name
      || "",
    300,
  );
}

function attachUploadJob(result, job) {
  if (result && typeof result === "object" && !Array.isArray(result)) return { ...result, job };
  return { result, job };
}

function sanitizeUploadMetadataText(value, maxLength) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

async function recordPreparationRunTelemetry({ body = {}, jobStatusService, matterStore }) {
  if (!jobStatusService) {
    return { schema_version: PREPARATION_RUN_RESPONSE_SCHEMA, skipped: true };
  }
  const action = normalizePreparationRunAction(body.action);
  const runId = normalizePreparationRunId(body.runId);
  const matterName = matterNameForTelemetry(body, matterStore);
  const metadata = {
    preparationRun: normalizePreparationRunMetadata(body),
  };

  if (action === "start") {
    const job = await jobStatusService.createJob({
      id: runId || undefined,
      kind: PREPARATION_RUN_KIND,
      label: "Matter Preparation",
      matterName,
      metadata,
    });
    return { schema_version: PREPARATION_RUN_RESPONSE_SCHEMA, job };
  }

  if (!runId) {
    const error = new Error("preparation run id is required");
    error.statusCode = 400;
    throw error;
  }

  if (action === "stage") {
    const stage = normalizePreparationStage(body.stage || {});
    const job = await jobStatusService.updateJob(runId, {
      summary: stage.label ? `${stage.label}: ${stage.status}` : `Preparation stage: ${stage.status}`,
      metadata: {
        ...metadata,
        latestStage: stage,
      },
    });
    return { schema_version: PREPARATION_RUN_RESPONSE_SCHEMA, job };
  }

  const status = normalizePreparationRunStatus(body.status);
  const message = normalizePreparationMessage(body.message || body.error || "");
  if (action === "finish" && (status === "failed" || status === "blocked")) {
    const job = await jobStatusService.failJob(runId, new Error(message || "Preparation failed"), {
      failureClass: classifyPreparationFailure(message),
      metadata,
    });
    return { schema_version: PREPARATION_RUN_RESPONSE_SCHEMA, job };
  }

  const job = await jobStatusService.completeJob(runId, {
    resultState: status || "succeeded",
    summary: message || "Preparation run finished.",
    metadata,
  });
  return { schema_version: PREPARATION_RUN_RESPONSE_SCHEMA, job };
}

function normalizePreparationRunAction(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (["start", "stage", "finish"].includes(text)) return text;
  const error = new Error("preparation run action must be start, stage, or finish");
  error.statusCode = 400;
  throw error;
}

function normalizePreparationRunId(value) {
  const text = sanitizeTelemetryText(value, 120).trim();
  return /^[a-zA-Z0-9_-]{3,120}$/.test(text) ? text : "";
}

function matterNameForTelemetry(body = {}, matterStore) {
  const matterName = sanitizeTelemetryText(body.matterName, 180).trim();
  if (matterName) return matterName;
  return matterStore?.activeMatterNameWithinHome?.() || matterStore?.getActiveMatterRecord?.()?.name || "";
}

function normalizePreparationRunMetadata(body = {}) {
  const metadata = {};
  if (body.mode !== undefined) metadata.mode = normalizePreparationMode(body.mode);
  if (body.status !== undefined) metadata.status = normalizePreparationRunStatus(body.status);
  if (body.message !== undefined || body.error !== undefined) metadata.message = normalizePreparationMessage(body.message || body.error || "");
  if (body.stages !== undefined) metadata.stages = normalizePreparationStages(body.stages);
  return metadata;
}

function normalizePreparationMode(value) {
  const text = sanitizeTelemetryText(value, 40).trim();
  return text === "full" ? "full" : "needed";
}

function normalizePreparationRunStatus(value) {
  const text = sanitizeTelemetryText(value, 40).trim();
  if (["running", "succeeded", "prepared", "needs_review", "blocked", "failed"].includes(text)) return text;
  return "running";
}

function normalizePreparationStages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((stage) => {
    if (typeof stage === "string") return normalizePreparationStage({ id: stage, status: "pending" });
    return normalizePreparationStage(stage || {});
  }).filter((stage) => stage.id || stage.label);
}

function normalizePreparationStage(stage = {}) {
  const diagnostic = normalizePreparationDiagnostic(stage.diagnostic);
  return {
    id: sanitizeTelemetryText(stage.id, 80).trim(),
    label: sanitizeTelemetryText(stage.label, 120).trim(),
    status: normalizePreparationStageStatus(stage.status || stage.state),
    durationMs: normalizeDuration(stage.durationMs),
    message: normalizePreparationMessage(stage.message || stage.detail || ""),
    ...(diagnostic ? { diagnostic } : {}),
  };
}

function normalizePreparationStageStatus(value) {
  const text = sanitizeTelemetryText(value, 40).trim();
  if (["pending", "running", "succeeded", "done", "failed", "skipped"].includes(text)) return text;
  return "pending";
}

function normalizeDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(Math.round(number), 24 * 60 * 60 * 1000);
}

function normalizePreparationMessage(value) {
  const text = String(value ?? "");
  const title = text.match(/<title>([^<]+)<\/title>/i)?.[1];
  const withoutTags = title || text.replace(/<[^>]+>/g, " ");
  return sanitizeTelemetryText(withoutTags.replace(/\s+/g, " "), 500).trim();
}

function normalizePreparationDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value;
  const diagnostic = {};
  const statusCode = Number(record.statusCode);
  if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) {
    diagnostic.statusCode = statusCode;
  }
  const code = sanitizeTelemetryText(record.code, 120).trim();
  if (/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(code)) diagnostic.code = code;
  const statusText = sanitizeTelemetryText(record.statusText, 80).replace(/\s+/g, " ").trim();
  if (statusText) diagnostic.statusText = statusText;
  const urlPath = sanitizeTelemetryText(record.urlPath, 220).trim();
  if (urlPath && !/^https?:\/\//i.test(urlPath)) diagnostic.urlPath = urlPath;
  const bodyKind = sanitizeTelemetryText(record.bodyKind, 40).trim();
  if (["html", "json", "text", "empty"].includes(bodyKind)) diagnostic.bodyKind = bodyKind;
  const htmlTitle = sanitizeTelemetryText(record.htmlTitle, 120).replace(/\s+/g, " ").trim();
  if (htmlTitle) diagnostic.htmlTitle = htmlTitle;
  return Object.keys(diagnostic).length ? diagnostic : null;
}

function classifyPreparationFailure(message = "") {
  const text = String(message || "").toLowerCase();
  if (/login required|unauth|forbidden|permission denied/.test(text)) return "auth";
  if (/api key|provider|openrouter|openai|gemini|mistral|rate limit|quota|timeout|time-out|gateway/.test(text)) return "provider";
  if (/database|postgres|psql|storage|write|read|enoent|no such file|not found/.test(text)) return "storage";
  if (/source folder is missing|source files|pick one|no matter|missing|required|invalid/.test(text)) return "user_action_needed";
  return "unknown";
}

function sanitizeTelemetryText(value, maxLength = 500) {
  return String(value ?? "")
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/gi, "$1=[redacted-secret]")
    .replace(/\b(password|token|secret)\s*[:=]\s*([^\s"'`]+)/gi, "$1=[redacted-secret]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[redacted-secret]")
    .slice(0, maxLength);
}

function isWorkspacePreviewDeniedForCurrentUser(relativePath) {
  return !isPrivateBetaSuperuserOrLocal() && isOperatorOnlyWorkspacePath(relativePath);
}

function presentWorkspaceForCurrentUser(workspace) {
  if (isPrivateBetaSuperuserOrLocal() || !workspace?.tree) return workspace;
  const tree = filterWorkspaceTreeForOperatorVisibility(workspace.tree, { canSeeOperatorFiles: false });
  const counts = countWorkspaceTree(tree);
  return {
    ...workspace,
    fileCount: counts.fileCount,
    directoryCount: counts.directoryCount,
    tree,
  };
}

function countWorkspaceTree(node, isRoot = true) {
  let fileCount = node?.kind === "file" ? 1 : 0;
  let directoryCount = !isRoot && node?.kind === "directory" ? 1 : 0;
  for (const child of Array.isArray(node?.children) ? node.children : []) {
    const counts = countWorkspaceTree(child, false);
    fileCount += counts.fileCount;
    directoryCount += counts.directoryCount;
  }
  return { fileCount, directoryCount };
}

async function scopedMatterLedger({ matterStore, list, key, fields }) {
  const ledger = await list();
  if (!isPrivateBetaScopedUser()) return ledger;
  const visibleNames = await visibleMatterNameSet(matterStore);
  return {
    ...ledger,
    [key]: filterByVisibleMatterNames(ledger?.[key], visibleNames, { fields }),
  };
}

async function readScopedJobDetail({ jobStatusService, matterStore, jobId }) {
  if (!jobStatusService?.getJob) return null;
  let job;
  try {
    job = await jobStatusService.getJob(jobId);
  } catch {
    return null;
  }
  if (isPrivateBetaScopedUser()) {
    const visibleNames = await visibleMatterNameSet(matterStore);
    if (!filterByVisibleMatterNames([job], visibleNames, { fields: ["matterName"] }).length) return null;
  }
  return {
    schema_version: "job-detail/v1",
    job,
    receipt: deriveNativeSkillRunReceipt(nativeReceiptInputForJob(job)),
  };
}

function safeDecodePathParam(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}

function nativeReceiptInputForJob(job = {}) {
  const skill = job.metadata?.skill && typeof job.metadata.skill === "object" ? job.metadata.skill : {};
  return {
    job,
    slash: skill.slash || job.slash || "",
    skillId: skill.skillId || job.skillId || job.kind || "",
    skillVersion: skill.skillVersion || job.skillVersion || 1,
  };
}

async function scopedMatterLog({ matterStore, log }) {
  if (!isPrivateBetaScopedUser()) return log;
  const visibleNames = await visibleMatterNameSet(matterStore);
  const entries = filterByVisibleMatterNames(log?.entries, visibleNames, { fields: ["matterName"] });
  return {
    ...log,
    entries,
    summary: {
      ...(log?.summary || {}),
      entries: entries.length,
      sourceLedgers: Array.from(new Set(entries.map((entry) => entry.sourceLedger).filter(Boolean))).sort(),
    },
  };
}

async function scopedPrivateBetaFeedback({ matterStore, feedback }) {
  if (!isPrivateBetaScopedUser()) return feedback;
  const visibleNames = await visibleMatterNameSet(matterStore);
  const username = currentRequestContext().user?.username || "";
  const isVisibleToCurrentUser = (item) => {
    if (username && item?.context?.username === username) return true;
    return filterByVisibleMatterNames([item], visibleNames, {
      fields: ["context.activeMatterName", "context.activeMatterFolder"],
    }).length > 0;
  };
  return {
    ...feedback,
    feedback: Array.isArray(feedback?.feedback) ? feedback.feedback.filter(isVisibleToCurrentUser) : [],
  };
}

async function scopedOverlapWarnings({ matterStore, result }) {
  if (!isPrivateBetaScopedUser()) return result;
  const visibleNames = await visibleMatterNameSet(matterStore);
  return {
    ...result,
    warnings: filterByVisibleMatterNames(result?.warnings, visibleNames, { fields: ["matterName"] }),
  };
}

function emptyFeedbackSyncResult() {
  return {
    schema_version: "private-beta-feedback-sync-result/v1",
    attempted: 0,
    sent: 0,
    queued: 0,
    failed: 0,
    skipped: 0,
  };
}

function emptySignalSyncResult() {
  return {
    schema_version: "private-beta-signal-sync-result/v1",
    attempted: 0,
    sent: 0,
    queued: 0,
    failed: 0,
    skipped: 0,
  };
}

function emptySignalCaptureResult() {
  return {
    schema_version: "private-beta-signal-capture-result/v1",
    captured: 0,
    sent: 0,
    queued: 0,
    failed: 0,
    skipped: 1,
    signals: [],
  };
}

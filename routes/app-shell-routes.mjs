import { readRequestJson, sendJson } from "./http-utils.mjs";
import { readMatterSummary } from "./active-matter-summary.mjs";
import { dispatchRoutes, exactRoute } from "./route-dispatcher.mjs";
import { currentRequestContext } from "../services/request-context.mjs";
import {
  filterByVisibleMatterNames,
  isPrivateBetaScopedUser,
  isPrivateBetaSuperuserOrLocal,
  safeCaptureBetaSignal,
  usesRuntimeDbStorage,
  visibleMatterNameSet,
} from "./route-utils.mjs";
import {
  filterWorkspaceTreeForOperatorVisibility,
  isOperatorOnlyWorkspacePath,
} from "../services/workspace-path-policy.mjs";

export async function handleAppShellApiRequest({ request, requestUrl, response, services }) {
  const {
    aiSettingsService,
    commandInteractionLogService,
    configService,
    jobStatusService,
    matterStore,
    privateBetaFeedbackService,
    privateBetaObservabilityService,
    privateBetaSignalService,
    runtimeDbStorageService,
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
          const { envPath: _envPath, ...testerSettings } = settings;
          sendJson(response, 200, testerSettings);
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
      exactRoute("GET", "/api/jobs", async () => {
        const jobs = await scopedMatterLedger({
          matterStore,
          list: () => jobStatusService.listJobs({
            matterName: requestUrl.searchParams.get("matter") || "",
            kind: requestUrl.searchParams.get("kind") || "",
            status: requestUrl.searchParams.get("status") || "",
            limit: requestUrl.searchParams.get("limit") || undefined,
          }),
          key: "jobs",
          fields: ["matterName"],
        });
        await safeCaptureBetaSignal(() => privateBetaSignalService?.captureJobSignals(jobs, {
          runtimeMode: usesRuntimeDbStorage(matterStore, runtimeDbStorageService) ? "postgres" : "filesystem",
        }));
        sendJson(response, 200, jobs);
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
      exactRoute("GET", "/api/config", async () => {
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
        sendJson(response, 200, {
          enabled: Boolean(configService.getMattersHome()) || isRuntimeDbStorage,
          mattersHome: configService.getMattersHome() || null,
          active: matterStore.activeMatterNameWithinHome(),
          matters: await matterStore.listMattersHomeChildren(),
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
      exactRoute("POST", "/api/matters/new", async () => {
        sendJson(response, 200, presentWorkspaceForCurrentUser(await uploadService.createMatter(request)));
      }),
      exactRoute("POST", "/api/matters/add-files", async () => {
        sendJson(response, 200, presentWorkspaceForCurrentUser(await uploadService.addFilesToMatter(request)));
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
          response.writeHead(200, {
            "content-type": raw.contentType,
            "content-length": raw.fileSize,
            "content-disposition": `inline; filename="${raw.safeFilename}"`,
            "cache-control": "no-store",
          });
          raw.stream.pipe(response);
          return;
        }
        const root = await matterRootForQuery(matterStore, requestUrl);
        const raw = await workspaceService.getRawFile(relativePath, root);
        response.writeHead(200, {
          "content-type": raw.contentType,
          "content-length": raw.fileSize,
          "content-disposition": `inline; filename="${raw.safeFilename}"`,
          "cache-control": "no-store",
        });
        raw.stream.pipe(response);
      }),
    ],
  });
}

const PREPARATION_RUN_RESPONSE_SCHEMA = "private-beta-preparation-run-response/v1";
const PREPARATION_RUN_KIND = "preparation_run";

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

async function runtimeDbMatterForQuery(matterStore, requestUrl) {
  const matterName = requestUrl.searchParams.get("matter")?.trim() || "";
  if (matterName) return matterStore.resolveExistingMatter(matterName);
  const activeMatter = matterStore.getActiveMatterRecord?.();
  if (activeMatter) return activeMatter;
  matterStore.ensureMatterRoot();
  return matterStore.getActiveMatterRecord?.();
}

async function matterRootForQuery(matterStore, requestUrl) {
  const matterName = requestUrl.searchParams.get("matter")?.trim() || "";
  if (!matterName) return matterStore.ensureMatterRoot();
  const { matterPath } = await matterStore.resolveExistingMatter(matterName);
  return matterPath;
}

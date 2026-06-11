import { readRequestJson, sendJson } from "./http-utils.mjs";
import { readMatterSummary } from "./active-matter-summary.mjs";
import { dispatchRoutes, exactRoute } from "./route-dispatcher.mjs";
import {
  filterByVisibleMatterNames,
  isPrivateBetaScopedUser,
  isPrivateBetaSuperuserOrLocal,
  safeCaptureBetaSignal,
  usesRuntimeDbStorage,
  visibleMatterNameSet,
} from "./route-utils.mjs";

export async function handleAppShellApiRequest({ request, requestUrl, response, services }) {
  const {
    aiSettingsService,
    commandInteractionLogService,
    configService,
    jobStatusService,
    matterStore,
    privateBetaFeedbackService,
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
        sendJson(response, 200, aiSettingsService.readSettings());
      }),
      exactRoute("POST", "/api/ai-settings", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await aiSettingsService.saveSettings(body));
      }),
      exactRoute("POST", "/api/ai-settings/test", async () => {
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
        const matter = await readMatterSummary(matterStore, { matterName: body.matterName || body.context?.activeMatterName });
        const runtimeStorageMode = usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
          ? "postgres"
          : "filesystem";
        const feedback = await privateBetaFeedbackService.createFeedback({
          ...body,
          context: {
            ...(body.context || {}),
            activeMatterName: matter?.folderName || body.context?.activeMatterName || "",
            runtimeMode: body.context?.runtimeMode || runtimeStorageMode,
          },
        });
        sendJson(response, 200, { schema_version: "private-beta-feedback-response/v1", feedback });
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
          sendJson(response, 200, await runtimeDbStorageService.readWorkspace(matterStore.getActiveMatterRecord()));
          return;
        }
        sendJson(response, 200, await workspaceService.readWorkspace());
      }),
      exactRoute("POST", "/api/matters/new", async () => {
        sendJson(response, 200, await uploadService.createMatter(request));
      }),
      exactRoute("POST", "/api/matters/add-files", async () => {
        sendJson(response, 200, await uploadService.addFilesToMatter(request));
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
          sendJson(response, 200, await runtimeDbStorageService.readWorkspace(matter));
          return;
        }
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await workspaceService.readWorkspace(root));
      }),
      exactRoute("GET", "/api/file", async () => {
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          sendJson(response, 200, await runtimeDbStorageService.readFilePreview(requestUrl.searchParams.get("path") || "", matter));
          return;
        }
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await workspaceService.readFilePreview(requestUrl.searchParams.get("path") || "", root));
      }),
      exactRoute("GET", "/api/file-raw", async () => {
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          const raw = await runtimeDbStorageService.getRawFile(requestUrl.searchParams.get("path") || "", matter);
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
        const raw = await workspaceService.getRawFile(requestUrl.searchParams.get("path") || "", root);
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
  return {
    ...feedback,
    feedback: filterByVisibleMatterNames(feedback?.feedback, visibleNames, {
      fields: ["context.activeMatterName", "context.activeMatterFolder"],
    }),
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

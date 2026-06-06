import { readRequestJson, sendJson } from "./http-utils.mjs";
import { readMatterSummary } from "./active-matter-summary.mjs";
import { dispatchRoutes, exactRoute } from "./route-dispatcher.mjs";

export async function handleAppShellApiRequest({ request, requestUrl, response, services }) {
  const {
    aiSettingsService,
    commandInteractionLogService,
    configService,
    matterStore,
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
      exactRoute("GET", "/api/config", async () => {
        const activeMatterName = matterStore.activeMatterNameWithinHome();
        sendJson(response, 200, {
          mattersHome: configService.getMattersHome() || null,
          defaultMattersHome: configService.defaultMattersHome,
          hasActiveMatter: Boolean(matterStore.getMatterRoot()),
          activeMatterName,
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
          sendJson(response, 200, await runtimeDbStorageService.checkUploadedFileOverlap(incoming));
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

function usesRuntimeDbStorage(matterStore, runtimeDbStorageService) {
  return Boolean(matterStore.hasRuntimeDbStorageMode?.() && runtimeDbStorageService?.enabled);
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

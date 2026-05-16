import { readRequestJson, sendJson } from "./http-utils.mjs";
import { readActiveMatterSummary } from "./active-matter-summary.mjs";
import { dispatchRoutes, exactRoute } from "./route-dispatcher.mjs";

export async function handleAppShellApiRequest({ request, requestUrl, response, services }) {
  const {
    aiSettingsService,
    commandInteractionLogService,
    configService,
    matterStore,
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
          matter: await readActiveMatterSummary(matterStore),
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
        sendJson(response, 200, {
          enabled: Boolean(configService.getMattersHome()),
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
        sendJson(response, 200, await workspaceService.readWorkspace());
      }),
      exactRoute("POST", "/api/matters/new", async () => {
        sendJson(response, 200, await uploadService.createMatter(request));
      }),
      exactRoute("POST", "/api/matters/add-files", async () => {
        sendJson(response, 200, await uploadService.addFilesToMatter(request));
      }),
      exactRoute("POST", "/api/matters/check-overlap", async () => {
        if (!configService.getMattersHome()) {
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
        sendJson(response, 200, await workspaceService.readWorkspace());
      }),
      exactRoute("GET", "/api/file", async () => {
        sendJson(response, 200, await workspaceService.readFilePreview(requestUrl.searchParams.get("path") || ""));
      }),
      exactRoute("GET", "/api/file-raw", async () => {
        const raw = await workspaceService.getRawFile(requestUrl.searchParams.get("path") || "");
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

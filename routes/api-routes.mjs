import { readRequestJson, sendJson } from "./http-utils.mjs";
import { readActiveMatterSummary } from "./active-matter-summary.mjs";
import { handleMatterWorkflowApiRequest } from "./matter-workflow-routes.mjs";
import { handleSkillFactoryApiRequest } from "./skill-factory-routes.mjs";

export async function handleApiRequest({ request, requestUrl, response, services }) {
  const {
    aiSettingsService,
    commandInteractionLogService,
    configService,
    matterStore,
    uploadService,
    workspaceService,
  } = services;

  if (await handleMatterWorkflowApiRequest({ request, requestUrl, response, services })) {
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/ai-settings") {
    sendJson(response, 200, aiSettingsService.readSettings());
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/ai-settings") {
    const body = await readRequestJson(request);
    sendJson(response, 200, await aiSettingsService.saveSettings(body));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/ai-settings/test") {
    sendJson(response, 200, await aiSettingsService.testConnection());
    return true;
  }

  if (await handleSkillFactoryApiRequest({ request, requestUrl, response, services })) {
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/command-interactions") {
    const body = await readRequestJson(request);
    sendJson(response, 200, await commandInteractionLogService.appendInteraction({
      ...body,
      matter: await readActiveMatterSummary(matterStore),
    }));
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/config") {
    sendJson(response, 200, {
      mattersHome: configService.getMattersHome() || null,
      defaultMattersHome: configService.defaultMattersHome,
      hasActiveMatter: Boolean(matterStore.getMatterRoot()),
    });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/config") {
    const body = await readRequestJson(request);
    const result = await configService.setMattersHome(body.mattersHome);
    if (result.homeChanged) matterStore.clearMatterRoot();
    sendJson(response, 200, result);
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/matters") {
    sendJson(response, 200, {
      enabled: Boolean(configService.getMattersHome()),
      mattersHome: configService.getMattersHome() || null,
      active: matterStore.activeMatterNameWithinHome(),
      matters: await matterStore.listMattersHomeChildren(),
    });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/switch-matter") {
    const body = await readRequestJson(request);
    await matterStore.switchMatter(body.name);
    sendJson(response, 200, await workspaceService.readWorkspace());
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/matters/new") {
    sendJson(response, 200, await uploadService.createMatter(request));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/matters/add-files") {
    sendJson(response, 200, await uploadService.addFilesToMatter(request));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/matters/check-overlap") {
    if (!configService.getMattersHome()) {
      sendJson(response, 200, { warnings: [] });
      return true;
    }
    const body = await readRequestJson(request);
    const incoming = Array.isArray(body.hashes)
      ? body.hashes.filter((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash))
      : [];
    if (!incoming.length) {
      sendJson(response, 200, { warnings: [] });
      return true;
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
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/workspace") {
    sendJson(response, 200, await workspaceService.readWorkspace());
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/file") {
    sendJson(response, 200, await workspaceService.readFilePreview(requestUrl.searchParams.get("path") || ""));
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/file-raw") {
    const raw = await workspaceService.getRawFile(requestUrl.searchParams.get("path") || "");
    response.writeHead(200, {
      "content-type": raw.contentType,
      "content-length": raw.fileSize,
      "content-disposition": `inline; filename="${raw.safeFilename}"`,
      "cache-control": "no-store",
    });
    raw.stream.pipe(response);
    return true;
  }

  return false;
}

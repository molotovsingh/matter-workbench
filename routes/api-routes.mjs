import { runExtract } from "../extract-engine.mjs";
import { runCreateListOfDates } from "../create-listofdates-engine.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { runDoctorFix, runDoctorScan } from "../services/doctor-service.mjs";
import { readRequestJson, sendJson } from "./http-utils.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";

export async function handleApiRequest({ request, requestUrl, response, services }) {
  const {
    aiSettingsService,
    configService,
    matterStore,
    skillRegistryService,
    skillRouterService,
    uploadService,
    workspaceService,
  } = services;

  if (request.method === "POST" && requestUrl.pathname === "/api/matter-init") {
    const root = matterStore.ensureMatterRoot();
    const body = await readRequestJson(request);
    sendJson(response, 200, await runMatterInit({
      matterRoot: root,
      metadata: body.metadata || {},
      dryRun: Boolean(body.dryRun),
    }));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/extract") {
    const root = matterStore.ensureMatterRoot();
    const body = await readRequestJson(request);
    sendJson(response, 200, await runExtract({
      matterRoot: root,
      dryRun: Boolean(body.dryRun),
      intakeFilter: typeof body.intakeId === "string" && body.intakeId.trim()
        ? body.intakeId.trim()
        : null,
    }));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/create-listofdates") {
    const root = matterStore.ensureMatterRoot();
    const body = await readRequestJson(request);
    const env = services.env || {};
    const modelPolicy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, { env });
    const options = {
      matterRoot: root,
      dryRun: Boolean(body.dryRun),
      aiProvider: services.aiProvider,
      env,
    };
    if (modelPolicy.provider === AI_PROVIDERS.OPENAI_DIRECT) {
      options.apiKey = env.OPENAI_API_KEY;
      options.model = typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : env.OPENAI_MODEL;
      options.maxOutputTokens = env.OPENAI_MAX_OUTPUT_TOKENS;
    }
    sendJson(response, 200, await runCreateListOfDates(options));
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

  if (request.method === "GET" && requestUrl.pathname === "/api/skills") {
    sendJson(response, 200, await skillRegistryService.readRegistry());
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/skills/check-intent") {
    const body = await readRequestJson(request);
    sendJson(response, 200, await skillRouterService.checkIntent({
      userRequest: body.userRequest,
      overrideJustification: body.overrideJustification,
    }));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/unibox") {
    const body = await readRequestJson(request);
    sendJson(response, 200, await services.uniboxService.processInput({
      userInput: body.userInput,
      conversationHistory: Array.isArray(body.conversationHistory) ? body.conversationHistory : [],
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

  if (request.method === "POST" && requestUrl.pathname === "/api/doctor/scan") {
    sendJson(response, 200, await runDoctorScan(matterStore.ensureMatterRoot()));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/doctor/fix") {
    const body = await readRequestJson(request);
    const fixIds = Array.isArray(body.fixIds) ? body.fixIds.filter((id) => typeof id === "string") : [];
    if (!fixIds.length) {
      const error = new Error("No fixes selected");
      error.statusCode = 400;
      throw error;
    }
    sendJson(response, 200, await runDoctorFix(matterStore.ensureMatterRoot(), fixIds));
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

import { runCreateListOfDates } from "../create-listofdates-engine.mjs";
import { runExtract } from "../extract-engine.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { runDoctorFix, runDoctorScan } from "../services/doctor-service.mjs";
import { runSourceDescriptors } from "../source-descriptors-engine.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { readRequestJson, sendJson } from "./http-utils.mjs";

export async function handleMatterWorkflowApiRequest({ request, requestUrl, response, services }) {
  const {
    matterContextService,
    matterStore,
    matterStatusService,
    prepareMatterService,
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

  if (request.method === "POST" && requestUrl.pathname === "/api/describe-sources") {
    const root = matterStore.ensureMatterRoot();
    const body = await readRequestJson(request);
    sendJson(response, 200, await runSourceDescriptors({
      matterRoot: root,
      dryRun: Boolean(body.dryRun),
      env: services.env || {},
      sourceDescriptorProvider: services.sourceDescriptorProvider,
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

  if (request.method === "GET" && requestUrl.pathname === "/api/matter-status") {
    sendJson(response, 200, await matterStatusService.readMatterStatus());
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/prepare-matter") {
    sendJson(response, 200, await prepareMatterService.readPrepareMatterPlan());
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/matter-context/search") {
    sendJson(response, 200, await matterContextService.searchMatterContext({
      query: requestUrl.searchParams.get("q") || "",
    }));
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/matter-context") {
    sendJson(response, 200, await matterContextService.readMatterContextPreview());
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/rerun-advice") {
    sendJson(response, 200, await matterStatusService.readRerunAdvice(requestUrl.searchParams.get("skill") || ""));
    return true;
  }

  return false;
}

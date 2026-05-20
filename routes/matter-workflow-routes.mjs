import { runCreateListOfDates } from "../create-listofdates-engine.mjs";
import { runExtract } from "../extract-engine.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { runDoctorFix, runDoctorScan } from "../services/doctor-service.mjs";
import { refreshListOfDatesSourceLabels } from "../services/listofdates-label-refresh-service.mjs";
import { runSourceDescriptors } from "../source-descriptors-engine.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { readRequestJson, sendJson } from "./http-utils.mjs";
import { dispatchRoutes, exactRoute } from "./route-dispatcher.mjs";

export async function handleMatterWorkflowApiRequest({ request, requestUrl, response, services }) {
  const {
    matterAttentionService,
    matterCopilotService,
    matterContextService,
    matterStore,
    matterStatusService,
    prepareMatterService,
  } = services;

  return dispatchRoutes({
    request,
    requestUrl,
    response,
    routes: [
      exactRoute("POST", "/api/matter-init", async () => {
        const body = await readRequestJson(request);
        const root = await matterRootForBody(matterStore, body);
        sendJson(response, 200, await runMatterInit({
          matterRoot: root,
          metadata: body.metadata || {},
          dryRun: Boolean(body.dryRun),
        }));
      }),
      exactRoute("POST", "/api/extract", async () => {
        const body = await readRequestJson(request);
        const root = await matterRootForBody(matterStore, body);
        sendJson(response, 200, await runExtract({
          matterRoot: root,
          dryRun: Boolean(body.dryRun),
          intakeFilter: typeof body.intakeId === "string" && body.intakeId.trim()
            ? body.intakeId.trim()
            : null,
        }));
      }),
      exactRoute("POST", "/api/describe-sources", async () => {
        const body = await readRequestJson(request);
        const root = await matterRootForBody(matterStore, body);
        sendJson(response, 200, await runSourceDescriptors({
          matterRoot: root,
          dryRun: Boolean(body.dryRun),
          env: services.env || {},
          sourceDescriptorProvider: services.sourceDescriptorProvider,
        }));
      }),
      exactRoute("POST", "/api/create-listofdates", async () => {
        const body = await readRequestJson(request);
        const root = await matterRootForBody(matterStore, body);
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
          options.maxOutputTokens = env.OPENAI_MAX_OUTPUT_TOKENS;
        }
        sendJson(response, 200, await runCreateListOfDates(options));
      }),
      exactRoute("POST", "/api/create-listofdates/refresh-labels", async () => {
        const body = await readRequestJson(request);
        const root = await matterRootForBody(matterStore, body);
        sendJson(response, 200, await refreshListOfDatesSourceLabels({
          matterRoot: root,
          dryRun: Boolean(body.dryRun),
        }));
      }),
      exactRoute("POST", "/api/doctor/scan", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runDoctorScan(await matterRootForBody(matterStore, body)));
      }),
      exactRoute("POST", "/api/doctor/fix", async () => {
        const body = await readRequestJson(request);
        const root = await matterRootForBody(matterStore, body);
        const fixIds = Array.isArray(body.fixIds) ? body.fixIds.filter((id) => typeof id === "string") : [];
        if (!fixIds.length) {
          const error = new Error("No fixes selected");
          error.statusCode = 400;
          throw error;
        }
        sendJson(response, 200, await runDoctorFix(root, fixIds));
      }),
      exactRoute("GET", "/api/matter-status", async () => {
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await matterStatusService.readMatterStatus(root));
      }),
      exactRoute("GET", "/api/matter-attention", async () => {
        const matterName = requestUrl.searchParams.get("matter") || "";
        if (matterName.trim()) {
          const { name, matterPath } = await matterStore.resolveExistingMatter(matterName);
          sendJson(response, 200, await matterAttentionService.readMatterAttention(matterPath, { matterName: name }));
          return;
        }
        sendJson(response, 200, await matterAttentionService.readMatterAttention());
      }),
      exactRoute("GET", "/api/prepare-matter", async () => {
        const root = await matterRootForQuery(matterStore, requestUrl, { allowMissingActive: true });
        sendJson(response, 200, await prepareMatterService.readPrepareMatterPlan(root));
      }),
      exactRoute("GET", "/api/matter-context/search", async () => {
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await matterContextService.searchMatterContext({
          root,
          query: requestUrl.searchParams.get("q") || "",
        }));
      }),
      exactRoute("GET", "/api/matter-context", async () => {
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await matterContextService.readMatterContextPreview(root));
      }),
      exactRoute("POST", "/api/matter-copilot/answer", async () => {
        const body = await readRequestJson(request);
        const root = await matterRootForBody(matterStore, body);
        sendJson(response, 200, await matterCopilotService.answerQuestion({
          root,
          question: body.question,
        }));
      }),
      exactRoute("GET", "/api/rerun-advice", async () => {
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await matterStatusService.readRerunAdvice(requestUrl.searchParams.get("skill") || "", root));
      }),
    ],
  });
}

async function matterRootForBody(matterStore, body = {}) {
  const matterName = typeof body.matterName === "string" ? body.matterName.trim() : "";
  if (!matterName) return matterStore.ensureMatterRoot();
  const { matterPath } = await matterStore.resolveExistingMatter(matterName);
  return matterPath;
}

async function matterRootForQuery(matterStore, requestUrl, { allowMissingActive = false } = {}) {
  const matterName = requestUrl.searchParams.get("matter")?.trim() || "";
  if (!matterName) {
    if (allowMissingActive) return matterStore.getMatterRoot?.() || null;
    return matterStore.ensureMatterRoot();
  }
  const { matterPath } = await matterStore.resolveExistingMatter(matterName);
  return matterPath;
}

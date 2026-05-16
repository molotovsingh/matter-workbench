import { runCreateListOfDates } from "../create-listofdates-engine.mjs";
import { runExtract } from "../extract-engine.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { runDoctorFix, runDoctorScan } from "../services/doctor-service.mjs";
import { runSourceDescriptors } from "../source-descriptors-engine.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { readRequestJson, sendJson } from "./http-utils.mjs";
import { dispatchRoutes, exactRoute } from "./route-dispatcher.mjs";

export async function handleMatterWorkflowApiRequest({ request, requestUrl, response, services }) {
  const {
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
        const root = matterStore.ensureMatterRoot();
        const body = await readRequestJson(request);
        sendJson(response, 200, await runMatterInit({
          matterRoot: root,
          metadata: body.metadata || {},
          dryRun: Boolean(body.dryRun),
        }));
      }),
      exactRoute("POST", "/api/extract", async () => {
        const root = matterStore.ensureMatterRoot();
        const body = await readRequestJson(request);
        sendJson(response, 200, await runExtract({
          matterRoot: root,
          dryRun: Boolean(body.dryRun),
          intakeFilter: typeof body.intakeId === "string" && body.intakeId.trim()
            ? body.intakeId.trim()
            : null,
        }));
      }),
      exactRoute("POST", "/api/describe-sources", async () => {
        const root = matterStore.ensureMatterRoot();
        const body = await readRequestJson(request);
        sendJson(response, 200, await runSourceDescriptors({
          matterRoot: root,
          dryRun: Boolean(body.dryRun),
          env: services.env || {},
          sourceDescriptorProvider: services.sourceDescriptorProvider,
        }));
      }),
      exactRoute("POST", "/api/create-listofdates", async () => {
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
      }),
      exactRoute("POST", "/api/doctor/scan", async () => {
        sendJson(response, 200, await runDoctorScan(matterStore.ensureMatterRoot()));
      }),
      exactRoute("POST", "/api/doctor/fix", async () => {
        const body = await readRequestJson(request);
        const fixIds = Array.isArray(body.fixIds) ? body.fixIds.filter((id) => typeof id === "string") : [];
        if (!fixIds.length) {
          const error = new Error("No fixes selected");
          error.statusCode = 400;
          throw error;
        }
        sendJson(response, 200, await runDoctorFix(matterStore.ensureMatterRoot(), fixIds));
      }),
      exactRoute("GET", "/api/matter-status", async () => {
        sendJson(response, 200, await matterStatusService.readMatterStatus());
      }),
      exactRoute("GET", "/api/prepare-matter", async () => {
        sendJson(response, 200, await prepareMatterService.readPrepareMatterPlan());
      }),
      exactRoute("GET", "/api/matter-context/search", async () => {
        sendJson(response, 200, await matterContextService.searchMatterContext({
          query: requestUrl.searchParams.get("q") || "",
        }));
      }),
      exactRoute("GET", "/api/matter-context", async () => {
        sendJson(response, 200, await matterContextService.readMatterContextPreview());
      }),
      exactRoute("GET", "/api/rerun-advice", async () => {
        sendJson(response, 200, await matterStatusService.readRerunAdvice(requestUrl.searchParams.get("skill") || ""));
      }),
    ],
  });
}

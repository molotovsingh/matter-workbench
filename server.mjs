import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAiSettingsService } from "./services/ai-settings-service.mjs";
import { createCommandInteractionLogService } from "./services/command-interaction-log-service.mjs";
import { createConfigService } from "./services/config-service.mjs";
import { createConfigurableSkillRunsService } from "./services/configurable-skill-runs-service.mjs";
import { createRuntimeDbCommandInteractionLogService } from "./services/runtime-db-command-interaction-log-service.mjs";
import { createRuntimeDbConfigurableSkillStore } from "./services/runtime-db-configurable-skill-store.mjs";
import { createConfigurableSkillsService } from "./services/configurable-skills-service.mjs";
import { createRuntimeDbConfigurableSkillRunsService } from "./services/runtime-db-configurable-skill-runs-service.mjs";
import { createMatterCopilotService } from "./services/matter-copilot-service.mjs";
import { createMatterContextService } from "./services/matter-context-service.mjs";
import { createMatterStore } from "./services/matter-store.mjs";
import { createMatterStoryService } from "./services/matter-story-service.mjs";
import { createMatterAttentionService } from "./services/matter-attention-service.mjs";
import { createMatterStatusService } from "./services/matter-status-service.mjs";
import { createPrepareMatterService } from "./services/prepare-matter-service.mjs";
import { createRuntimeDbMatterIndex } from "./services/runtime-db-matter-index.mjs";
import { createRuntimeDbStorageService } from "./services/runtime-db-storage-service.mjs";
import { runtimeDatabaseUrl } from "./services/runtime-db-config.mjs";
import { createRuntimeDbSkillIdeasService } from "./services/runtime-db-skill-ideas-service.mjs";
import { createRuntimeDbSkillSamplesService } from "./services/runtime-db-skill-samples-service.mjs";
import { createSkillIdeasService } from "./services/skill-ideas-service.mjs";
import { createSkillFactoryHealthService } from "./services/skill-factory-health-service.mjs";
import { createSkillInterviewPlannerService } from "./services/skill-interview-planner-service.mjs";
import { createSkillRegistryService } from "./services/skill-registry-service.mjs";
import { createSkillRouterService } from "./services/skill-router-service.mjs";
import { createSkillSamplesService } from "./services/skill-samples-service.mjs";
import { createSkillSampleOutputService } from "./services/skill-sample-output-service.mjs";
import { createUploadService } from "./services/upload-service.mjs";
import { createWorkspaceService } from "./services/workspace-service.mjs";
import { handleApiRequest } from "./routes/api-routes.mjs";
import { sendJson } from "./routes/http-utils.mjs";
import { serveStatic } from "./routes/static-routes.mjs";
import { loadLocalEnv } from "./shared/local-env.mjs";
import { DEFAULT_WORKBENCH_HOST, DEFAULT_WORKBENCH_PORT } from "./shared/local-server-defaults.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createWorkbenchServer(options = {}) {
  const appDir = options.appDir || __dirname;
  const env = options.env || (await loadLocalEnv({ appDir, override: true })).env;
  const host = options.host || DEFAULT_WORKBENCH_HOST;
  const port = Number(options.port ?? env.PORT ?? DEFAULT_WORKBENCH_PORT);
  const uiShell = "react";

  const configService = createConfigService({ appDir, env });
  await configService.load();
  const runtimeMatterIndex = options.runtimeMatterIndex || createRuntimeDbMatterIndex({ env });

  const matterStore = createMatterStore({
    configService,
    initialMatterRoot: options.matterRoot || env.MATTER_ROOT || null,
    runtimeMatterIndex,
  });
  const matterCopilotService = createMatterCopilotService({
    matterStore,
    answerProvider: options.matterCopilotProvider || null,
    env,
    fetchImpl: options.fetchImpl || fetch,
    endpoint: options.matterCopilotEndpoint,
  });
  const matterContextService = createMatterContextService({ matterStore });
  const workspaceService = createWorkspaceService({ matterStore });
  const runtimeDbUrl = runtimeDatabaseUrl(env);
  const runtimeDbStorageService = options.runtimeDbStorageService || createRuntimeDbStorageService({
    databaseUrl: runtimeDbUrl,
    tenantId: runtimeMatterIndex.tenantId || "",
  });
  const uploadService = createUploadService({
    matterStore,
    runtimeDbStorageService,
    workspaceService,
    maxUploadBytes: options.maxUploadBytes,
  });
  const aiSettingsService = createAiSettingsService({ appDir, env });
  const runtimeDbCommandInteractionLogService = options.runtimeDbCommandInteractionLogService || createRuntimeDbCommandInteractionLogService({
    databaseUrl: runtimeDbUrl,
    tenantId: runtimeMatterIndex.tenantId || "",
  });
  const commandInteractionLogService = options.commandInteractionLogService || (
    matterStore.hasRuntimeDbStorageMode() && runtimeDbCommandInteractionLogService.enabled
      ? runtimeDbCommandInteractionLogService
      : createCommandInteractionLogService({
        appDir,
        logPath: options.commandInteractionLogPath,
      })
  );
  const runtimeDbSkillIdeasService = options.runtimeDbSkillIdeasService || createRuntimeDbSkillIdeasService({
    databaseUrl: runtimeDbUrl,
    tenantId: runtimeMatterIndex.tenantId || "",
  });
  const runtimeDbSkillSamplesService = options.runtimeDbSkillSamplesService || createRuntimeDbSkillSamplesService({
    databaseUrl: runtimeDbUrl,
    tenantId: runtimeMatterIndex.tenantId || "",
  });
  const skillIdeasService = options.skillIdeasService || (
    matterStore.hasRuntimeDbStorageMode() && runtimeDbSkillIdeasService.enabled
      ? runtimeDbSkillIdeasService
      : createSkillIdeasService({
        appDir,
        ideasPath: options.skillIdeasPath,
      })
  );
  const skillSamplesService = options.skillSamplesService || (
    matterStore.hasRuntimeDbStorageMode() && runtimeDbSkillSamplesService.enabled
      ? runtimeDbSkillSamplesService
      : createSkillSamplesService({
        appDir,
        samplesPath: options.skillSamplesPath,
      })
  );
  const runtimeDbConfigurableSkillRunsService = createRuntimeDbConfigurableSkillRunsService({
    databaseUrl: runtimeDbUrl,
    tenantId: runtimeMatterIndex.tenantId || "",
  });
  const configurableSkillRunsService = options.configurableSkillRunsService || (
    matterStore.hasRuntimeDbStorageMode() && runtimeDbConfigurableSkillRunsService.enabled
      ? runtimeDbConfigurableSkillRunsService
      : createConfigurableSkillRunsService({
        appDir,
        runsPath: options.configurableSkillRunsPath,
      })
  );
  const runtimeDbConfigurableSkillStore = options.runtimeDbConfigurableSkillStore || createRuntimeDbConfigurableSkillStore({
    databaseUrl: runtimeDbUrl,
    tenantId: runtimeMatterIndex.tenantId || "",
  });
  const configurableSkillStore = options.configurableSkillStore || (
    matterStore.hasRuntimeDbStorageMode() && runtimeDbConfigurableSkillStore.enabled
      ? runtimeDbConfigurableSkillStore
      : null
  );
  const configurableSkillsService = createConfigurableSkillsService({
    appDir,
    skillsPath: options.configurableSkillsPath,
    matterStore,
    skillIdeasService,
    skillSamplesService,
    configurableSkillRunsService,
    skillStore: configurableSkillStore,
    authoringProvider: options.configurableSkillAuthoringProvider || null,
    runProvider: options.configurableSkillRunProvider || null,
    env,
    fetchImpl: options.fetchImpl || fetch,
    endpoint: options.configurableSkillEndpoint,
  });
  const skillFactoryHealthService = options.skillFactoryHealthService || createSkillFactoryHealthService({
    appDir,
    configurableSkillsService,
    ideasPath: options.skillIdeasPath,
    samplesPath: options.skillSamplesPath,
    skillIdeasService,
    skillSamplesService,
    skillsPath: options.configurableSkillsPath,
  });
  const matterStoryService = createMatterStoryService({
    matterStore,
    configurableSkillsService,
  });
  const skillRegistryService = createSkillRegistryService({
    appDir,
    registryPath: options.skillRegistryPath,
    configurableSkillsService,
  });
  const matterStatusService = createMatterStatusService({ matterStore, skillRegistryService });
  const prepareMatterService = createPrepareMatterService({ matterStore, matterStatusService, matterStoryService });
  const matterAttentionService = createMatterAttentionService({
    matterStore,
    matterStatusService,
    configurableSkillRunsService,
    commandInteractionLogService,
  });
  const skillInterviewPlannerService = createSkillInterviewPlannerService({
    registryService: skillRegistryService,
    matterStore,
    plannerProvider: options.skillInterviewPlannerProvider || null,
    env,
    fetchImpl: options.fetchImpl || fetch,
  });
  const skillRouterService = createSkillRouterService({
    registryService: skillRegistryService,
    aiProvider: options.skillRouterProvider || null,
    env,
  });
  const skillSampleOutputService = createSkillSampleOutputService({
    matterStore,
    sampleProvider: options.skillSampleOutputProvider || null,
    env,
    fetchImpl: options.fetchImpl || fetch,
    endpoint: options.skillSampleOutputEndpoint,
  });
  const services = {
    aiProvider: options.aiProvider || null,
    aiSettingsService,
    commandInteractionLogService,
    configurableSkillRunsService,
    configService,
    configurableSkillsService,
    env,
    matterAttentionService,
    matterCopilotService,
    matterStore,
    matterContextService,
    matterStatusService,
    matterStoryService,
    prepareMatterService,
    runtimeDbStorageService,
    skillIdeasService,
    skillFactoryHealthService,
    skillInterviewPlannerService,
    skillRegistryService,
    skillRouterService,
    skillSamplesService,
    skillSampleOutputService,
    sourceDescriptorProvider: options.sourceDescriptorProvider || null,
    uploadService,
    workspaceService,
  };

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      if (await handleApiRequest({ request, requestUrl, response, services })) return;

      if (request.method === "GET") {
        await serveStatic({ appDir, request, response });
        return;
      }

      response.writeHead(405);
      response.end("Method not allowed");
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message,
        stack: env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  return {
    appDir,
    host,
    port,
    server,
    uiShell,
    services,
    runtimeMatterIndex,
  };
}

if (process.argv[1] === __filename) {
  const app = await createWorkbenchServer();
  app.server.listen(app.port, app.host, () => {
    console.log(`Legal Workbench running at http://${app.host}:${app.port}/`);
    const mattersHome = app.services.configService.getMattersHome();
    const matterRoot = app.services.matterStore.getMatterRoot();
    if (mattersHome) console.log(`Matters home: ${mattersHome}`);
    console.log(matterRoot
      ? `Matter root: ${matterRoot}`
      : mattersHome
        ? "Matter root: none — pick or create a matter in the sidebar."
        : `Matter root: not configured. Open http://${app.host}:${app.port}/ to set matters home on first run.`);
  });
}

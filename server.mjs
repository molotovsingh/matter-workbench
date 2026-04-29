import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAiSettingsService } from "./services/ai-settings-service.mjs";
import { createConfigService } from "./services/config-service.mjs";
import { createMatterStore } from "./services/matter-store.mjs";
import { createSkillRegistryService } from "./services/skill-registry-service.mjs";
import { createSkillRouterService } from "./services/skill-router-service.mjs";
import { createUniboxService } from "./services/unibox-service.mjs";
import { createUploadService } from "./services/upload-service.mjs";
import { createWorkspaceService } from "./services/workspace-service.mjs";
import { handleApiRequest } from "./routes/api-routes.mjs";
import { sendJson } from "./routes/http-utils.mjs";
import { serveStatic } from "./routes/static-routes.mjs";
import { loadLocalEnv } from "./shared/local-env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createWorkbenchServer(options = {}) {
  const appDir = options.appDir || __dirname;
  const env = options.env || (await loadLocalEnv({ appDir, override: true })).env;
  const host = options.host || "127.0.0.1";
  const port = Number(options.port ?? env.PORT ?? 4173);

  const configService = createConfigService({ appDir, env });
  await configService.load();

  const matterStore = createMatterStore({
    configService,
    initialMatterRoot: options.matterRoot || env.MATTER_ROOT || null,
  });
  const workspaceService = createWorkspaceService({ matterStore });
  const uploadService = createUploadService({ matterStore, workspaceService });
  const aiSettingsService = createAiSettingsService({ appDir, env });
  const skillRegistryService = createSkillRegistryService({
    appDir,
    registryPath: options.skillRegistryPath,
  });
  const skillRouterService = createSkillRouterService({
    registryService: skillRegistryService,
    aiProvider: options.skillRouterProvider || null,
    env,
  });
  const uniboxService = createUniboxService({
    matterStore,
    skillRegistryService,
    skillRouterService,
    env,
  });
  const services = {
    aiProvider: options.aiProvider || null,
    aiSettingsService,
    configService,
    env,
    matterStore,
    skillRegistryService,
    skillRouterService,
    uniboxService,
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
    services,
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

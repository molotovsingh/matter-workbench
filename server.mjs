import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAiProviderService } from "./services/ai-provider-service.mjs";
import { createAiSettingsService } from "./services/ai-settings-service.mjs";
import { createCommandInteractionLogService } from "./services/command-interaction-log-service.mjs";
import { createConfigService } from "./services/config-service.mjs";
import { createConfigurableSkillRunsService } from "./services/configurable-skill-runs-service.mjs";
import { createRuntimeDbCommandInteractionLogService } from "./services/runtime-db-command-interaction-log-service.mjs";
import { createRuntimeDbConfigurableSkillStore } from "./services/runtime-db-configurable-skill-store.mjs";
import { createConfigurableSkillsService } from "./services/configurable-skills-service.mjs";
import { createRuntimeDbConfigurableSkillRunsService } from "./services/runtime-db-configurable-skill-runs-service.mjs";
import { createMatterCopilotService } from "./services/matter-copilot-service.mjs";
import { createCopilotInteractionReceiptService } from "./services/copilot-interaction-receipt-service.mjs";
import { createCopilotWebResearchService } from "./services/copilot-web-research-service.mjs";
import { createMatterContextService } from "./services/matter-context-service.mjs";
import { createMatterEventsService } from "./services/matter-events-service.mjs";
import { createMatterStore } from "./services/matter-store.mjs";
import { createMatterStoryService } from "./services/matter-story-service.mjs";
import { createJobStatusService } from "./services/job-status-service.mjs";
import { createMatterAttentionService } from "./services/matter-attention-service.mjs";
import { createMatterLogService } from "./services/matter-log-service.mjs";
import { createMatterStatusService } from "./services/matter-status-service.mjs";
import { createNativeSkillRunStateService } from "./services/native-skill-run-state-service.mjs";
import { createPrepareMatterService } from "./services/prepare-matter-service.mjs";
import { createProceduralPostureDiagnosisService } from "./services/procedural-posture-diagnosis-service.mjs";
import { createPrivateBetaAuthService } from "./services/private-beta-auth-service.mjs";
import { createPrivateBetaFeedbackService } from "./services/private-beta-feedback-service.mjs";
import { createPrivateBetaHeartbeatService } from "./services/private-beta-heartbeat-service.mjs";
import { createPrivateBetaMetricsService } from "./services/private-beta-metrics-service.mjs";
import { createPrivateBetaObservabilityService } from "./services/private-beta-observability-service.mjs";
import { createPrivateBetaSignalService } from "./services/private-beta-signal-service.mjs";
import { createPrivateBetaTelemetryRetryService } from "./services/private-beta-telemetry-retry-service.mjs";
import { createPrivateBetaUsersService } from "./services/private-beta-users-service.mjs";
import { createRuntimeDbMatterEventsService } from "./services/runtime-db-matter-events-service.mjs";
import { createRuntimeDbMatterIndex } from "./services/runtime-db-matter-index.mjs";
import { createRuntimeDbProcessingWorkerService } from "./services/runtime-db-processing-worker-service.mjs";
import { createRuntimeDbStorageService } from "./services/runtime-db-storage-service.mjs";
import {
  createRuntimeDbSourceRemovalMutationService,
  createSourceRemovalMutationService,
} from "./services/source-removal-mutation-service.mjs";
import { runtimeDatabaseUrl } from "./services/runtime-db-config.mjs";
import { newTraceId, requestContextFromAuthStatus, runWithRequestContext } from "./services/request-context.mjs";
import { createRuntimeDbSkillIdeasService } from "./services/runtime-db-skill-ideas-service.mjs";
import { createRuntimeDbSkillSamplesService } from "./services/runtime-db-skill-samples-service.mjs";
import { createSkillIdeasService } from "./services/skill-ideas-service.mjs";
import { createSkillFactoryHealthService } from "./services/skill-factory-health-service.mjs";
import { createSystemHealthService } from "./services/system-health-service.mjs";
import { runStartupAiChecks } from "./services/startup-ai-check-service.mjs";
import { createUserReadinessService } from "./services/user-readiness-service.mjs";
import { createSkillInterviewPlannerService } from "./services/skill-interview-planner-service.mjs";
import { createSkillRegistryService } from "./services/skill-registry-service.mjs";
import { createSkillRunnerService } from "./services/skill-runner-service.mjs";
import { createSkillRouterService } from "./services/skill-router-service.mjs";
import { createSkillSamplesService } from "./services/skill-samples-service.mjs";
import { createSkillSampleOutputService } from "./services/skill-sample-output-service.mjs";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_MAX_UPLOAD_FILES,
} from "./services/multipart-upload.mjs";
import { createUploadService } from "./services/upload-service.mjs";
import { createWorkspaceService } from "./services/workspace-service.mjs";
import { handleApiRequest } from "./routes/api-routes.mjs";
import { sendJson } from "./routes/http-utils.mjs";
import { handlePrivateBetaAuthApiRequest, requirePrivateBetaAuth } from "./routes/private-beta-auth-routes.mjs";
import { serveStatic } from "./routes/static-routes.mjs";
import { createListOfDatesRunner } from "./skills/builtins/create_listofdates/runner.mjs";
import { createDescribeSourcesRunner } from "./skills/builtins/describe_sources/runner.mjs";
import { createProceduralPostureDiagnosisRunner } from "./skills/builtins/procedural_posture_diagnosis/runner.mjs";
import { createMatterStoryRunner } from "./skills/builtins/the_story/runner.mjs";
import { loadLocalEnv } from "./shared/local-env.mjs";
import { DEFAULT_WORKBENCH_HOST, DEFAULT_WORKBENCH_PORT } from "./shared/local-server-defaults.mjs";
import {
  userFacingAiErrorCode,
  userFacingAiErrorMessage,
} from "./shared/user-facing-ai-language-policy.js";

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
  const aiProviderService = options.aiProviderService || createAiProviderService({
    env,
    fetchImpl: options.fetchImpl || fetch,
  });
  const privateBetaAuthService = options.privateBetaAuthService || createPrivateBetaAuthService({ env });
  const privateBetaUsersService = options.privateBetaUsersService || createPrivateBetaUsersService({
    usersFile: env.MWB_PRIVATE_BETA_USERS_FILE,
  });
  const privateBetaFeedbackService = options.privateBetaFeedbackService || createPrivateBetaFeedbackService({
    appDir,
    feedbackPath: options.privateBetaFeedbackPath || env.MWB_PRIVATE_BETA_FEEDBACK_PATH,
    syncUrl: env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL,
    syncToken: env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN,
    installId: env.MWB_PRIVATE_BETA_INSTALL_ID || env.MWB_PRIVATE_BETA_FEEDBACK_INSTALL_ID,
    telemetryMode: env.MWB_PRIVATE_BETA_TELEMETRY_MODE,
    fetchImpl: options.privateBetaFeedbackFetch,
  });
  const privateBetaSignalService = options.privateBetaSignalService || createPrivateBetaSignalService({
    appDir,
    signalsPath: options.privateBetaSignalPath || env.MWB_PRIVATE_BETA_SIGNAL_PATH,
    syncUrl: env.MWB_PRIVATE_BETA_SIGNAL_SYNC_URL || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL,
    syncToken: env.MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN,
    installId: env.MWB_PRIVATE_BETA_INSTALL_ID || env.MWB_PRIVATE_BETA_SIGNAL_INSTALL_ID || env.MWB_PRIVATE_BETA_FEEDBACK_INSTALL_ID,
    telemetryMode: env.MWB_PRIVATE_BETA_TELEMETRY_MODE,
    fetchImpl: options.privateBetaSignalFetch || options.privateBetaFeedbackFetch,
  });
  const runtimeMatterIndex = options.runtimeMatterIndex || createRuntimeDbMatterIndex({ env });
  if (privateBetaAuthService.requireAuth?.() && !runtimeMatterIndex.enabled) {
    throw new Error("MWB_PRIVATE_BETA_AUTH=required requires runtime DB matter index; filesystem matter storage is not isolated by beta user.");
  }

  const matterStore = createMatterStore({
    configService,
    initialMatterRoot: options.matterRoot || env.MATTER_ROOT || null,
    runtimeMatterIndex,
  });
  const matterCopilotService = createMatterCopilotService({
    matterStore,
    answerProvider: options.matterCopilotProvider || null,
    providerService: aiProviderService,
    env,
    fetchImpl: options.fetchImpl || fetch,
    endpoint: options.matterCopilotEndpoint,
  });
  const copilotInteractionReceiptService = options.copilotInteractionReceiptService || createCopilotInteractionReceiptService({
    appDir,
    receiptsPath: options.copilotInteractionReceiptsPath || env.MWB_COPILOT_INTERACTION_RECEIPTS_PATH,
  });
  const copilotWebResearchService = options.copilotWebResearchService || createCopilotWebResearchService({
    matterStore,
    env,
    fetchImpl: options.fetchImpl || fetch,
    endpoint: options.copilotWebResearchAnswerEndpoint,
    webResearchProvider: options.copilotWebResearchProvider || null,
    webResearchAnswerProvider: options.copilotWebResearchAnswerProvider || null,
    providerService: aiProviderService,
  });
  const matterContextService = createMatterContextService({ matterStore });
  const workspaceService = createWorkspaceService({ matterStore });
  const runtimeDbUrl = runtimeDatabaseUrl(env);
  const runtimeDbStorageService = options.runtimeDbStorageService || createRuntimeDbStorageService({
    databaseUrl: runtimeDbUrl,
    tenantId: runtimeMatterIndex.tenantId || "",
  });
  const maxUploadBytes = options.maxUploadBytes ?? configuredMaxUploadBytes(env);
  const maxUploadFiles = options.maxUploadFiles ?? configuredMaxUploadFiles(env);
  const uploadService = createUploadService({
    matterStore,
    runtimeDbStorageService,
    workspaceService,
    maxUploadBytes,
    maxUploadFiles,
  });
  const privateBetaMetricsService = options.privateBetaMetricsService || createPrivateBetaMetricsService({
    appDir,
    metricsPath: options.privateBetaMetricsPath || env.MWB_PRIVATE_BETA_METRICS_PATH,
    syncUrl: env.MWB_PRIVATE_BETA_METRICS_SYNC_URL
      || siblingMothershipSyncUrl(env.MWB_PRIVATE_BETA_SIGNAL_SYNC_URL || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL, "/v1/metrics"),
    syncToken: env.MWB_PRIVATE_BETA_METRICS_SYNC_TOKEN || env.MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN,
    installId: env.MWB_PRIVATE_BETA_INSTALL_ID || env.MWB_PRIVATE_BETA_METRICS_INSTALL_ID || env.MWB_PRIVATE_BETA_SIGNAL_INSTALL_ID || env.MWB_PRIVATE_BETA_FEEDBACK_INSTALL_ID,
    telemetryMode: env.MWB_PRIVATE_BETA_TELEMETRY_MODE,
    fetchImpl: options.privateBetaMetricsFetch || options.privateBetaSignalFetch || options.privateBetaFeedbackFetch,
  });
  const privateBetaHeartbeatService = options.privateBetaHeartbeatService || createPrivateBetaHeartbeatService({
    appDir,
    heartbeatPath: options.privateBetaHeartbeatPath || env.MWB_PRIVATE_BETA_HEARTBEAT_PATH,
    syncUrl: env.MWB_PRIVATE_BETA_HEARTBEAT_SYNC_URL
      || siblingMothershipSyncUrl(
        env.MWB_PRIVATE_BETA_METRICS_SYNC_URL || env.MWB_PRIVATE_BETA_SIGNAL_SYNC_URL || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL,
        "/v1/heartbeats",
      ),
    syncToken: env.MWB_PRIVATE_BETA_HEARTBEAT_SYNC_TOKEN
      || env.MWB_PRIVATE_BETA_METRICS_SYNC_TOKEN
      || env.MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN
      || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN,
    installId: env.MWB_PRIVATE_BETA_INSTALL_ID
      || env.MWB_PRIVATE_BETA_HEARTBEAT_INSTALL_ID
      || env.MWB_PRIVATE_BETA_METRICS_INSTALL_ID
      || env.MWB_PRIVATE_BETA_SIGNAL_INSTALL_ID
      || env.MWB_PRIVATE_BETA_FEEDBACK_INSTALL_ID,
    telemetryMode: env.MWB_PRIVATE_BETA_TELEMETRY_MODE,
    fetchImpl: options.privateBetaHeartbeatFetch || options.privateBetaMetricsFetch || options.privateBetaSignalFetch || options.privateBetaFeedbackFetch,
    deploymentProvider: () => buildDeploymentMetricsContext({ env, host, port, matterStore }),
    journeyProvider: () => buildHeartbeatJourneyContext({
      privateBetaFeedbackService,
      privateBetaSignalService,
      jobStatusService,
      matterStore,
      runtimeDbStorageService,
      matterAttentionService,
      prepareMatterService,
    }),
  });
  const telemetryRetryService = options.telemetryRetryService || createPrivateBetaTelemetryRetryService({
    feedbackService: privateBetaFeedbackService,
    metricsService: privateBetaMetricsService,
    metricsContextProvider: () => ({
      deployment: buildDeploymentMetricsContext({ env, host, port, matterStore }),
    }),
    signalService: privateBetaSignalService,
    heartbeatService: privateBetaHeartbeatService,
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
  const runtimeDbMatterEventsService = options.runtimeDbMatterEventsService || createRuntimeDbMatterEventsService({
    databaseUrl: runtimeDbUrl,
    tenantId: runtimeMatterIndex.tenantId || "",
  });
  const matterEventsService = options.matterEventsService || (
    matterStore.hasRuntimeDbStorageMode() && runtimeDbMatterEventsService.enabled
      ? runtimeDbMatterEventsService
      : createMatterEventsService({
        appDir,
        eventsPath: options.matterEventsPath,
      })
  );
  const runtimeDbSourceRemovalMutationService = options.runtimeDbSourceRemovalMutationService || createRuntimeDbSourceRemovalMutationService({
    databaseUrl: runtimeDbUrl,
    tenantId: runtimeMatterIndex.tenantId || "",
  });
  const sourceRemovalMutationService = options.sourceRemovalMutationService || createSourceRemovalMutationService({
    appDir,
    matterEventsService,
  });
  const configurableSkillsService = createConfigurableSkillsService({
    appDir,
    skillsPath: options.configurableSkillsPath,
    matterStore,
    skillIdeasService,
    skillSamplesService,
    configurableSkillRunsService,
    matterEventsService,
    skillStore: configurableSkillStore,
    authoringProvider: options.configurableSkillAuthoringProvider || null,
    runProvider: options.configurableSkillRunProvider || null,
    providerService: aiProviderService,
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
  const proceduralPostureDiagnosisService = createProceduralPostureDiagnosisService({
    matterStore,
    aiProviderService,
    diagnosisProvider: options.proceduralPostureDiagnosisProvider || null,
    env,
  });
  const jobStatusService = options.jobStatusService || createJobStatusService({
    appDir,
    jobsPath: options.jobStatusPath,
  });
  const nativeRunStateService = options.nativeRunStateService || createNativeSkillRunStateService({
    appDir,
    statePath: options.nativeRunStatePath || env.MWB_NATIVE_SKILL_RUN_STATE_PATH,
  });
  const listOfDatesRunner = createListOfDatesRunner({
    aiProvider: options.aiProvider || null,
    env,
  });
  const describeSourcesRunner = createDescribeSourcesRunner({
    env,
    sourceDescriptorProvider: options.sourceDescriptorProvider || null,
  });
  const matterStoryRunner = createMatterStoryRunner({
    matterStore,
    configurableSkillsService,
    service: matterStoryService,
  });
  const postureDiagnosisRunner = createProceduralPostureDiagnosisRunner({
    matterStore,
    service: proceduralPostureDiagnosisService,
  });
  const skillRunnerService = options.skillRunnerService || (jobStatusService?.createJob && jobStatusService?.getJob && jobStatusService?.updateJobStage
    ? createSkillRunnerService({
      jobStatusService,
      nativeRunStateService,
      runners: {
        [describeSourcesRunner.slash]: describeSourcesRunner,
        [listOfDatesRunner.slash]: listOfDatesRunner,
        [matterStoryRunner.slash]: matterStoryRunner,
        [postureDiagnosisRunner.slash]: postureDiagnosisRunner,
      },
    })
    : null);
  const matterLogService = options.matterLogService || createMatterLogService({
    configurableSkillRunsService,
    jobStatusService,
    matterEventsService,
  });
  const privateBetaObservabilityService = options.privateBetaObservabilityService || createPrivateBetaObservabilityService({
    feedbackService: privateBetaFeedbackService,
    heartbeatService: privateBetaHeartbeatService,
    jobStatusService,
    metricsService: privateBetaMetricsService,
    signalService: privateBetaSignalService,
  });
  const skillRegistryService = createSkillRegistryService({
    appDir,
    registryPath: options.skillRegistryPath,
    configurableSkillsService,
  });
  const matterStatusService = createMatterStatusService({ matterStore, skillRegistryService, proceduralPostureDiagnosisService });
  const prepareMatterService = createPrepareMatterService({ matterStore, matterStatusService, matterStoryService, proceduralPostureDiagnosisService });
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
    providerService: aiProviderService,
    env,
    fetchImpl: options.fetchImpl || fetch,
  });
  const skillRouterService = createSkillRouterService({
    registryService: skillRegistryService,
    aiProvider: options.skillRouterProvider || null,
    providerService: aiProviderService,
    env,
  });
  const skillSampleOutputService = createSkillSampleOutputService({
    matterStore,
    sampleProvider: options.skillSampleOutputProvider || null,
    providerService: aiProviderService,
    env,
    fetchImpl: options.fetchImpl || fetch,
    endpoint: options.skillSampleOutputEndpoint,
  });
  const systemHealthService = options.systemHealthService || createSystemHealthService({
    appDir,
    aiSettingsService,
    commandInteractionLogService,
    configService,
    env,
    jobStatusService,
    matterStore,
    privateBetaObservabilityService,
    runtimeDbStorageService,
  });
  const userReadinessService = options.userReadinessService || createUserReadinessService({
    aiSettingsService,
    configService,
    matterStore,
    runtimeDbStorageService,
  });
  const services = {
    aiProvider: options.aiProvider || null,
    aiProviderService,
    aiSettingsService,
    commandInteractionLogService,
    configurableSkillRunsService,
    configService,
    configurableSkillsService,
    env,
    jobStatusService,
    matterAttentionService,
    matterEventsService,
    matterLogService,
    matterCopilotService,
    copilotInteractionReceiptService,
    copilotWebResearchService,
    matterStore,
    matterContextService,
    matterStatusService,
    matterStoryService,
    proceduralPostureDiagnosisService,
    maxUploadBytes,
    maxUploadFiles,
    prepareMatterService,
    privateBetaAuthService,
    privateBetaFeedbackService,
    privateBetaHeartbeatService,
    nativeRunStateService,
    privateBetaMetricsService,
    privateBetaObservabilityService,
    privateBetaSignalService,
    privateBetaUsersService,
    telemetryRetryService,
    runtimeDbStorageService,
    runtimeDbSourceRemovalMutationService,
    skillIdeasService,
    skillFactoryHealthService,
    skillInterviewPlannerService,
    skillRegistryService,
    skillRunnerService,
    skillRouterService,
    skillSamplesService,
    skillSampleOutputService,
    systemHealthService,
    userReadinessService,
    sourceDescriptorProvider: options.sourceDescriptorProvider || null,
    sourceRemovalMutationService,
    uploadService,
    workspaceService,
  };

  const server = createServer(async (request, response) => {
    const startedAt = Date.now();
    let pathname = "/";
    const traceId = newTraceId();
    try {
      const requestUrl = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      pathname = requestUrl.pathname;
      response.setHeader("x-mwb-trace-id", traceId);
      const requestContext = {
        ...requestContextFromAuthStatus(privateBetaAuthService.status(request)),
        requestId: traceId,
        traceId,
        method: request.method,
        pathname,
      };
      await runWithRequestContext(requestContext, async () => {
        if (await handlePrivateBetaAuthApiRequest({ request, requestUrl, response, services })) return;
        if (requirePrivateBetaAuth({ request, requestUrl, response, services })) return;
        if (await handleApiRequest({ request, requestUrl, response, services })) return;

        if (request.method === "GET") {
          await serveStatic({ appDir, request, response });
          return;
        }

        response.writeHead(405);
        response.end("Method not allowed");
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      const rawMessage = error.statusCode ? error.message : "Internal server error";
      const rawCode = safeErrorCode(error.code) || "";
      sendJson(response, statusCode, {
        error: userFacingAiErrorMessage(rawMessage, rawCode) || rawMessage,
        code: safeErrorCode(userFacingAiErrorCode(rawMessage, rawCode)) || "",
        stack: env.NODE_ENV === "development" ? error.stack : undefined,
      });
    } finally {
      privateBetaMetricsService.observeRequest?.({
        method: request.method,
        pathname,
        traceId,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
        visibleProgress: !isLikelySilentWaitPath(pathname),
      });
    }
  });

  const runtimeDbProcessingWorkerService = options.runtimeDbProcessingWorkerService || createRuntimeDbProcessingWorkerService({
    runtimeDbStorageService,
    env,
    stageHandlers: {
      matter_story: ({ matter, job }) => runRuntimeDbMatterStoryWorkerJob({ runtimeDbStorageService, matterStoryService, matter, job }),
      posture_diagnosis: ({ matter, job }) => runRuntimeDbPostureDiagnosisWorkerJob({ runtimeDbStorageService, proceduralPostureDiagnosisService, matter, job }),
    },
  });
  services.runtimeDbProcessingWorkerService = runtimeDbProcessingWorkerService;
  if (runtimeDbProcessingWorkerService.enabled?.()) {
    server.once("listening", () => runtimeDbProcessingWorkerService.start?.());
    server.once("close", () => runtimeDbProcessingWorkerService.stop?.());
  }

  if (hasTelemetrySyncConfig(env)) {
    server.once("listening", () => telemetryRetryService.start({ immediate: true }));
    server.once("close", () => telemetryRetryService.stop());
  }

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

function hasTelemetrySyncConfig(env = {}) {
  const feedbackReady = Boolean(
    String(env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL || "").trim()
    && String(env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN || "").trim(),
  );
  const signalReady = Boolean(
    String(env.MWB_PRIVATE_BETA_SIGNAL_SYNC_URL || "").trim()
    && String(env.MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN || "").trim(),
  );
  const metricsReady = Boolean(
    String(env.MWB_PRIVATE_BETA_METRICS_SYNC_URL
      || siblingMothershipSyncUrl(env.MWB_PRIVATE_BETA_SIGNAL_SYNC_URL || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL, "/v1/metrics")).trim()
    && String(env.MWB_PRIVATE_BETA_METRICS_SYNC_TOKEN || env.MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN || "").trim(),
  );
  const heartbeatReady = Boolean(
    String(env.MWB_PRIVATE_BETA_HEARTBEAT_SYNC_URL
      || siblingMothershipSyncUrl(env.MWB_PRIVATE_BETA_METRICS_SYNC_URL || env.MWB_PRIVATE_BETA_SIGNAL_SYNC_URL || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL, "/v1/heartbeats")).trim()
    && String(env.MWB_PRIVATE_BETA_HEARTBEAT_SYNC_TOKEN
      || env.MWB_PRIVATE_BETA_METRICS_SYNC_TOKEN
      || env.MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN
      || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN
      || "").trim(),
  );
  return feedbackReady || signalReady || metricsReady || heartbeatReady;
}

function siblingMothershipSyncUrl(value = "", pathname = "/v1/metrics") {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function configuredMaxUploadBytes(env = process.env) {
  const configured = Number(env.MWB_MAX_UPLOAD_BYTES || env.MWB_UPLOAD_MAX_BYTES || "");
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_BYTES;
}

export function configuredMaxUploadFiles(env = process.env) {
  const configured = Number(env.MWB_MAX_UPLOAD_FILES || env.MWB_UPLOAD_MAX_FILES || "");
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_FILES;
}

function buildDeploymentMetricsContext({ env = {}, host = "", port = "", matterStore } = {}) {
  const publicUrl = env.MWB_PRIVATE_BETA_PUBLIC_URL || env.MWB_PRIVATE_VM_BASE_URL || env.MWB_PUBLIC_URL || `http://${host}:${port}`;
  const runtimeDb = Boolean(matterStore?.hasRuntimeDbStorageMode?.());
  return {
    commit: env.MWB_PRIVATE_VM_DEPLOY_COMMIT || env.MWB_DEPLOY_COMMIT || env.GIT_COMMIT || "",
    baseUrl: publicUrl,
    storageMode: runtimeDb ? "postgres" : "filesystem",
    runtimeMode: runtimeDb ? "runtime-db" : "filesystem",
    restoreDrill: env.MWB_RESTORE_DRILL_STATUS || "unknown",
    storageBackup: env.MWB_STORAGE_BACKUP_STATUS || "unknown",
  };
}

async function buildHeartbeatJourneyContext({
  privateBetaFeedbackService,
  privateBetaSignalService,
  jobStatusService,
  matterStore,
  runtimeDbStorageService,
  matterAttentionService,
  prepareMatterService,
} = {}) {
  const [feedbackLedger, signalLedger, jobLedger] = await Promise.all([
    safeReadTelemetryLedger(() => privateBetaFeedbackService?.listFeedback?.({ limit: 50 })),
    safeReadTelemetryLedger(() => privateBetaSignalService?.listSignals?.({ limit: 50 })),
    safeReadTelemetryLedger(() => jobStatusService?.listJobs?.({ limit: 50 })),
  ]);
  const feedback = Array.isArray(feedbackLedger.feedback) ? feedbackLedger.feedback : [];
  const signals = Array.isArray(signalLedger.signals) ? signalLedger.signals : [];
  const jobs = Array.isArray(jobLedger.jobs) ? jobLedger.jobs : [];
  const runningJobs = jobs.filter((job) => job.status === "running");
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const matterHealth = await readRecentMatterHealthSnapshots({
    matterNames: recentProblemMatterNames({ feedback, signals, jobs }),
    matterStore,
    runtimeDbStorageService,
    matterAttentionService,
    prepareMatterService,
  });
  return {
    activeSessions: 0,
    journeys: runningJobs.slice(0, 10).map((job) => ({
      user: job.user || job.username || "",
      matter: job.matterName || "",
      screen: "background_job",
      lastAction: job.kind || "job",
      currentStage: job.metadata?.latestStage?.label || job.label || job.kind || "job",
      currentStageStatus: job.status || "running",
      traceId: job.traceId || "",
      jobId: job.id || "",
      lastError: job.errorMessage || "",
      patienceRisk: job.metadata?.latestStage?.status === "failed" ? "high" : "low",
    })),
    counters: {
      queuedFeedback: feedback.filter((item) => item.sync?.status === "queued").length,
      openSignals: signals.length,
      failedJobs: failedJobs.length,
      slowStages: runningJobs.length,
    },
    matterHealth,
  };
}

function recentProblemMatterNames({ feedback = [], signals = [], jobs = [] } = {}) {
  const names = [];
  for (const job of jobs) {
    if (job.matterName) names.push(job.matterName);
  }
  for (const signal of signals) {
    if (signal.matterName) names.push(signal.matterName);
  }
  for (const item of feedback) {
    if (item.context?.activeMatterName) names.push(item.context.activeMatterName);
    if (item.matterName) names.push(item.matterName);
  }
  const seen = new Set();
  const output = [];
  for (const name of names) {
    const normalized = String(name || "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= 8) break;
  }
  return output;
}

async function readRecentMatterHealthSnapshots({
  matterNames = [],
  matterStore,
  runtimeDbStorageService,
  matterAttentionService,
  prepareMatterService,
} = {}) {
  const snapshots = [];
  for (const matterName of matterNames) {
    try {
      snapshots.push(await readMatterHealthSnapshot({
        matterName,
        matterStore,
        runtimeDbStorageService,
        matterAttentionService,
        prepareMatterService,
      }));
    } catch (error) {
      snapshots.push({
        matter: matterName,
        prepareState: "unavailable",
        nextStepLabel: "",
        attentionState: "unknown",
        blockers: 0,
        warnings: 0,
        checkedAt: new Date().toISOString(),
        details: { error: String(error?.message || "matter health unavailable").slice(0, 220) },
      });
    }
  }
  return snapshots;
}

async function readMatterHealthSnapshot({
  matterName,
  matterStore,
  runtimeDbStorageService,
  matterAttentionService,
  prepareMatterService,
} = {}) {
  const checkedAt = new Date().toISOString();
  if (matterStore?.hasRuntimeDbStorageMode?.() && runtimeDbStorageService?.enabled) {
    const matter = await matterStore.resolveExistingMatter(matterName);
    const [plan, attention] = await Promise.all([
      runtimeDbStorageService.readPrepareMatterPlan(matter),
      runtimeDbStorageService.readMatterAttention(matter),
    ]);
    return matterHealthFromPlanAndAttention({ matterName, plan, attention, checkedAt });
  }

  const { name, matterPath } = await matterStore.resolveExistingMatter(matterName);
  const [plan, attention] = await Promise.all([
    prepareMatterService.readPrepareMatterPlan(matterPath),
    matterAttentionService.readMatterAttention(matterPath, { matterName: name }),
  ]);
  return matterHealthFromPlanAndAttention({ matterName: name, plan, attention, checkedAt });
}

function matterHealthFromPlanAndAttention({ matterName, plan = {}, attention = {}, checkedAt }) {
  const nextStep = plan.nextStep || {};
  const summary = attention.summary || {};
  return {
    matter: matterName,
    prepareState: String(nextStep.state || ""),
    nextStepLabel: String(nextStep.label || ""),
    attentionState: String(summary.state || ""),
    blockers: Number(summary.blocker) || 0,
    warnings: Number(summary.warning) || 0,
    checkedAt,
  };
}

async function runRuntimeDbMatterStoryWorkerJob({ runtimeDbStorageService, matterStoryService, matter, job = {} } = {}) {
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "readMatterContextPacket", "matter story context");
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "readMatterJson", "matter story matter metadata");
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "artifactExists", "matter story artifact existence");
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "persistTextArtifacts", "matter story artifact persistence");
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "persistMatterJson", "matter story metadata persistence");
  const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
  const matterJson = await runtimeDbStorageService.readMatterJson(matter);
  const result = await matterStoryService.runDisputeStory({
    matterName: matter.name,
    overwrite: runtimeDbWorkerShouldOverwrite(job),
    matterRootOverride: `postgres:${matter.name}`,
    matterRecordOverride: matter,
    matterContextPacketOverride: packet,
    artifactExistsOverride: (relativePath) => runtimeDbStorageService.artifactExists(matter, relativePath),
    artifactWriter: ({ outputPaths, markdown, metadata, runId }) => runtimeDbStorageService.persistTextArtifacts(matter, [
      { relativePath: outputPaths.markdown, text: `${String(markdown || "")}\n` },
      { relativePath: outputPaths.json, text: `${JSON.stringify({ ...metadata, runId, markdown: String(markdown || "") }, null, 2)}\n` },
    ]),
    matterJsonOverride: matterJson,
    matterJsonWriter: ({ matterJson: nextMatterJson }) => runtimeDbStorageService.persistMatterJson(matter, nextMatterJson),
    storyMarkdownReader: typeof runtimeDbStorageService.readFilePreview === "function"
      ? async (relativePath) => (await runtimeDbStorageService.readFilePreview(relativePath, matter)).content
      : null,
  });
  return { state: result?.state || "succeeded", operationResult: result };
}

async function runRuntimeDbPostureDiagnosisWorkerJob({ runtimeDbStorageService, proceduralPostureDiagnosisService, matter, job = {} } = {}) {
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "readMatterContextPacket", "procedural posture context");
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "readMatterJson", "procedural posture matter metadata");
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "artifactExists", "procedural posture artifact existence");
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "readFilePreview", "procedural posture artifact reading");
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "artifactStat", "procedural posture artifact timestamps");
  assertRuntimeDbWorkerMethod(runtimeDbStorageService, "persistTextArtifacts", "procedural posture artifact persistence");
  const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
  const matterJson = await runtimeDbStorageService.readMatterJson(matter);
  const result = await proceduralPostureDiagnosisService.runDiagnosis({
    matterName: matter.name,
    overwrite: runtimeDbWorkerShouldOverwrite(job),
    matterRootOverride: `postgres:${matter.name}`,
    matterRecordOverride: matter,
    matterContextPacketOverride: packet,
    matterJsonOverride: matterJson,
    artifactExistsOverride: (relativePath) => runtimeDbStorageService.artifactExists(matter, relativePath),
    artifactReader: async (relativePath) => (await runtimeDbStorageService.readFilePreview(relativePath, matter)).content,
    artifactStatReader: (relativePath) => runtimeDbStorageService.artifactStat(matter, relativePath),
    artifactWriter: ({ files }) => runtimeDbStorageService.persistTextArtifacts(matter, files),
  });
  return { state: result?.status || "succeeded", operationResult: result };
}

function assertRuntimeDbWorkerMethod(service, method, label) {
  if (typeof service?.[method] !== "function") {
    throw new Error(`Runtime DB worker cannot run ${label}; missing ${method}.`);
  }
}

function runtimeDbWorkerShouldOverwrite(job = {}) {
  return job?.progress?.forceOverwrite === true
    || String(job?.progress?.preparationStage?.state || "").trim().toLowerCase() === "stale";
}

async function safeReadTelemetryLedger(reader) {
  if (typeof reader !== "function") return {};
  try {
    const result = await reader();
    return result && typeof result === "object" ? result : {};
  } catch {
    return {};
  }
}

function isLikelySilentWaitPath(pathname = "") {
  return /\/api\/(matter-copilot|configurable-skills\/run|extract|describe-sources|create-listofdates)/.test(pathname);
}

function safeErrorCode(value) {
  const code = String(value || "").trim();
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(code) ? code : undefined;
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
    void runStartupAiChecks({ aiSettingsService: app.services.aiSettingsService }).catch((error) => {
      console.log(`Matter Copilot startup check: failed - ${error.message}`);
    });
  });
}

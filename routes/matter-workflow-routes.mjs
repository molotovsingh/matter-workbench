import { runCreateListOfDates } from "../create-listofdates-engine.mjs";
import { runExtract } from "../extract-engine.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { runDoctorFix, runDoctorScan } from "../services/doctor-service.mjs";
import { refreshListOfDatesSourceLabels } from "../services/listofdates-label-refresh-service.mjs";
import { runSourceDescriptors } from "../source-descriptors-engine.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { readRequestJson, sendJson } from "./http-utils.mjs";
import { dispatchRoutes, exactRoute } from "./route-dispatcher.mjs";
import { safeCaptureBetaSignal, usesRuntimeDbStorage } from "./route-utils.mjs";

export async function handleMatterWorkflowApiRequest({ request, requestUrl, response, services }) {
  const {
    jobStatusService,
    matterAttentionService,
    matterCopilotService,
    matterContextService,
    matterStore,
    matterStoryService,
    matterStatusService,
    prepareMatterService,
    privateBetaSignalService,
    runtimeDbStorageService,
  } = services;

  return dispatchRoutes({
    request,
    requestUrl,
    response,
    routes: [
      exactRoute("POST", "/api/matter-init", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "intake",
          label: "Set Up Matter",
          matterName: matterNameForBody(matterStore, body),
          operation: async () => {
            if (hasRuntimeDbWritePath(matterStore, runtimeDbStorageService)) {
              return runRuntimeDbMaterializedWorkflow({
                matterStore,
                runtimeDbStorageService,
                body,
                runner: ({ matterRoot }) => runMatterInit({
                  matterRoot,
                  metadata: body.metadata || {},
                  dryRun: Boolean(body.dryRun),
                  intakeId: typeof body.intakeId === "string" && body.intakeId.trim() ? body.intakeId.trim() : undefined,
                  intakeDirName: typeof body.intakeDirName === "string" && body.intakeDirName.trim() ? body.intakeDirName.trim() : undefined,
                  intakeLabel: typeof body.intakeLabel === "string" && body.intakeLabel.trim() ? body.intakeLabel.trim() : undefined,
                  receivedDate: typeof body.receivedDate === "string" && body.receivedDate.trim() ? body.receivedDate.trim() : undefined,
                }),
              });
            }
            assertFilesystemWorkflowAvailable(matterStore, "Set up matter");
            const root = await matterRootForBody(matterStore, body);
            return runMatterInit({
              matterRoot: root,
              metadata: body.metadata || {},
              dryRun: Boolean(body.dryRun),
              intakeId: typeof body.intakeId === "string" && body.intakeId.trim() ? body.intakeId.trim() : undefined,
              intakeDirName: typeof body.intakeDirName === "string" && body.intakeDirName.trim() ? body.intakeDirName.trim() : undefined,
              intakeLabel: typeof body.intakeLabel === "string" && body.intakeLabel.trim() ? body.intakeLabel.trim() : undefined,
              receivedDate: typeof body.receivedDate === "string" && body.receivedDate.trim() ? body.receivedDate.trim() : undefined,
            });
          },
        }));
      }),
      exactRoute("POST", "/api/extract", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "extract",
          label: "Extract Documents",
          matterName: matterNameForBody(matterStore, body),
          operation: async () => {
            if (hasRuntimeDbWritePath(matterStore, runtimeDbStorageService)) {
              return runRuntimeDbMaterializedWorkflow({
                matterStore,
                runtimeDbStorageService,
                body,
                runner: ({ matterRoot }) => runExtract({
                  matterRoot,
                  dryRun: Boolean(body.dryRun),
                  forceRefresh: Boolean(body.forceRefresh),
                  intakeFilter: typeof body.intakeId === "string" && body.intakeId.trim()
                    ? body.intakeId.trim()
                    : null,
                }),
              });
            }
            assertFilesystemWorkflowAvailable(matterStore, "Extract documents");
            const root = await matterRootForBody(matterStore, body);
            return runExtract({
              matterRoot: root,
              dryRun: Boolean(body.dryRun),
              forceRefresh: Boolean(body.forceRefresh),
              intakeFilter: typeof body.intakeId === "string" && body.intakeId.trim()
                ? body.intakeId.trim()
                : null,
            });
          },
        }));
      }),
      exactRoute("POST", "/api/describe-sources", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "source_labels",
          label: "Label Sources",
          matterName: matterNameForBody(matterStore, body),
          operation: async () => {
            if (hasRuntimeDbWritePath(matterStore, runtimeDbStorageService)) {
              return runRuntimeDbMaterializedWorkflow({
                matterStore,
                runtimeDbStorageService,
                body,
                runner: ({ matterRoot }) => runSourceDescriptors({
                  matterRoot,
                  dryRun: Boolean(body.dryRun),
                  env: services.env || {},
                  sourceDescriptorProvider: services.sourceDescriptorProvider,
                }),
              });
            }
            assertFilesystemWorkflowAvailable(matterStore, "Label sources");
            const root = await matterRootForBody(matterStore, body);
            return runSourceDescriptors({
              matterRoot: root,
              dryRun: Boolean(body.dryRun),
              env: services.env || {},
              sourceDescriptorProvider: services.sourceDescriptorProvider,
            });
          },
        }));
      }),
      exactRoute("POST", "/api/create-listofdates", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "list_of_dates",
          label: "Create List of Dates",
          matterName: matterNameForBody(matterStore, body),
          operation: async () => {
            if (hasRuntimeDbWritePath(matterStore, runtimeDbStorageService)) {
              const env = services.env || {};
              const modelPolicy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, { env });
              return runRuntimeDbMaterializedWorkflow({
                matterStore,
                runtimeDbStorageService,
                body,
                runner: ({ matterRoot }) => {
                  const options = {
                    matterRoot,
                    dryRun: Boolean(body.dryRun),
                    aiProvider: services.aiProvider,
                    env,
                  };
                  if (modelPolicy.provider === AI_PROVIDERS.OPENAI_DIRECT) {
                    options.apiKey = env.OPENAI_API_KEY;
                    options.maxOutputTokens = env.OPENAI_MAX_OUTPUT_TOKENS;
                  }
                  return runCreateListOfDates(options);
                },
              });
            }
            assertFilesystemWorkflowAvailable(matterStore, "Create List of Dates");
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
            return runCreateListOfDates(options);
          },
        }));
      }),
      exactRoute("POST", "/api/create-listofdates/refresh-labels", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "label_refresh",
          label: "Refresh List of Dates Labels",
          matterName: matterNameForBody(matterStore, body),
          operation: async () => {
            if (hasRuntimeDbWritePath(matterStore, runtimeDbStorageService)) {
              return runRuntimeDbMaterializedWorkflow({
                matterStore,
                runtimeDbStorageService,
                body,
                runner: ({ matterRoot }) => refreshListOfDatesSourceLabels({
                  matterRoot,
                  dryRun: Boolean(body.dryRun),
                }),
              });
            }
            assertFilesystemWorkflowAvailable(matterStore, "Refresh List of Dates labels");
            const root = await matterRootForBody(matterStore, body);
            return refreshListOfDatesSourceLabels({
              matterRoot: root,
              dryRun: Boolean(body.dryRun),
            });
          },
        }));
      }),
      exactRoute("POST", "/api/matter-story", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "custom_skill",
          label: "The Story",
          matterName: matterNameForBody(matterStore, body),
          operation: async () => {
            if (hasRuntimeDbWritePath(matterStore, runtimeDbStorageService)) {
              return runRuntimeDbMaterializedWorkflow({
                matterStore,
                runtimeDbStorageService,
                body,
                runner: ({ matterRoot, matter }) => matterStoryService.runDisputeStory({
                  matterName: matter.name,
                  overwrite: Boolean(body.overwrite),
                  matterRootOverride: matterRoot,
                  matterRecordOverride: matter,
                }),
              });
            }
            assertFilesystemWorkflowAvailable(matterStore, "Write dispute story");
            return matterStoryService.runDisputeStory({
              matterName: body.matterName,
              overwrite: Boolean(body.overwrite),
            });
          },
        }));
      }),
      exactRoute("POST", "/api/doctor/scan", async () => {
        const body = await readRequestJson(request);
        if (hasRuntimeDbReadPath(matterStore, runtimeDbStorageService)) {
          sendJson(response, 200, await runRuntimeDbMaterializedRead({
            matterStore,
            runtimeDbStorageService,
            body,
            runner: ({ matterRoot }) => runDoctorScan(matterRoot),
          }));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Scan matter");
        sendJson(response, 200, await runDoctorScan(await matterRootForBody(matterStore, body)));
      }),
      exactRoute("POST", "/api/doctor/fix", async () => {
        const body = await readRequestJson(request);
        const fixIds = Array.isArray(body.fixIds) ? body.fixIds.filter((id) => typeof id === "string") : [];
        if (!fixIds.length) {
          const error = new Error("No fixes selected");
          error.statusCode = 400;
          throw error;
        }
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "validation",
          label: "Fix Matter",
          matterName: matterNameForBody(matterStore, body),
          operation: async () => {
            if (hasRuntimeDbWritePath(matterStore, runtimeDbStorageService)) {
              return runRuntimeDbMaterializedWorkflow({
                matterStore,
                runtimeDbStorageService,
                body,
                runner: ({ matterRoot }) => runDoctorFix(matterRoot, fixIds),
              });
            }
            assertFilesystemWorkflowAvailable(matterStore, "Fix matter");
            const root = await matterRootForBody(matterStore, body);
            return runDoctorFix(root, fixIds);
          },
        }));
      }),
      exactRoute("GET", "/api/matter-status", async () => {
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          sendJson(response, 200, await runtimeDbStorageService.readMatterStatus(matter));
          return;
        }
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await matterStatusService.readMatterStatus(root));
      }),
      exactRoute("GET", "/api/matter-attention", async () => {
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          const attention = await runtimeDbStorageService.readMatterAttention(matter);
          await safeCaptureBetaSignal(() => privateBetaSignalService?.captureMatterAttention(attention, {
            runtimeMode: "postgres",
          }));
          sendJson(response, 200, attention);
          return;
        }
        const matterName = requestUrl.searchParams.get("matter") || "";
        if (matterName.trim()) {
          const { name, matterPath } = await matterStore.resolveExistingMatter(matterName);
          const attention = await matterAttentionService.readMatterAttention(matterPath, { matterName: name });
          await safeCaptureBetaSignal(() => privateBetaSignalService?.captureMatterAttention(attention, {
            runtimeMode: "filesystem",
          }));
          sendJson(response, 200, attention);
          return;
        }
        const attention = await matterAttentionService.readMatterAttention();
        await safeCaptureBetaSignal(() => privateBetaSignalService?.captureMatterAttention(attention, {
          runtimeMode: "filesystem",
        }));
        sendJson(response, 200, attention);
      }),
      exactRoute("GET", "/api/prepare-matter", async () => {
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl, { allowMissingActive: true });
          sendJson(response, 200, await runtimeDbStorageService.readPrepareMatterPlan(matter));
          return;
        }
        const root = await matterRootForQuery(matterStore, requestUrl, { allowMissingActive: true });
        sendJson(response, 200, await prepareMatterService.readPrepareMatterPlan(root));
      }),
      exactRoute("GET", "/api/matter-context/search", async () => {
        if (hasRuntimeDbReadPath(matterStore, runtimeDbStorageService)) {
          sendJson(response, 200, await runRuntimeDbMaterializedRead({
            matterStore,
            runtimeDbStorageService,
            requestUrl,
            runner: ({ matterRoot }) => matterContextService.searchMatterContext({
              root: matterRoot,
              query: requestUrl.searchParams.get("q") || "",
            }),
          }));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Search matter context");
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await matterContextService.searchMatterContext({
          root,
          query: requestUrl.searchParams.get("q") || "",
        }));
      }),
      exactRoute("GET", "/api/matter-context", async () => {
        if (hasRuntimeDbReadPath(matterStore, runtimeDbStorageService)) {
          sendJson(response, 200, await runRuntimeDbMaterializedRead({
            matterStore,
            runtimeDbStorageService,
            requestUrl,
            runner: ({ matterRoot }) => matterContextService.readMatterContextPreview(matterRoot),
          }));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Read matter context");
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await matterContextService.readMatterContextPreview(root));
      }),
      exactRoute("POST", "/api/matter-copilot/answer", async () => {
        const body = await readRequestJson(request);
        if (hasRuntimeDbReadPath(matterStore, runtimeDbStorageService)) {
          sendJson(response, 200, await runRuntimeDbMaterializedRead({
            matterStore,
            runtimeDbStorageService,
            body,
            runner: ({ matterRoot }) => matterCopilotService.answerQuestion({
              root: matterRoot,
              question: body.question,
            }),
          }));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Matter copilot");
        const root = await matterRootForBody(matterStore, body);
        sendJson(response, 200, await matterCopilotService.answerQuestion({
          root,
          question: body.question,
        }));
      }),
      exactRoute("GET", "/api/rerun-advice", async () => {
        if (hasRuntimeDbReadPath(matterStore, runtimeDbStorageService)) {
          sendJson(response, 200, await runRuntimeDbMaterializedRead({
            matterStore,
            runtimeDbStorageService,
            requestUrl,
            runner: ({ matterRoot }) => matterStatusService.readRerunAdvice(requestUrl.searchParams.get("skill") || "", matterRoot),
          }));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Read rerun advice");
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await matterStatusService.readRerunAdvice(requestUrl.searchParams.get("skill") || "", root));
      }),
    ],
  });
}

function hasRuntimeDbWritePath(matterStore, runtimeDbStorageService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && typeof runtimeDbStorageService.runMaterializedMatterWrite === "function";
}

function hasRuntimeDbReadPath(matterStore, runtimeDbStorageService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && typeof runtimeDbStorageService.runMaterializedMatterRead === "function";
}

async function runTrackedWorkflow({
  jobStatusService,
  kind,
  label,
  matterName,
  operation,
}) {
  if (!jobStatusService?.runTrackedJob) return operation();
  const { result, job } = await jobStatusService.runTrackedJob({
    kind,
    label,
    matterName,
    operation,
  });
  return attachJobStatus(result, job);
}

function attachJobStatus(result, job) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...result, job };
  }
  return { result, job };
}

function matterNameForBody(matterStore, body = {}) {
  const matterName = typeof body.matterName === "string" ? body.matterName.trim() : "";
  if (matterName) return matterName;
  return matterStore.activeMatterNameWithinHome?.() || matterStore.getActiveMatterRecord?.()?.name || "";
}

async function runRuntimeDbMaterializedWorkflow({
  matterStore,
  runtimeDbStorageService,
  body,
  runner,
}) {
  const matter = await runtimeDbMatterForBody(matterStore, body);
  const result = await runtimeDbStorageService.runMaterializedMatterWrite(matter, ({ matterRoot }) => runner({ matterRoot, matter }));
  return runtimeDbWorkflowResponse(result, matter);
}

async function runRuntimeDbMaterializedRead({
  matterStore,
  runtimeDbStorageService,
  requestUrl,
  body,
  runner,
}) {
  const matter = body ? await runtimeDbMatterForBody(matterStore, body) : await runtimeDbMatterForQuery(matterStore, requestUrl);
  return runtimeDbStorageService.runMaterializedMatterRead(matter, ({ matterRoot }) => runner({ matterRoot, matter }));
}

function assertFilesystemWorkflowAvailable(matterStore, label) {
  if (!matterStore.hasRuntimeDbStorageMode?.()) return;
  const error = new Error(`${label} cannot run in DB storage mode because the runtime DB materialization adapter is not available. Check runtime DB storage service wiring or run this workflow in filesystem mode.`);
  error.statusCode = 409;
  throw error;
}

function runtimeDbWorkflowResponse(result = {}, matter = {}) {
  const operationResult = result && typeof result.operationResult === "object" && result.operationResult !== null
    ? { ...result.operationResult }
    : { result: result?.operationResult };
  operationResult.matterRoot = matter.matterPath || `postgres:${matter.name || ""}`;
  operationResult.dbPersistence = {
    persisted: Array.isArray(result.persisted) ? result.persisted : [],
  };
  return operationResult;
}

async function runtimeDbMatterForQuery(matterStore, requestUrl, { allowMissingActive = false } = {}) {
  const matterName = requestUrl.searchParams.get("matter")?.trim() || "";
  if (matterName) return matterStore.resolveExistingMatter(matterName);
  const activeMatter = matterStore.getActiveMatterRecord?.();
  if (activeMatter) return activeMatter;
  if (allowMissingActive) {
    matterStore.getMatterRoot?.();
  } else {
    matterStore.ensureMatterRoot();
  }
  return matterStore.getActiveMatterRecord?.();
}

async function runtimeDbMatterForBody(matterStore, body = {}) {
  const matterName = typeof body.matterName === "string" ? body.matterName.trim() : "";
  if (matterName) return matterStore.resolveExistingMatter(matterName);
  const activeMatter = matterStore.getActiveMatterRecord?.();
  if (activeMatter) return activeMatter;
  matterStore.ensureMatterRoot();
  return matterStore.getActiveMatterRecord?.();
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

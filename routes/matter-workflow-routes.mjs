import { runCreateListOfDates } from "../create-listofdates-engine.mjs";
import { runExtract } from "../extract-engine.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { runDoctorFix, runDoctorScan } from "../services/doctor-service.mjs";
import { searchMatterContextPacket, summarizeMatterContextPacket } from "../services/matter-context-service.mjs";
import { refreshListOfDatesSourceLabels } from "../services/listofdates-label-refresh-service.mjs";
import { runSourceDescriptors } from "../source-descriptors-engine.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { readRequestJson, sendJson } from "./http-utils.mjs";
import { dispatchRoutes, exactRoute } from "./route-dispatcher.mjs";
import { isPrivateBetaScopedUser, safeCaptureBetaSignal, usesRuntimeDbStorage } from "./route-utils.mjs";
import { presentMatterCopilotAnswerForScopedUser } from "./user-facing-presenters.mjs";

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
          route: "/api/matter-init",
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
          route: "/api/extract",
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
          route: "/api/describe-sources",
          label: "Label Sources",
          matterName: matterNameForBody(matterStore, body),
          operation: async ({ job } = {}) => {
            const onProgress = sourceLabelJobProgressReporter(jobStatusService, job);
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
                  onProgress,
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
              onProgress,
            });
          },
        }));
      }),
      exactRoute("POST", "/api/create-listofdates", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "list_of_dates",
          route: "/api/create-listofdates",
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
          route: "/api/create-listofdates/refresh-labels",
          label: "Refresh List of Dates Labels",
          matterName: matterNameForBody(matterStore, body),
          operation: async () => {
            if (hasRuntimeDbListOfDatesLabelRefreshPath(matterStore, runtimeDbStorageService)) {
              const matter = await runtimeDbMatterForBody(matterStore, body);
              const result = await runtimeDbStorageService.refreshListOfDatesSourceLabels(matter, {
                dryRun: Boolean(body.dryRun),
              });
              return runtimeDbWorkflowResponse(result, matter);
            }
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
          route: "/api/matter-story",
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
        if (hasRuntimeDbDoctorScanPath(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForBody(matterStore, body);
          sendJson(response, 200, runtimeDbReadResponse(await runtimeDbStorageService.readDoctorScan(matter), matter));
          return;
        }
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
          route: "/api/doctor/fix",
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
        if (hasRuntimeDbContextReadPath(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
          const result = searchMatterContextPacket(packet, requestUrl.searchParams.get("q") || "");
          sendJson(response, 200, runtimeDbReadResponse(result, matter));
          return;
        }
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
        if (hasRuntimeDbContextReadPath(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
          sendJson(response, 200, runtimeDbReadResponse(summarizeMatterContextPacket(packet), matter));
          return;
        }
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
        if (hasRuntimeDbContextReadPath(matterStore, runtimeDbStorageService)
          && typeof matterCopilotService.answerQuestionFromPacket === "function") {
          const matter = await runtimeDbMatterForBody(matterStore, body);
          const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
          const answer = await matterCopilotService.answerQuestionFromPacket({
            packet,
            question: body.question,
          });
          sendJson(response, 200, presentMatterCopilotAnswerForCurrentUser(runtimeDbReadResponse(answer, matter)));
          return;
        }
        if (hasRuntimeDbReadPath(matterStore, runtimeDbStorageService)) {
          const answer = await runRuntimeDbMaterializedRead({
            matterStore,
            runtimeDbStorageService,
            body,
            runner: ({ matterRoot }) => matterCopilotService.answerQuestion({
              root: matterRoot,
              question: body.question,
            }),
          });
          sendJson(response, 200, presentMatterCopilotAnswerForCurrentUser(answer));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Matter copilot");
        const root = await matterRootForBody(matterStore, body);
        const answer = await matterCopilotService.answerQuestion({
          root,
          question: body.question,
        });
        sendJson(response, 200, presentMatterCopilotAnswerForCurrentUser(answer));
      }),
      exactRoute("GET", "/api/rerun-advice", async () => {
        if (hasRuntimeDbRerunAdvicePath(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          const advice = await runtimeDbStorageService.readRerunAdvice(requestUrl.searchParams.get("skill") || "", matter);
          sendJson(response, 200, runtimeDbReadResponse(advice, matter));
          return;
        }
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

function hasRuntimeDbContextReadPath(matterStore, runtimeDbStorageService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && typeof runtimeDbStorageService.readMatterContextPacket === "function";
}

function hasRuntimeDbRerunAdvicePath(matterStore, runtimeDbStorageService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && typeof runtimeDbStorageService.readRerunAdvice === "function";
}

function hasRuntimeDbDoctorScanPath(matterStore, runtimeDbStorageService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && typeof runtimeDbStorageService.readDoctorScan === "function";
}

function hasRuntimeDbListOfDatesLabelRefreshPath(matterStore, runtimeDbStorageService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && typeof runtimeDbStorageService.refreshListOfDatesSourceLabels === "function";
}

async function runTrackedWorkflow({
  jobStatusService,
  kind,
  route = "",
  label,
  matterName,
  operation,
}) {
  if (!jobStatusService?.runTrackedJob) return operation();
  const { result, job } = await jobStatusService.runTrackedJob({
    kind,
    label,
    matterName,
    metadata: workflowJobMetadata({ kind, route, label }),
    failureErrorCode: workflowFailureErrorCode(kind),
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

function workflowJobMetadata({ kind, route, label } = {}) {
  const workflow = {
    stage: normalizeWorkflowStage(kind),
    label: sanitizeWorkflowText(label, 120),
  };
  const normalizedRoute = normalizeWorkflowRoute(route);
  if (normalizedRoute) workflow.route = normalizedRoute;
  return { workflow };
}

function workflowFailureErrorCode(kind) {
  return `workflow.${normalizeWorkflowStage(kind)}.failed`;
}

function normalizeWorkflowStage(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return text || "job";
}

function normalizeWorkflowRoute(value) {
  const text = String(value || "").trim();
  return /^\/api\/[a-z0-9/_-]+$/i.test(text) ? text.slice(0, 120) : "";
}

function sanitizeWorkflowText(value, maxLength = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sourceLabelJobProgressReporter(jobStatusService, job) {
  if (!jobStatusService?.updateJob || !job?.id) return null;
  return async (event = {}) => {
    const summary = sourceLabelProgressSummary(event);
    const metadata = { sourceLabelProgress: event };
    await jobStatusService.updateJob(job.id, { summary, metadata });
  };
}

function sourceLabelProgressSummary(event = {}) {
  const batch = `${event.batchIndex || "?"}/${event.batchCount || "?"}`;
  const sourceCount = Number.isInteger(event.sourceCount) ? event.sourceCount : 0;
  if (event.stage === "source-labels-batch-complete") {
    return `Source Labels batch ${batch} complete (${sourceCount} source${sourceCount === 1 ? "" : "s"})`;
  }
  return `Source Labels batch ${batch} running (${sourceCount} source${sourceCount === 1 ? "" : "s"})`;
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
  const result = await runtimeDbStorageService.runMaterializedMatterRead(matter, ({ matterRoot }) => runner({ matterRoot, matter }));
  return runtimeDbReadResponse(result, matter);
}

function runtimeDbReadResponse(result, matter = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  return {
    ...result,
    matterRoot: result.matterRoot || matter.matterPath || `postgres:${matter.name || ""}`,
    matterName: result.matterName || matter.matterName || matter.name || "",
  };
}

function presentMatterCopilotAnswerForCurrentUser(answer = {}) {
  return isPrivateBetaScopedUser() ? presentMatterCopilotAnswerForScopedUser(answer) : answer;
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

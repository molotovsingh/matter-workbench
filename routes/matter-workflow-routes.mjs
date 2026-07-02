import { randomUUID } from "node:crypto";

import { runCreateListOfDates } from "../create-listofdates-engine.mjs";
import { runExtract } from "../extract-engine.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { buildCopilotInteractionReceipt } from "../services/copilot-interaction-receipt-service.mjs";
import { currentRequestContext } from "../services/request-context.mjs";
import { runDoctorFix, runDoctorScan } from "../services/doctor-service.mjs";
import { createSkillStageService } from "../services/skill-stage-service.mjs";
import { searchMatterContextPacket, summarizeMatterContextPacket } from "../services/matter-context-service.mjs";
import { buildSourceRemovalImpactPreviewFromPacket, previewSourceRemovalImpact } from "../services/source-removal-impact-preview-service.mjs";
import { refreshListOfDatesSourceLabels } from "../services/listofdates-label-refresh-service.mjs";
import { runSourceDescriptors } from "../source-descriptors-engine.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import {
  firstBlockedRuntimePreparationStage,
  firstQueueableRuntimePreparationStage,
  RUNTIME_PREPARATION_ACTIVE_JOB_STATUSES,
  runtimePreparationJobKindForStage,
  runtimePreparationJobMetadataForStage,
  safeRuntimePreparationChainId,
} from "../shared/runtime-preparation-jobs.mjs";
import { readRequestJson, sendJson } from "./http-utils.mjs";
import { dispatchRoutes, exactRoute, patternRoute } from "./route-dispatcher.mjs";
import {
  isPrivateBetaScopedUser,
  matterRootForBody,
  matterRootForQuery,
  runtimeDbMatterForBody,
  runtimeDbMatterForQuery,
  safeCaptureBetaSignal,
  usesRuntimeDbStorage,
} from "./route-utils.mjs";
import { presentMatterCopilotAnswerForScopedUser } from "./user-facing-presenters.mjs";

export async function handleMatterWorkflowApiRequest({ request, requestUrl, response, services }) {
  const {
    jobStatusService,
    matterAttentionService,
    matterCopilotService,
    copilotInteractionReceiptService,
    copilotWebResearchService,
    matterContextService,
    matterStore,
    matterStoryService,
    proceduralPostureDiagnosisService,
    matterStatusService,
    prepareMatterService,
    privateBetaSignalService,
    runtimeDbStorageService,
    runtimeDbProcessingWorkerService,
    runtimeDbSourceRemovalMutationService,
    skillRunnerService,
    sourceRemovalMutationService,
  } = services;

  return dispatchRoutes({
    request,
    requestUrl,
    response,
    routes: [
      patternRoute("POST", /^\/api\/skill\/([^/]+)\/run$/, async ({ params }) => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runNativeSkillAlias({
          slash: params[0],
          body,
          matterStore,
          runtimeDbStorageService,
          skillRunnerService,
        }));
      }),
      exactRoute("POST", "/api/matter-init", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "intake",
          route: "/api/matter-init",
          label: "Set Up Matter",
          matterName: matterNameForBody(matterStore, body),
          operation: async () => {
            if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
              const matter = await runtimeDbMatterForBody(matterStore, body);
              assertRuntimeDbMatterInitAvailable({ runtimeDbStorageService });
              const result = await runtimeDbStorageService.initializeMatter(matter, {
                metadata: body.metadata || {},
                dryRun: Boolean(body.dryRun),
                intakeId: typeof body.intakeId === "string" && body.intakeId.trim() ? body.intakeId.trim() : undefined,
                intakeDirName: typeof body.intakeDirName === "string" && body.intakeDirName.trim() ? body.intakeDirName.trim() : undefined,
                intakeLabel: typeof body.intakeLabel === "string" && body.intakeLabel.trim() ? body.intakeLabel.trim() : undefined,
                receivedDate: typeof body.receivedDate === "string" && body.receivedDate.trim() ? body.receivedDate.trim() : undefined,
              });
              return runtimeDbWorkflowResponse(result, matter);
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
            if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
              const matter = await runtimeDbMatterForBody(matterStore, body);
              assertRuntimeDbExtractAvailable({ runtimeDbStorageService });
              const result = await runtimeDbStorageService.extractDocuments(matter, {
                dryRun: Boolean(body.dryRun),
                forceRefresh: Boolean(body.forceRefresh),
                intakeFilter: typeof body.intakeId === "string" && body.intakeId.trim()
                  ? body.intakeId.trim()
                  : null,
                env: services.env || {},
              });
              return runtimeDbWorkflowResponse(result, matter);
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
            if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
              const matter = await runtimeDbMatterForBody(matterStore, body);
              assertRuntimeDbSourceDescriptorsAvailable({ runtimeDbStorageService });
              const result = await runtimeDbStorageService.describeSources(matter, {
                dryRun: Boolean(body.dryRun),
                env: services.env || {},
                sourceDescriptorProvider: services.sourceDescriptorProvider,
                onProgress,
              });
              return runtimeDbWorkflowResponse(result, matter);
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
        if (skillRunnerService?.start) {
          sendJson(response, 200, await runListOfDatesSkill({
            body,
            matterStore,
            runtimeDbStorageService,
            skillRunnerService,
          }));
          return;
        }
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "list_of_dates",
          route: "/api/create-listofdates",
          label: "Build Case Timeline",
          matterName: matterNameForBody(matterStore, body),
          operation: async ({ job } = {}) => {
            const stageRecorder = stageRecorderForWorkflow({ jobStatusService, job });
            return runCreateListOfDatesLegacy({
              body,
              matterStore,
              runtimeDbStorageService,
              aiProvider: services.aiProvider,
              env: services.env || {},
              stageRecorder,
            });
          },
        }));
      }),
      exactRoute("POST", "/api/create-listofdates/refresh-labels", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "label_refresh",
          route: "/api/create-listofdates/refresh-labels",
          label: "Refresh Case Timeline Labels",
          matterName: matterNameForBody(matterStore, body),
          operation: async () => {
            if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
              const matter = await runtimeDbMatterForBody(matterStore, body);
              assertRuntimeDbListOfDatesLabelRefreshAvailable({ runtimeDbStorageService });
              const result = await runtimeDbStorageService.refreshListOfDatesSourceLabels(matter, {
                dryRun: Boolean(body.dryRun),
              });
              return runtimeDbWorkflowResponse(result, matter);
            }
            assertFilesystemWorkflowAvailable(matterStore, "Refresh Case Timeline labels");
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
        if (skillRunnerService?.start) {
          sendJson(response, 200, await runMatterStorySkill({
            body,
            matterStore,
            runtimeDbStorageService,
            skillRunnerService,
          }));
          return;
        }
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "custom_skill",
          route: "/api/matter-story",
          label: "The Story",
          matterName: matterNameForBody(matterStore, body),
          operation: async ({ job } = {}) => {
            const stageRecorder = stageRecorderForWorkflow({ jobStatusService, job });
            return runMatterStoryLegacy({
              body,
              matterStore,
              matterStoryService,
              runtimeDbStorageService,
              stageRecorder,
            });
          },
        }));
      }),
      exactRoute("GET", "/api/procedural-posture-diagnosis", async () => {
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          assertRuntimeDbProceduralPostureStatusAvailable({ runtimeDbStorageService });
          sendJson(response, 200, runtimeDbReadResponse(await runtimeDbStorageService.readProceduralPostureDiagnosisStatus(matter), matter));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Read procedural posture diagnosis");
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await proceduralPostureDiagnosisService.readDiagnosisStatus(root));
      }),
      exactRoute("POST", "/api/procedural-posture-diagnosis", async () => {
        const body = await readRequestJson(request);
        if (skillRunnerService?.start) {
          sendJson(response, 200, await runProceduralPostureDiagnosisSkill({
            body,
            matterStore,
            runtimeDbStorageService,
            skillRunnerService,
          }));
          return;
        }
        sendJson(response, 200, await runTrackedWorkflow({
          jobStatusService,
          kind: "posture_diagnosis",
          route: "/api/procedural-posture-diagnosis",
          label: "Diagnose Procedural Posture",
          matterName: matterNameForBody(matterStore, body),
          operation: async ({ job } = {}) => {
            const stageRecorder = stageRecorderForWorkflow({ jobStatusService, job });
            return runProceduralPostureDiagnosisLegacy({
              body,
              matterStore,
              proceduralPostureDiagnosisService,
              runtimeDbStorageService,
              stageRecorder,
            });
          },
        }));
      }),
      exactRoute("POST", "/api/procedural-posture-diagnosis/confirmation", async () => {
        const body = await readRequestJson(request);
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForBody(matterStore, body);
          assertRuntimeDbProceduralPostureConfirmationAvailable({ runtimeDbStorageService });
          const result = await proceduralPostureDiagnosisService.recordConfirmation({
            matterName: matter.name,
            matterRootOverride: `postgres:${matter.name}`,
            decision: body.decision,
            reasonOrCorrection: body.reasonOrCorrection,
            actor: body.actor,
            artifactReader: async (relativePath) => (await runtimeDbStorageService.readFilePreview(relativePath, matter)).content,
            artifactWriter: ({ files }) => runtimeDbStorageService.persistTextArtifacts(matter, files),
          });
          const { artifactPersistence, ...responsePayload } = result;
          sendJson(response, 200, Array.isArray(artifactPersistence) && artifactPersistence.length
            ? { ...responsePayload, dbPersistence: { persisted: artifactPersistence } }
            : responsePayload);
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Confirm procedural posture diagnosis");
        sendJson(response, 200, await proceduralPostureDiagnosisService.recordConfirmation({
          matterName: body.matterName,
          decision: body.decision,
          reasonOrCorrection: body.reasonOrCorrection,
          actor: body.actor,
        }));
      }),
      exactRoute("POST", "/api/doctor/scan", async () => {
        const body = await readRequestJson(request);
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForBody(matterStore, body);
          assertRuntimeDbDoctorScanAvailable({ runtimeDbStorageService });
          sendJson(response, 200, runtimeDbReadResponse(await runtimeDbStorageService.readDoctorScan(matter), matter));
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
            if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
              const matter = await runtimeDbMatterForBody(matterStore, body);
              assertRuntimeDbDoctorFixAvailable({ runtimeDbStorageService });
              const result = await runtimeDbStorageService.fixDoctorIssues(matter, fixIds);
              return runtimeDbWorkflowResponse(result, matter);
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
          const includeDisputeStory = matterStoryService?.hasActiveDisputeStorySkill
            ? await matterStoryService.hasActiveDisputeStorySkill()
            : false;
          sendJson(response, 200, await runtimeDbStorageService.readPrepareMatterPlan(matter, { includeDisputeStory }));
          return;
        }
        const root = await matterRootForQuery(matterStore, requestUrl, { allowMissingActive: true });
        sendJson(response, 200, await prepareMatterService.readPrepareMatterPlan(root));
      }),
      exactRoute("POST", "/api/prepare-matter/run", async () => {
        const body = await readRequestJson(request);
        if (!usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          throw makeRuntimeWorkflowUnavailableError("matter_workflow.preparation_queue_required");
        }
        const matter = await runtimeDbMatterForBody(matterStore, body);
        const includeDisputeStory = matterStoryService?.hasActiveDisputeStorySkill
          ? await matterStoryService.hasActiveDisputeStorySkill()
          : false;
        sendJson(response, 200, await enqueueRuntimeDbNeededPreparation({
          body,
          matter,
          includeDisputeStory,
          runtimeDbStorageService,
          runtimeDbProcessingWorkerService,
        }));
      }),
      exactRoute("GET", "/api/source-removal-impact-preview", async () => {
        const fileId = requestUrl.searchParams.get("fileId") || requestUrl.searchParams.get("file_id") || "";
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          assertRuntimeDbContextReadAvailable({ runtimeDbStorageService });
          const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
          sendJson(response, 200, runtimeDbReadResponse(buildSourceRemovalImpactPreviewFromPacket(packet, { fileId }), matter));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Preview source removal impact");
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await previewSourceRemovalImpact({ matterRoot: root, fileId }));
      }),
      exactRoute("POST", "/api/source-removal/remove-from-active-record", async () => {
        const body = await readRequestJson(request);
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForBody(matterStore, body);
          assertRuntimeDbSourceRemovalAvailable({ runtimeDbSourceRemovalMutationService });
          const result = await runtimeDbSourceRemovalMutationService.removeRuntimeDbSourceFromActiveRecord({
            matterId: matter.id,
            matterName: matter.name,
            fileId: body.fileId || body.file_id,
            reason: body.reason,
            idempotencyKey: body.idempotencyKey || body.idempotency_key,
            actor: sourceRemovalActor(),
          });
          assertSourceRemovalResult(result, body.fileId || body.file_id);
          sendJson(response, 200, runtimeDbReadResponse(result, matter));
          return;
        }
        assertSourceRemovalMutationAvailable({ sourceRemovalMutationService });
        const root = await matterRootForBody(matterStore, body);
        const result = await sourceRemovalMutationService.removeLocalSourceFromActiveRecord({
          matterRoot: root,
          matterName: matterNameForBody(matterStore, body),
          fileId: body.fileId || body.file_id,
          reason: body.reason,
          idempotencyKey: body.idempotencyKey || body.idempotency_key,
          actor: sourceRemovalActor(),
        });
        assertSourceRemovalResult(result, body.fileId || body.file_id);
        sendJson(response, 200, result);
      }),
      exactRoute("GET", "/api/matter-context/search", async () => {
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          assertRuntimeDbContextReadAvailable({ runtimeDbStorageService });
          const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
          const result = searchMatterContextPacket(packet, requestUrl.searchParams.get("q") || "");
          sendJson(response, 200, runtimeDbReadResponse(result, matter));
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
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          assertRuntimeDbContextReadAvailable({ runtimeDbStorageService });
          const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
          sendJson(response, 200, runtimeDbReadResponse(summarizeMatterContextPacket(packet), matter));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Read matter context");
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await matterContextService.readMatterContextPreview(root));
      }),
      exactRoute("POST", "/api/matter-copilot/research", async () => {
        const body = await readRequestJson(request);
        const runtimeMode = usesRuntimeDbStorage(matterStore, runtimeDbStorageService) ? "postgres" : "filesystem";
        let signalMatterName = matterNameForBody(matterStore, body);
        try {
          assertCopilotWebResearchAvailable({ copilotWebResearchService });
          copilotWebResearchService.assertReady?.();
          if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
            const matter = await runtimeDbMatterForBody(matterStore, body);
            signalMatterName = matter?.name || matter?.matterName || signalMatterName;
            assertRuntimeDbResearchContextAvailable({ runtimeDbStorageService, copilotWebResearchService });
            const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
            const answer = await copilotWebResearchService.answerResearchQuestionFromPacket({
              packet,
              question: body.question,
            });
            await appendCopilotReceipt({ copilotInteractionReceiptService, mode: "research", body, answer, matterName: signalMatterName, runtimeMode, route: "/api/matter-copilot/research" });
            await captureResearchRouteSignal({ privateBetaSignalService, answer, matterName: signalMatterName, runtimeMode });
            sendJson(response, 200, runtimeDbReadResponse(answer, matter));
            return;
          }
          assertFilesystemWorkflowAvailable(matterStore, "Research matter");
          const root = await matterRootForBody(matterStore, body);
          const answer = await copilotWebResearchService.answerResearchQuestion({
            root,
            question: body.question,
          });
          await appendCopilotReceipt({ copilotInteractionReceiptService, mode: "research", body, answer, matterName: signalMatterName, runtimeMode, route: "/api/matter-copilot/research" });
          await captureResearchRouteSignal({ privateBetaSignalService, answer, matterName: signalMatterName, runtimeMode });
          sendJson(response, 200, answer);
        } catch (error) {
          await appendCopilotReceipt({ copilotInteractionReceiptService, mode: "research", body, error, matterName: signalMatterName, runtimeMode, route: "/api/matter-copilot/research" });
          await captureResearchRouteFailure({ privateBetaSignalService, error, matterName: signalMatterName, runtimeMode });
          throw error;
        }
      }),
      exactRoute("POST", "/api/matter-copilot/answer", async () => {
        const body = await readRequestJson(request);
        const runtimeMode = usesRuntimeDbStorage(matterStore, runtimeDbStorageService) ? "postgres" : "filesystem";
        let receiptMatterName = matterNameForBody(matterStore, body);
        try {
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForBody(matterStore, body);
          receiptMatterName = matter?.name || matter?.matterName || receiptMatterName;
          assertRuntimeDbCopilotContextAvailable({ runtimeDbStorageService, matterCopilotService });
          const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
          const answer = await matterCopilotService.answerQuestionFromPacket({
            packet,
            question: body.question,
            conversation: body.conversation,
          });
          await appendCopilotReceipt({ copilotInteractionReceiptService, mode: "ask", body, answer, matterName: receiptMatterName, runtimeMode, route: "/api/matter-copilot/answer" });
          sendJson(response, 200, presentMatterCopilotAnswerForCurrentUser(runtimeDbReadResponse(answer, matter)));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Matter copilot");
        const root = await matterRootForBody(matterStore, body);
        const answer = await matterCopilotService.answerQuestion({
          root,
          question: body.question,
          conversation: body.conversation,
        });
        await appendCopilotReceipt({ copilotInteractionReceiptService, mode: "ask", body, answer, matterName: receiptMatterName, runtimeMode, route: "/api/matter-copilot/answer" });
        sendJson(response, 200, presentMatterCopilotAnswerForCurrentUser(answer));
        } catch (error) {
          await appendCopilotReceipt({ copilotInteractionReceiptService, mode: "ask", body, error, matterName: receiptMatterName, runtimeMode, route: "/api/matter-copilot/answer" });
          throw error;
        }
      }),
      exactRoute("GET", "/api/rerun-advice", async () => {
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForQuery(matterStore, requestUrl);
          assertRuntimeDbRerunAdviceAvailable({ runtimeDbStorageService });
          const advice = await runtimeDbStorageService.readRerunAdvice(requestUrl.searchParams.get("skill") || "", matter);
          sendJson(response, 200, runtimeDbReadResponse(advice, matter));
          return;
        }
        assertFilesystemWorkflowAvailable(matterStore, "Read rerun advice");
        const root = await matterRootForQuery(matterStore, requestUrl);
        sendJson(response, 200, await matterStatusService.readRerunAdvice(requestUrl.searchParams.get("skill") || "", root));
      }),
    ],
  });
}

const PREPARE_MATTER_RUN_SCHEMA = "prepare-matter-run/v1";

async function enqueueRuntimeDbNeededPreparation({
  body = {},
  matter = {},
  includeDisputeStory = false,
  runtimeDbStorageService,
  runtimeDbProcessingWorkerService,
} = {}) {
  assertRuntimeDbPreparationQueueAvailable({ runtimeDbStorageService, runtimeDbProcessingWorkerService });
  const mode = normalizePreparationRunMode(body.mode);
  if (mode !== "needed") {
    const error = new Error("Backend preparation queue supports needed preparation only.");
    error.statusCode = 400;
    error.code = "matter_workflow.preparation_queue_needed_only";
    throw error;
  }
  const plan = await runtimeDbStorageService.readPrepareMatterPlan(matter, { includeDisputeStory });
  const stage = firstQueueableRuntimePreparationStage(plan);
  if (!stage) {
    const blockedStage = firstBlockedRuntimePreparationStage(plan);
    return {
      schema_version: PREPARE_MATTER_RUN_SCHEMA,
      state: blockedStage ? "blocked" : "complete",
      matterName: matter.matterName || matter.name || plan?.matterName || "",
      message: blockedStage?.reason || plan?.nextStep?.message || (blockedStage ? "Preparation is blocked." : "Core preparation is current."),
      ...(blockedStage ? { stage: blockedStage } : {}),
      plan,
    };
  }
  const kind = runtimePreparationJobKindForStage(stage);
  if (!kind) {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.preparation_queue_stage_required");
  }
  const supportedKinds = runtimeDbProcessingWorkerService.supportedKinds?.() || [];
  if (!supportedKinds.includes(kind)) {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.preparation_queue_stage_required");
  }
  const existing = await findActiveRuntimePreparationJob({ runtimeDbStorageService, matter, kind });
  if (existing?.id) {
    return {
      schema_version: PREPARE_MATTER_RUN_SCHEMA,
      state: "queued",
      matterName: matter.matterName || matter.name || plan?.matterName || "",
      mode,
      kind,
      stage,
      job: existing,
      alreadyQueued: true,
      plan,
    };
  }
  const chainId = safeRuntimePreparationChainId(body.runId) || `manual-${randomUUID()}`;
  const job = await runtimeDbStorageService.enqueueProcessingJob({
    matter,
    kind,
    idempotencyKey: `manual-prepare:${matter.id}:${chainId}:${kind}`,
    metadata: {
      preparationChain: "manual_needed/v1",
      preparationChainId: chainId,
      stage: kind,
      requestedMode: mode,
      reason: sanitizeWorkflowText(body.reason || "Run needed preparation", 240),
      ...runtimePreparationJobMetadataForStage(stage),
    },
  });
  return {
    schema_version: PREPARE_MATTER_RUN_SCHEMA,
    state: "queued",
    matterName: matter.matterName || matter.name || plan?.matterName || "",
    mode,
    kind,
    stage,
    job,
    alreadyQueued: false,
    plan,
  };
}

function assertRuntimeDbPreparationQueueAvailable({ runtimeDbStorageService, runtimeDbProcessingWorkerService } = {}) {
  if (typeof runtimeDbStorageService?.readPrepareMatterPlan !== "function"
    || typeof runtimeDbStorageService?.enqueueProcessingJob !== "function"
    || typeof runtimeDbStorageService?.listProcessingJobs !== "function"
    || typeof runtimeDbProcessingWorkerService?.enabled !== "function"
    || !runtimeDbProcessingWorkerService.enabled()) {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.preparation_queue_required");
  }
}

function normalizePreparationRunMode(value) {
  return String(value || "needed").trim() === "full" ? "full" : "needed";
}

async function findActiveRuntimePreparationJob({ runtimeDbStorageService, matter = {}, kind = "" } = {}) {
  for (const status of RUNTIME_PREPARATION_ACTIVE_JOB_STATUSES) {
    const result = await runtimeDbStorageService.listProcessingJobs({
      matterName: matter.name || matter.matterName || "",
      kind,
      status,
      limit: 5,
    });
    const job = Array.isArray(result?.jobs) ? result.jobs.find((candidate) => candidate?.kind === kind) : null;
    if (job?.id) return job;
  }
  return null;
}

function assertRuntimeDbMatterInitAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.initializeMatter !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.matter_init_required");
  }
}

function assertRuntimeDbExtractAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.extractDocuments !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.extraction_required");
  }
}

function assertRuntimeDbSourceDescriptorsAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.describeSources !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.source_labels_required");
  }
}

function assertRuntimeDbCreateListOfDatesAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.createListOfDates !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.list_of_dates_required");
  }
}

function assertRuntimeDbListOfDatesLabelRefreshAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.refreshListOfDatesSourceLabels !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.label_refresh_required");
  }
}

function assertRuntimeDbContextReadAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.readMatterContextPacket !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.context_required");
  }
}

function assertRuntimeDbSourceRemovalAvailable({ runtimeDbSourceRemovalMutationService } = {}) {
  if (!runtimeDbSourceRemovalMutationService?.enabled
    || typeof runtimeDbSourceRemovalMutationService?.removeRuntimeDbSourceFromActiveRecord !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.source_removal_required");
  }
}

function assertSourceRemovalMutationAvailable({ sourceRemovalMutationService } = {}) {
  if (typeof sourceRemovalMutationService?.removeLocalSourceFromActiveRecord !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.source_removal_required");
  }
}

function assertRuntimeDbCopilotContextAvailable({ runtimeDbStorageService, matterCopilotService } = {}) {
  if (typeof runtimeDbStorageService?.readMatterContextPacket !== "function"
    || typeof matterCopilotService?.answerQuestionFromPacket !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.context_required");
  }
}

function assertRuntimeDbResearchContextAvailable({ runtimeDbStorageService, copilotWebResearchService } = {}) {
  if (typeof runtimeDbStorageService?.readMatterContextPacket !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.context_required");
  }
  assertCopilotWebResearchAvailable({ copilotWebResearchService });
}

function assertCopilotWebResearchAvailable({ copilotWebResearchService } = {}) {
  if (typeof copilotWebResearchService?.answerResearchQuestionFromPacket !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.context_required");
  }
}

function assertRuntimeDbRerunAdviceAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.readRerunAdvice !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.status_required");
  }
}

function assertRuntimeDbDoctorScanAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.readDoctorScan !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.doctor_scan_required");
  }
}

function assertRuntimeDbDoctorFixAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.fixDoctorIssues !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.doctor_fix_required");
  }
}

function assertRuntimeDbMatterStoryAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.readMatterContextPacket !== "function"
    || typeof runtimeDbStorageService?.readMatterJson !== "function"
    || typeof runtimeDbStorageService?.artifactExists !== "function"
    || typeof runtimeDbStorageService?.persistTextArtifacts !== "function"
    || typeof runtimeDbStorageService?.persistMatterJson !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.context_required");
  }
}

function assertRuntimeDbProceduralPostureStatusAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.readProceduralPostureDiagnosisStatus !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.procedural_posture_required");
  }
}

function assertRuntimeDbProceduralPostureRunAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.readMatterContextPacket !== "function"
    || typeof runtimeDbStorageService?.readMatterJson !== "function"
    || typeof runtimeDbStorageService?.artifactExists !== "function"
    || typeof runtimeDbStorageService?.artifactStat !== "function"
    || typeof runtimeDbStorageService?.readFilePreview !== "function"
    || typeof runtimeDbStorageService?.persistTextArtifacts !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.procedural_posture_required");
  }
}

function assertRuntimeDbProceduralPostureConfirmationAvailable({ runtimeDbStorageService } = {}) {
  if (typeof runtimeDbStorageService?.readFilePreview !== "function"
    || typeof runtimeDbStorageService?.persistTextArtifacts !== "function") {
    throw makeRuntimeWorkflowUnavailableError("matter_workflow.procedural_posture_required");
  }
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

async function runNativeSkillAlias({ slash = "", body = {}, matterStore, runtimeDbStorageService, skillRunnerService } = {}) {
  const normalizedSlash = normalizeNativeSkillAliasSlash(slash);
  if (!skillRunnerService?.start) {
    throw httpError("Native skill runner is not available.", 503, "native_skill.runner_unavailable");
  }
  if (normalizedSlash === "/create_listofdates") {
    return runListOfDatesSkill({ body, matterStore, runtimeDbStorageService, skillRunnerService });
  }
  if (normalizedSlash === "/the_story") {
    return runMatterStorySkill({ body, matterStore, runtimeDbStorageService, skillRunnerService });
  }
  if (normalizedSlash === "/procedural_posture_diagnosis") {
    return runProceduralPostureDiagnosisSkill({ body, matterStore, runtimeDbStorageService, skillRunnerService });
  }
  throw httpError("Native skill is not available.", 404, "native_skill.not_found");
}

function normalizeNativeSkillAliasSlash(value = "") {
  const text = safeDecodeText(value).trim();
  const slash = text.startsWith("/") ? text : `/${text}`;
  return slash.toLowerCase();
}

function safeDecodeText(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}

async function runListOfDatesSkill({
  body = {},
  matterStore,
  runtimeDbStorageService,
  skillRunnerService,
} = {}) {
  const { request } = await listOfDatesRunnerRequest({
    body,
    matterStore,
    runtimeDbStorageService,
  });
  const workflowMetadata = workflowJobMetadata({
    kind: "list_of_dates",
    route: "/api/create-listofdates",
    label: "Build Case Timeline",
  });
  const retryOfJobId = typeof body.retryOfJobId === "string" ? body.retryOfJobId.trim() : "";
  const run = retryOfJobId
    ? await skillRunnerService.retry({
      failedRunId: retryOfJobId,
      retryStageId: typeof body.retryStageId === "string" ? body.retryStageId.trim() : "",
      request,
      mode: "inline",
      metadata: workflowMetadata,
    })
    : await skillRunnerService.start({
      slash: "/create_listofdates",
      request,
      mode: "inline",
      metadata: workflowMetadata,
    });
  if (!run?.accepted) {
    throw httpError(run?.reason || "Case Timeline is not ready to run.", 409, "native_skill.preflight_failed");
  }
  if (run.error) throw run.error;
  return attachJobStatusWithReceipt(run.result, run.job, run.receipt);
}

async function runCreateListOfDatesLegacy({
  body = {},
  matterStore,
  runtimeDbStorageService,
  aiProvider = null,
  env = {},
  stageRecorder = null,
} = {}) {
  if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
    const matter = await runtimeDbMatterForBody(matterStore, body);
    assertRuntimeDbCreateListOfDatesAvailable({ runtimeDbStorageService });
    const modelPolicy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, { env });
    const options = {
      dryRun: Boolean(body.dryRun),
      aiProvider,
      env,
      stageRecorder,
    };
    if (modelPolicy.provider === AI_PROVIDERS.OPENAI_DIRECT) {
      options.apiKey = env.OPENAI_API_KEY;
      options.maxOutputTokens = env.OPENAI_MAX_OUTPUT_TOKENS;
    }
    return runtimeDbWorkflowResponse(
      await runtimeDbStorageService.createListOfDates(matter, options),
      matter,
    );
  }
  assertFilesystemWorkflowAvailable(matterStore, "Build Case Timeline");
  const root = await matterRootForBody(matterStore, body);
  const modelPolicy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, { env });
  const options = {
    matterRoot: root,
    dryRun: Boolean(body.dryRun),
    aiProvider,
    env,
    stageRecorder,
  };
  if (modelPolicy.provider === AI_PROVIDERS.OPENAI_DIRECT) {
    options.apiKey = env.OPENAI_API_KEY;
    options.maxOutputTokens = env.OPENAI_MAX_OUTPUT_TOKENS;
  }
  return runCreateListOfDates(options);
}

async function listOfDatesRunnerRequest({ body = {}, matterStore, runtimeDbStorageService } = {}) {
  if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
    const matter = await runtimeDbMatterForBody(matterStore, body);
    assertRuntimeDbCreateListOfDatesAvailable({ runtimeDbStorageService });
    return {
      runtimeDb: true,
      request: {
        matterName: matter.name,
        dryRun: Boolean(body.dryRun),
        runtimeDbMatter: matter,
        runtimeDbCreateListOfDates: (options) => runtimeDbStorageService.createListOfDates(matter, options),
      },
    };
  }
  assertFilesystemWorkflowAvailable(matterStore, "Build Case Timeline");
  return {
    runtimeDb: false,
    request: {
      matterName: matterNameForBody(matterStore, body),
      matterRoot: await matterRootForBody(matterStore, body),
      dryRun: Boolean(body.dryRun),
    },
  };
}

async function runMatterStorySkill({
  body = {},
  matterStore,
  runtimeDbStorageService,
  skillRunnerService,
} = {}) {
  const { request, runtimeDb } = await matterStoryRunnerRequest({
    body,
    matterStore,
    runtimeDbStorageService,
  });
  const workflowMetadata = workflowJobMetadata({
    kind: "custom_skill",
    route: "/api/matter-story",
    label: "The Story",
  });
  const retryOfJobId = typeof body.retryOfJobId === "string" ? body.retryOfJobId.trim() : "";
  const run = retryOfJobId
    ? await skillRunnerService.retry({
      failedRunId: retryOfJobId,
      retryStageId: typeof body.retryStageId === "string" ? body.retryStageId.trim() : "",
      request,
      mode: "inline",
      metadata: workflowMetadata,
    })
    : await skillRunnerService.start({
      slash: "/the_story",
      request,
      mode: "inline",
      metadata: workflowMetadata,
    });
  if (!run?.accepted) {
    throw httpError(run?.reason || "Matter Story is not ready to run.", 409, "native_skill.preflight_failed");
  }
  if (run.error) throw run.error;
  const result = runtimeDb ? presentRuntimeDbMatterStoryResult(run.result) : run.result;
  return attachJobStatusWithReceipt(result, run.job, run.receipt);
}

async function runMatterStoryLegacy({
  body = {},
  matterStore,
  matterStoryService,
  runtimeDbStorageService,
  stageRecorder = null,
} = {}) {
  const { request, runtimeDb } = await matterStoryRunnerRequest({
    body,
    matterStore,
    runtimeDbStorageService,
  });
  const result = await matterStoryService.runDisputeStory({
    ...request,
    stageRecorder,
  });
  return runtimeDb ? presentRuntimeDbMatterStoryResult(result) : result;
}

async function matterStoryRunnerRequest({ body = {}, matterStore, runtimeDbStorageService } = {}) {
  if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
    const matter = await runtimeDbMatterForBody(matterStore, body);
    assertRuntimeDbMatterStoryAvailable({ runtimeDbStorageService });
    const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
    const matterJson = await runtimeDbStorageService.readMatterJson(matter);
    return {
      runtimeDb: true,
      request: {
        matterName: matter.name,
        overwrite: Boolean(body.overwrite),
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
      },
    };
  }
  assertFilesystemWorkflowAvailable(matterStore, "Write dispute story");
  return {
    runtimeDb: false,
    request: {
      matterName: matterNameForBody(matterStore, body),
      overwrite: Boolean(body.overwrite),
    },
  };
}

function presentRuntimeDbMatterStoryResult(result = {}) {
  const { artifactPersistence, matterJsonPersistence, ...responsePayload } = result || {};
  const persisted = [
    ...(Array.isArray(artifactPersistence) ? artifactPersistence : []),
    ...(Array.isArray(matterJsonPersistence) ? matterJsonPersistence : []),
  ];
  return persisted.length
    ? { ...responsePayload, dbPersistence: { persisted } }
    : responsePayload;
}

async function runProceduralPostureDiagnosisSkill({
  body = {},
  matterStore,
  runtimeDbStorageService,
  skillRunnerService,
} = {}) {
  const { request, runtimeDb } = await proceduralPostureDiagnosisRunnerRequest({
    body,
    matterStore,
    runtimeDbStorageService,
  });
  const workflowMetadata = workflowJobMetadata({
    kind: "posture_diagnosis",
    route: "/api/procedural-posture-diagnosis",
    label: "Diagnose Procedural Posture",
  });
  const retryOfJobId = typeof body.retryOfJobId === "string" ? body.retryOfJobId.trim() : "";
  const run = retryOfJobId
    ? await skillRunnerService.retry({
      failedRunId: retryOfJobId,
      retryStageId: typeof body.retryStageId === "string" ? body.retryStageId.trim() : "",
      request,
      mode: "inline",
      metadata: workflowMetadata,
    })
    : await skillRunnerService.start({
      slash: "/procedural_posture_diagnosis",
      request,
      mode: "inline",
      metadata: workflowMetadata,
    });
  if (!run?.accepted) {
    throw httpError(run?.reason || "Procedural posture diagnosis is not ready to run.", 409, "native_skill.preflight_failed");
  }
  if (run.error) throw run.error;
  const result = runtimeDb ? presentRuntimeDbPostureDiagnosisResult(run.result) : run.result;
  return attachJobStatusWithReceipt(result, run.job, run.receipt);
}

async function runProceduralPostureDiagnosisLegacy({
  body = {},
  matterStore,
  proceduralPostureDiagnosisService,
  runtimeDbStorageService,
  stageRecorder = null,
} = {}) {
  const { request, runtimeDb } = await proceduralPostureDiagnosisRunnerRequest({
    body,
    matterStore,
    runtimeDbStorageService,
  });
  const result = await proceduralPostureDiagnosisService.runDiagnosis({
    ...request,
    stageRecorder,
  });
  return runtimeDb ? presentRuntimeDbPostureDiagnosisResult(result) : result;
}

async function proceduralPostureDiagnosisRunnerRequest({ body = {}, matterStore, runtimeDbStorageService } = {}) {
  if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
    const matter = await runtimeDbMatterForBody(matterStore, body);
    assertRuntimeDbProceduralPostureRunAvailable({ runtimeDbStorageService });
    const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
    const matterJson = await runtimeDbStorageService.readMatterJson(matter);
    return {
      runtimeDb: true,
      request: {
        matterName: matter.name,
        overwrite: Boolean(body.overwrite),
        matterRootOverride: `postgres:${matter.name}`,
        matterRecordOverride: matter,
        matterContextPacketOverride: packet,
        matterJsonOverride: matterJson,
        artifactExistsOverride: (relativePath) => runtimeDbStorageService.artifactExists(matter, relativePath),
        artifactReader: async (relativePath) => (await runtimeDbStorageService.readFilePreview(relativePath, matter)).content,
        artifactStatReader: (relativePath) => runtimeDbStorageService.artifactStat(matter, relativePath),
        artifactWriter: ({ files }) => runtimeDbStorageService.persistTextArtifacts(matter, files),
      },
    };
  }
  assertFilesystemWorkflowAvailable(matterStore, "Diagnose procedural posture");
  return {
    runtimeDb: false,
    request: {
      matterName: matterNameForBody(matterStore, body),
      overwrite: Boolean(body.overwrite),
    },
  };
}

function presentRuntimeDbPostureDiagnosisResult(result = {}) {
  const { artifactPersistence, ...responsePayload } = result || {};
  return Array.isArray(artifactPersistence) && artifactPersistence.length
    ? { ...responsePayload, dbPersistence: { persisted: artifactPersistence } }
    : responsePayload;
}

function attachJobStatusWithReceipt(result, job, receipt) {
  const payload = attachJobStatus(result, job);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return { ...payload, receipt };
  return { result, job, receipt };
}

function httpError(message, statusCode = 500, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function stageRecorderForWorkflow({ jobStatusService, job } = {}) {
  if (!job?.id || !jobStatusService?.updateJobStage) return null;
  const stages = createSkillStageService({ jobStatusService });
  return {
    startStage: (stage) => stages.startStage(job.id, stage),
    succeedStage: (stage) => stages.succeedStage(job.id, stage),
    failStage: (stage, error) => stages.failStage(job.id, stage, error),
    skipStage: (stage) => stages.skipStage(job.id, stage),
  };
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
  const stageService = jobStatusService?.updateJobStage ? createSkillStageService({ jobStatusService }) : null;
  let labelStageStarted = false;
  let labelStageFinished = false;
  let completedBatchCount = 0;
  let successfulBatchCount = 0;
  return async (event = {}) => {
    if (event.stage === "source-labels-batch-complete") {
      completedBatchCount += 1;
      const descriptors = Number.isInteger(event.descriptors) ? event.descriptors : 0;
      const batchStatus = typeof event.batchStatus === "string" ? event.batchStatus.trim() : "";
      if (batchStatus ? batchStatus !== "failed" : (descriptors > 0 || event.needsReview !== true)) {
        successfulBatchCount += 1;
      }
    }
    const summary = sourceLabelProgressSummary(event);
    const metadata = { sourceLabelProgress: event };
    await recordSourceLabelStageProgress({
      jobStatusService,
      job,
      stageService,
      event,
      summary,
      metadata,
      canFinishSuccessfully: () => completedBatchCount > 0 && successfulBatchCount > 0,
      isStarted: () => labelStageStarted,
      markStarted: () => { labelStageStarted = true; },
      isFinished: () => labelStageFinished,
      markFinished: () => { labelStageFinished = true; },
    });
    await jobStatusService.updateJob(job.id, { summary, metadata });
  };
}

async function recordSourceLabelStageProgress({
  jobStatusService,
  job,
  stageService,
  event = {},
  summary = "",
  metadata = {},
  canFinishSuccessfully,
  isStarted,
  markStarted,
  isFinished,
  markFinished,
} = {}) {
  if (!stageService || !jobStatusService?.updateJobStage || !job?.id || isFinished?.()) return;
  const stage = {
    id: "label_pass",
    label: "Describe source labels",
    metadata,
  };
  if (!isStarted?.()) {
    await stageService.startStage(job.id, stage);
    markStarted?.();
  }
  if (event.stage === "source-labels-batch-complete" && event.batchIndex === event.batchCount && canFinishSuccessfully?.()) {
    await stageService.succeedStage(job.id, { ...stage, summary, salvageable: true });
    markFinished?.();
    return;
  }
  await jobStatusService.updateJobStage(job.id, {
    ...stage,
    status: "running",
    summary,
  });
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

function sourceRemovalActor() {
  const user = currentRequestContext().user || {};
  return {
    username: user.username || "",
    displayName: user.displayName || user.username || "",
    role: user.role || "",
  };
}

function assertSourceRemovalResult(result = {}, fileId = "") {
  if (result?.state !== "source_not_found") return;
  const error = new Error(`${fileId || "Source"} is not present in the active source record.`);
  error.statusCode = 404;
  error.code = "source_removal.source_not_found";
  throw error;
}

function runtimeDbReadResponse(result, matter = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  return {
    ...result,
    matterRoot: result.matterRoot || matter.matterPath || `postgres:${matter.name || ""}`,
    matterName: result.matterName || matter.matterName || matter.name || "",
  };
}

async function appendCopilotReceipt({ copilotInteractionReceiptService, mode, body = {}, answer = null, error = null, matterName = "", runtimeMode = "", route = "" } = {}) {
  if (typeof copilotInteractionReceiptService?.appendReceipt !== "function") return;
  try {
    await copilotInteractionReceiptService.appendReceipt(buildCopilotInteractionReceipt({
      mode,
      matterName,
      question: body.question,
      answer,
      error,
      runtimeMode,
      route,
      conversationTurns: Array.isArray(body.conversation) ? body.conversation.length : 0,
    }));
  } catch {
    // Receipt capture is improvement telemetry; it must never break user routes.
  }
}

async function captureResearchRouteSignal({ privateBetaSignalService, answer = {}, matterName = "", runtimeMode = "" } = {}) {
  await safeCaptureBetaSignal(() => privateBetaSignalService?.captureClientEvent({
    code: "copilot_research.answer_returned",
    category: "copilot_research",
    severity: answer.answer_status === "answered" ? "info" : "warning",
    view: "api",
    action: "research",
    stage: "research_answer",
    matterName,
    fileCount: Array.isArray(answer.public_sources) ? answer.public_sources.length : 0,
    errorMessage: answer.answer_status ? `Research answer status: ${answer.answer_status}` : "Research answer returned.",
  }, { runtimeMode }));
}

async function captureResearchRouteFailure({ privateBetaSignalService, error, matterName = "", runtimeMode = "" } = {}) {
  await safeCaptureBetaSignal(() => privateBetaSignalService?.captureClientEvent({
    code: researchSignalCode(error),
    category: "copilot_research",
    severity: "error",
    view: "api",
    action: "research",
    stage: "research_failed",
    matterName,
    errorClass: "Error",
    errorMessage: "Copilot Research failed before returning a usable answer.",
  }, { runtimeMode }));
}

function researchSignalCode(error) {
  const code = typeof error?.code === "string" ? error.code.trim() : "";
  return /^copilot_research\.[a-z0-9_]+$/.test(code) ? code : "copilot_research.failed";
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

function makeRuntimeWorkflowUnavailableError(code = "matter_workflow.context_required") {
  const error = new Error("Matter context is not available for this workflow. Ask the operator to check the workspace setup.");
  error.statusCode = 409;
  error.code = code;
  return error;
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

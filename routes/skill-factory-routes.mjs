import { readRequestJson, sendJson } from "./http-utils.mjs";
import { readMatterSummary } from "./active-matter-summary.mjs";
import { dispatchRoutes, exactRoute, patternRoute } from "./route-dispatcher.mjs";
import {
  filterByVisibleMatterNames,
  isPrivateBetaScopedUser,
  safeCaptureBetaSignal,
  usesRuntimeDbStorage,
  visibleMatterNameSet,
} from "./route-utils.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import {
  buildSkillCreationOverlapRequest,
  isBlockingSkillOverlapDecision,
  isSkillImprovementIdea,
} from "../shared/skill-creation-overlap-policy.mjs";

export async function handleSkillFactoryApiRequest({ request, requestUrl, response, services }) {
  const {
    configurableSkillRunsService,
    configurableSkillsService,
    jobStatusService,
    matterStore,
    runtimeDbStorageService,
    privateBetaSignalService,
    skillFactoryHealthService,
    skillIdeasService,
    skillInterviewPlannerService,
    skillRegistryService,
    skillRouterService,
    skillSamplesService,
    skillSampleOutputService,
  } = services;

  return dispatchRoutes({
    request,
    requestUrl,
    response,
    routes: [
      exactRoute("GET", "/api/skills", async () => {
        sendJson(response, 200, await skillRegistryService.readRegistry());
      }),
      exactRoute("POST", "/api/skills/check-intent", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await skillRouterService.checkIntent({
          userRequest: body.userRequest,
          overrideJustification: body.overrideJustification,
        }));
      }),
      exactRoute("GET", "/api/skill-ideas", async () => {
        sendJson(response, 200, await skillIdeasService.listIdeas());
      }),
      exactRoute("POST", "/api/skill-ideas", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await skillIdeasService.createIdea({
          text: body.text,
          designBrief: body.designBrief || {},
          matter: await readMatterSummary(matterStore, { matterName: body.matterName }),
        }));
      }),
      exactRoute("GET", "/api/skill-factory-health", async () => {
        const health = await skillFactoryHealthService.checkHealth();
        await safeCaptureBetaSignal(() => privateBetaSignalService?.captureSkillFactoryHealth(health, {
          runtimeMode: usesRuntimeDbStorage(matterStore, runtimeDbStorageService) ? "postgres" : "filesystem",
        }));
        sendJson(response, 200, health);
      }),
      exactRoute("POST", "/api/skill-ideas/plan-interview", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await skillInterviewPlannerService.planInterview({
          skillIdea: body.skillIdea || {},
          userRequest: body.userRequest,
          designBrief: body.designBrief || {},
          matterName: body.matterName,
        }));
      }),
      exactRoute("POST", "/api/skill-ideas/sample-output", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedSkillSampleOutput({
          jobStatusService,
          matterName: matterNameForSampleJob(matterStore, body),
          operation: async () => {
            const sample = hasRuntimeDbSampleOutputPath(matterStore, runtimeDbStorageService, skillSampleOutputService)
              ? await generateRuntimeDbSampleOutput({
                matterStore,
                runtimeDbStorageService,
                skillSampleOutputService,
                body,
              })
              : await skillSampleOutputService.generateSampleOutput({
                idea: body.idea || {},
                feedback: body.feedback || "",
                previousSample: body.previousSample || "",
              });
            const stored = await skillSamplesService.recordSample({
              idea: body.idea || sample.idea || {},
              sample,
            });
            return {
              ...sample,
              sample_id: stored.sample.id,
              storedSample: stored.sample,
            };
          },
        }));
      }),
      patternRoute("GET", /^\/api\/skill-ideas\/([^/]+)\/samples$/, async ({ params }) => {
        const idea = await skillIdeasService.getIdea(decodeURIComponent(params[0]));
        sendJson(response, 200, await skillSamplesService.listSamplesForIdea({
          ideaId: idea.id,
          designBrief: idea.designBrief,
        }));
      }),
      patternRoute("POST", /^\/api\/skill-ideas\/([^/]+)\/design-brief$/, async ({ params }) => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await skillIdeasService.updateIdeaDesignBrief(
          decodeURIComponent(params[0]),
          body.designBrief || {},
        ));
      }),
      patternRoute("POST", /^\/api\/skill-ideas\/([^/]+)\/samples\/([^/]+)\/approve$/, async ({ params }) => {
        const idea = await skillIdeasService.getIdea(decodeURIComponent(params[0]));
        sendJson(response, 200, await skillSamplesService.approveSample({
          ideaId: idea.id,
          sampleId: decodeURIComponent(params[1]),
          designBrief: idea.designBrief,
        }));
      }),
      patternRoute("POST", /^\/api\/skill-ideas\/([^/]+)\/create-skill$/, async ({ params }) => {
        const body = await readRequestJson(request);
        const ideaId = decodeURIComponent(params[0]);
        const idea = await skillIdeasService.getIdea(ideaId);
        await assertSkillCreationOverlapCleared({
          idea,
          skillRouterService,
          overrideJustification: body.overlapOverrideJustification,
        });
        if (hasRuntimeDbSkillCreationPath(matterStore, runtimeDbStorageService)) {
          sendJson(response, 200, await createRuntimeDbSkillFromApprovedSample({
            configurableSkillsService,
            matterStore,
            runtimeDbStorageService,
            idea,
            ideaId,
          }));
          return;
        }
        sendJson(response, 200, await configurableSkillsService.createSkillFromApprovedSample({ ideaId }));
      }),
      patternRoute("POST", /^\/api\/skill-ideas\/([^/]+)\/status$/, async ({ params }) => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await skillIdeasService.updateIdeaStatus(
          decodeURIComponent(params[0]),
          body.status,
        ));
      }),
      exactRoute("GET", "/api/configurable-skills", async () => {
        sendJson(response, 200, await configurableSkillsService.listSkills());
      }),
      patternRoute("POST", /^\/api\/configurable-skills\/([^/]+)\/lifecycle$/, async ({ params }) => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await configurableSkillsService.updateSkillLifecycle({
          skillId: decodeURIComponent(params[0]),
          action: body.action,
          reason: body.reason,
        }));
      }),
      exactRoute("GET", "/api/configurable-skills/runs", async () => {
        sendJson(response, 200, await scopedSkillRuns({
          matterStore,
          runs: await configurableSkillRunsService.listRuns({
            slash: requestUrl.searchParams.get("slash") || "",
            skillId: requestUrl.searchParams.get("skillId") || "",
            matterFolder: requestUrl.searchParams.get("matterFolder") || "",
            limit: requestUrl.searchParams.get("limit") || undefined,
          }),
        }));
      }),
      exactRoute("POST", "/api/configurable-skills/run", async () => {
        const body = await readRequestJson(request);
        sendJson(response, 200, await runTrackedSkill({
          jobStatusService,
          label: body.slash || "Custom skill",
          matterName: matterNameForSkillRun(matterStore, body.matterName),
          operation: async () => {
            if (hasRuntimeDbWritePath(matterStore, runtimeDbStorageService)) {
              const matter = await runtimeDbMatterForBody(matterStore, body.matterName);
              const result = await runtimeDbStorageService.runMaterializedMatterWrite(matter, ({ matterRoot }) => configurableSkillsService.runSkill({
                slash: body.slash,
                overwrite: Boolean(body.overwrite),
                matterName: matter.name,
                matterRootOverride: matterRoot,
                matterRecordOverride: matter,
              }));
              return result.operationResult;
            }
            return configurableSkillsService.runSkill({
              slash: body.slash,
              overwrite: Boolean(body.overwrite),
              matterName: body.matterName,
            });
          },
        }));
      }),
      exactRoute("POST", "/api/configurable-skills/runs/cancelled", async () => {
        const body = await readRequestJson(request);
        if (usesRuntimeDbStorage(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForBody(matterStore, body.matterName);
          sendJson(response, 200, await configurableSkillsService.recordCancelledRun({
            slash: body.slash,
            artifactPath: body.artifactPath,
            matterName: matter.name,
            matterRootOverride: `postgres:${matter.name}`,
            matterRecordOverride: matter,
          }));
          return;
        }
        sendJson(response, 200, await configurableSkillsService.recordCancelledRun({
          slash: body.slash,
          artifactPath: body.artifactPath,
          matterName: body.matterName,
        }));
      }),
    ],
  });
}

async function scopedSkillRuns({ matterStore, runs }) {
  if (!isPrivateBetaScopedUser()) return runs;
  const visibleNames = await visibleMatterNameSet(matterStore);
  return {
    ...runs,
    runs: filterByVisibleMatterNames(runs?.runs, visibleNames, {
      fields: ["matterName", "matterFolder"],
    }),
  };
}

function hasRuntimeDbWritePath(matterStore, runtimeDbStorageService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && typeof runtimeDbStorageService.runMaterializedMatterWrite === "function";
}

function hasRuntimeDbReadPath(matterStore, runtimeDbStorageService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && typeof runtimeDbStorageService.runMaterializedMatterRead === "function";
}

function hasRuntimeDbSampleOutputPath(matterStore, runtimeDbStorageService, skillSampleOutputService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && (
      typeof runtimeDbStorageService.runMaterializedMatterRead === "function"
      || (typeof runtimeDbStorageService.readMatterContextPacket === "function"
        && typeof skillSampleOutputService.generateSampleOutputFromPacket === "function")
    );
}

function hasRuntimeDbSkillCreationPath(matterStore, runtimeDbStorageService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && (
      typeof runtimeDbStorageService.runMaterializedMatterRead === "function"
      || typeof runtimeDbStorageService.readMatterContextPacket === "function"
    );
}

async function generateRuntimeDbSampleOutput({
  matterStore,
  runtimeDbStorageService,
  skillSampleOutputService,
  body = {},
}) {
  const idea = body.idea || {};
  const matter = await runtimeDbMatterForBody(matterStore, matterNameForSampleOutput(body));
  if (typeof runtimeDbStorageService.readMatterContextPacket === "function"
    && typeof skillSampleOutputService.generateSampleOutputFromPacket === "function") {
    const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
    return skillSampleOutputService.generateSampleOutputFromPacket({
      idea,
      feedback: body.feedback || "",
      previousSample: body.previousSample || "",
      packet,
    });
  }
  return runtimeDbStorageService.runMaterializedMatterRead(matter, ({ matterRoot }) => skillSampleOutputService.generateSampleOutput({
    idea,
    feedback: body.feedback || "",
    previousSample: body.previousSample || "",
    matterRootOverride: matterRoot,
  }));
}

async function createRuntimeDbSkillFromApprovedSample({
  configurableSkillsService,
  matterStore,
  runtimeDbStorageService,
  idea = {},
  ideaId = "",
}) {
  const matter = await runtimeDbMatterForBody(matterStore, matterNameForIdea(idea));
  if (typeof runtimeDbStorageService.readMatterContextPacket === "function") {
    const packet = await runtimeDbStorageService.readMatterContextPacket(matter);
    return configurableSkillsService.createSkillFromApprovedSample({
      ideaId,
      matterRootOverride: `postgres:${matter.name}`,
      matterRecordOverride: matter,
      matterContextPacketOverride: packet,
    });
  }
  return runtimeDbStorageService.runMaterializedMatterRead(matter, ({ matterRoot }) => configurableSkillsService.createSkillFromApprovedSample({
    ideaId,
    matterRootOverride: matterRoot,
    matterRecordOverride: matter,
  }));
}

function matterNameForSampleOutput(body = {}) {
  const direct = typeof body.matterName === "string" ? body.matterName.trim() : "";
  if (direct) return direct;
  const ideaMatter = body.idea?.matter && typeof body.idea.matter === "object" ? body.idea.matter : {};
  return String(ideaMatter.folderName || ideaMatter.matterName || "").trim();
}

function matterNameForIdea(idea = {}) {
  const ideaMatter = idea?.matter && typeof idea.matter === "object" ? idea.matter : {};
  return String(ideaMatter.folderName || ideaMatter.matterName || "").trim();
}

function matterNameForSampleJob(matterStore, body = {}) {
  return matterNameForSampleOutput(body) || matterStore.activeMatterNameWithinHome?.() || "";
}

async function runtimeDbMatterForBody(matterStore, matterName = "") {
  const target = matterName || matterStore.activeMatterNameWithinHome?.();
  if (!target) {
    throw makeHttpError(
      "No matter is active — pick one before running a custom skill.",
      409,
      "skill_factory.matter_required",
    );
  }
  return matterStore.resolveExistingMatter(target);
}

async function runTrackedSkill({
  jobStatusService,
  label,
  matterName,
  operation,
}) {
  if (!jobStatusService?.runTrackedJob) return operation();
  const { result, job } = await jobStatusService.runTrackedJob({
    kind: "custom_skill",
    label,
    matterName,
    operation,
  });
  if (result && typeof result === "object" && !Array.isArray(result)) return { ...result, job };
  return { result, job };
}

async function runTrackedSkillSampleOutput({
  jobStatusService,
  matterName,
  operation,
}) {
  if (!jobStatusService?.runTrackedJob) return operation();
  const { result } = await jobStatusService.runTrackedJob({
    kind: "skill_sample_output",
    label: "Generate skill sample",
    matterName,
    operation,
  });
  return result;
}

function matterNameForSkillRun(matterStore, matterName = "") {
  const target = typeof matterName === "string" ? matterName.trim() : "";
  return target || matterStore.activeMatterNameWithinHome?.() || "";
}

async function assertSkillCreationOverlapCleared({ idea, skillRouterService, overrideJustification = "" } = {}) {
  if (isSkillImprovementIdea({ idea })) return;
  const userRequest = buildSkillCreationOverlapRequest({ idea });
  if (!userRequest) return;
  const decision = await skillRouterService.checkIntent({
    userRequest,
    overrideJustification,
  });
  if (!isBlockingSkillOverlapDecision(decision, { overrideJustification })) return;
  const matched = decision.matched_skill ? ` ${decision.matched_skill}` : "";
  throw makeHttpError(
    `This may already be covered${matched ? ` by${matched}` : ""}. Choose the existing skill, improve it, park the idea, or explain why this should be a separate custom skill.`,
    409,
    "skill_factory.overlap_not_cleared",
  );
}

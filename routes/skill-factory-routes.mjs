import { readRequestJson, sendJson } from "./http-utils.mjs";
import { readMatterSummary } from "./active-matter-summary.mjs";
import { dispatchRoutes, exactRoute, patternRoute } from "./route-dispatcher.mjs";
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
    matterStore,
    runtimeDbStorageService,
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
        sendJson(response, 200, await skillFactoryHealthService.checkHealth());
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
        const sample = await skillSampleOutputService.generateSampleOutput({
          idea: body.idea || {},
          feedback: body.feedback || "",
          previousSample: body.previousSample || "",
        });
        const stored = await skillSamplesService.recordSample({
          idea: body.idea || sample.idea || {},
          sample,
        });
        sendJson(response, 200, {
          ...sample,
          sample_id: stored.sample.id,
          storedSample: stored.sample,
        });
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
        sendJson(response, 200, await configurableSkillsService.createSkillFromApprovedSample({
          ideaId,
        }));
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
        sendJson(response, 200, await configurableSkillRunsService.listRuns({
          slash: requestUrl.searchParams.get("slash") || "",
          skillId: requestUrl.searchParams.get("skillId") || "",
          matterFolder: requestUrl.searchParams.get("matterFolder") || "",
          limit: requestUrl.searchParams.get("limit") || undefined,
        }));
      }),
      exactRoute("POST", "/api/configurable-skills/run", async () => {
        const body = await readRequestJson(request);
        if (hasRuntimeDbWritePath(matterStore, runtimeDbStorageService)) {
          const matter = await runtimeDbMatterForBody(matterStore, body.matterName);
          const result = await runtimeDbStorageService.runMaterializedMatterWrite(matter, ({ matterRoot }) => configurableSkillsService.runSkill({
            slash: body.slash,
            overwrite: Boolean(body.overwrite),
            matterName: matter.name,
            matterRootOverride: matterRoot,
            matterRecordOverride: matter,
          }));
          sendJson(response, 200, result.operationResult);
          return;
        }
        sendJson(response, 200, await configurableSkillsService.runSkill({
          slash: body.slash,
          overwrite: Boolean(body.overwrite),
          matterName: body.matterName,
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

function usesRuntimeDbStorage(matterStore, runtimeDbStorageService) {
  return Boolean(matterStore.hasRuntimeDbStorageMode?.() && runtimeDbStorageService?.enabled);
}

function hasRuntimeDbWritePath(matterStore, runtimeDbStorageService) {
  return usesRuntimeDbStorage(matterStore, runtimeDbStorageService)
    && typeof runtimeDbStorageService.runMaterializedMatterWrite === "function";
}

async function runtimeDbMatterForBody(matterStore, matterName = "") {
  const target = matterName || matterStore.activeMatterNameWithinHome?.();
  if (!target) throw makeHttpError("No matter is active — pick one before running a custom skill.", 409);
  return matterStore.resolveExistingMatter(target);
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
  );
}

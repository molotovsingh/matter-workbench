import { readRequestJson, sendJson } from "./http-utils.mjs";
import { readActiveMatterSummary } from "./active-matter-summary.mjs";
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
    skillFactoryHealthService,
    skillIdeasService,
    skillInterviewPlannerService,
    skillRegistryService,
    skillRouterService,
    skillSamplesService,
    skillSampleOutputService,
  } = services;

  if (request.method === "GET" && requestUrl.pathname === "/api/skills") {
    sendJson(response, 200, await skillRegistryService.readRegistry());
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/skills/check-intent") {
    const body = await readRequestJson(request);
    sendJson(response, 200, await skillRouterService.checkIntent({
      userRequest: body.userRequest,
      overrideJustification: body.overrideJustification,
    }));
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/skill-ideas") {
    sendJson(response, 200, await skillIdeasService.listIdeas());
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/skill-ideas") {
    const body = await readRequestJson(request);
    sendJson(response, 200, await skillIdeasService.createIdea({
      text: body.text,
      designBrief: body.designBrief || {},
      matter: await readActiveMatterSummary(matterStore),
    }));
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/skill-factory-health") {
    sendJson(response, 200, await skillFactoryHealthService.checkHealth());
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/skill-ideas/plan-interview") {
    const body = await readRequestJson(request);
    sendJson(response, 200, await skillInterviewPlannerService.planInterview({
      skillIdea: body.skillIdea || {},
      userRequest: body.userRequest,
      designBrief: body.designBrief || {},
    }));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/skill-ideas/sample-output") {
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
    return true;
  }

  const skillIdeaSamplesMatch = requestUrl.pathname.match(/^\/api\/skill-ideas\/([^/]+)\/samples$/);
  if (request.method === "GET" && skillIdeaSamplesMatch) {
    const idea = await skillIdeasService.getIdea(decodeURIComponent(skillIdeaSamplesMatch[1]));
    sendJson(response, 200, await skillSamplesService.listSamplesForIdea({
      ideaId: idea.id,
      designBrief: idea.designBrief,
    }));
    return true;
  }

  const skillIdeaDesignBriefMatch = requestUrl.pathname.match(/^\/api\/skill-ideas\/([^/]+)\/design-brief$/);
  if (request.method === "POST" && skillIdeaDesignBriefMatch) {
    const body = await readRequestJson(request);
    sendJson(response, 200, await skillIdeasService.updateIdeaDesignBrief(
      decodeURIComponent(skillIdeaDesignBriefMatch[1]),
      body.designBrief || {},
    ));
    return true;
  }

  const skillIdeaSampleApproveMatch = requestUrl.pathname.match(/^\/api\/skill-ideas\/([^/]+)\/samples\/([^/]+)\/approve$/);
  if (request.method === "POST" && skillIdeaSampleApproveMatch) {
    const idea = await skillIdeasService.getIdea(decodeURIComponent(skillIdeaSampleApproveMatch[1]));
    sendJson(response, 200, await skillSamplesService.approveSample({
      ideaId: idea.id,
      sampleId: decodeURIComponent(skillIdeaSampleApproveMatch[2]),
      designBrief: idea.designBrief,
    }));
    return true;
  }

  const skillIdeaCreateSkillMatch = requestUrl.pathname.match(/^\/api\/skill-ideas\/([^/]+)\/create-skill$/);
  if (request.method === "POST" && skillIdeaCreateSkillMatch) {
    const body = await readRequestJson(request);
    const ideaId = decodeURIComponent(skillIdeaCreateSkillMatch[1]);
    const idea = await skillIdeasService.getIdea(ideaId);
    await assertSkillCreationOverlapCleared({
      idea,
      skillRouterService,
      overrideJustification: body.overlapOverrideJustification,
    });
    sendJson(response, 200, await configurableSkillsService.createSkillFromApprovedSample({
      ideaId,
    }));
    return true;
  }

  const skillIdeaStatusMatch = requestUrl.pathname.match(/^\/api\/skill-ideas\/([^/]+)\/status$/);
  if (request.method === "POST" && skillIdeaStatusMatch) {
    const body = await readRequestJson(request);
    sendJson(response, 200, await skillIdeasService.updateIdeaStatus(
      decodeURIComponent(skillIdeaStatusMatch[1]),
      body.status,
    ));
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/configurable-skills") {
    sendJson(response, 200, await configurableSkillsService.listSkills());
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/configurable-skills/runs") {
    sendJson(response, 200, await configurableSkillRunsService.listRuns({
      slash: requestUrl.searchParams.get("slash") || "",
      skillId: requestUrl.searchParams.get("skillId") || "",
      matterFolder: requestUrl.searchParams.get("matterFolder") || "",
      limit: requestUrl.searchParams.get("limit") || undefined,
    }));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/configurable-skills/run") {
    const body = await readRequestJson(request);
    sendJson(response, 200, await configurableSkillsService.runSkill({
      slash: body.slash,
      overwrite: Boolean(body.overwrite),
    }));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/configurable-skills/runs/cancelled") {
    const body = await readRequestJson(request);
    sendJson(response, 200, await configurableSkillsService.recordCancelledRun({
      slash: body.slash,
      artifactPath: body.artifactPath,
    }));
    return true;
  }

  return false;
}

async function assertSkillCreationOverlapCleared({ idea, skillRouterService, overrideJustification = "" } = {}) {
  if (isSkillImprovementIdea({ idea })) return;
  const userRequest = buildSkillCreationOverlapRequest({ idea });
  if (!userRequest) return;
  const decision = await skillRouterService.checkIntent({
    userRequest,
    overrideJustification,
  });
  if (!isBlockingSkillOverlapDecision(decision)) return;
  const matched = decision.matched_skill ? ` ${decision.matched_skill}` : "";
  throw makeHttpError(
    `Existing skill may already cover this request${matched ? `:${matched}` : ""}. Justify why this is a distinct new skill before creating it.`,
    409,
  );
}

import { AI_TASKS } from "../shared/model-policy.mjs";
import {
  SKILL_IDEA_DESIGN_BRIEF_FIELDS,
  SKILL_IDEA_PAID_POSTURE_VALUES,
  SKILL_IDEA_RISK_LEVEL_VALUES,
  SKILL_IDEA_TARGET_LANE_VALUES,
  sanitizeSkillIdeaDesignBrief,
} from "../shared/skill-idea-design-brief.mjs";
import { createAiProviderService } from "./ai-provider-service.mjs";
import {
  SKILL_INTERVIEW_SYSTEM_PROMPT,
  plannerUserPayload,
} from "./skill-interview-planner-providers.mjs";

export {
  createOpenAiSkillInterviewPlannerProvider,
  createOpenRouterSkillInterviewPlannerProvider,
} from "./skill-interview-planner-providers.mjs";

export const SKILL_INTERVIEW_PLAN_SCHEMA_VERSION = "skill-interview-plan/v1";

export const SKILL_INTERVIEW_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "mode",
    "target_skill",
    "understood_summary",
    "inferred_design_brief",
    "default_assumptions",
    "questions",
    "open_questions",
    "risk_flags",
  ],
  properties: {
    mode: {
      type: "string",
      enum: ["new_skill", "adjacent_improvement", "modification_candidate"],
    },
    target_skill: { type: "string" },
    understood_summary: { type: "string" },
    inferred_design_brief: {
      type: "object",
      additionalProperties: false,
      required: SKILL_IDEA_DESIGN_BRIEF_FIELDS,
      properties: {
        intendedUser: { type: "string" },
        problem: { type: "string" },
        expectedInputs: { type: "string" },
        expectedOutputArtifact: { type: "string" },
        targetLane: {
          type: "string",
          enum: SKILL_IDEA_TARGET_LANE_VALUES,
        },
        paidPosture: {
          type: "string",
          enum: SKILL_IDEA_PAID_POSTURE_VALUES,
        },
        riskLevel: {
          type: "string",
          enum: SKILL_IDEA_RISK_LEVEL_VALUES,
        },
        notes: { type: "string" },
      },
    },
    default_assumptions: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
    },
    questions: {
      type: "array",
      minItems: 0,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "help", "examples"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          help: { type: "string" },
          examples: {
            type: "array",
            maxItems: 4,
            items: { type: "string" },
          },
        },
      },
    },
    open_questions: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
    },
    risk_flags: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
    },
  },
};

export function createSkillInterviewPlannerService({
  registryService,
  matterStore,
  plannerProvider,
  providerService,
  env = process.env,
  fetchImpl = fetch,
  endpoint,
} = {}) {
  if (!registryService) throw new Error("registryService is required");
  const aiProviderService = providerService || createAiProviderService({ env, fetchImpl });

  async function planInterview({ skillIdea = {}, userRequest = "", designBrief = {}, matterName = "" } = {}) {
    const requestText = normalizeText(userRequest || skillIdea.text || skillIdea.idea);
    if (!requestText) {
      const error = new Error("userRequest is required");
      error.statusCode = 400;
      throw error;
    }

    if (String(env.SKILL_INTERVIEW_PLANNER_ENABLED || "").trim() !== "1") {
      return disabledPlan("SKILL_INTERVIEW_PLANNER_ENABLED is not enabled");
    }

    let resolved;
    try {
      resolved = aiProviderService.resolveTask(AI_TASKS.SKILL_DESIGN_INTERVIEW, { endpoint });
    } catch (error) {
      return disabledPlan(error.message);
    }
    const { providerConfig, aiRun: resolvedAiRun } = resolved;
    if (!providerConfig.model) {
      return disabledPlan("Skill interview planner model is not configured");
    }

    const registry = await registryService.readRegistry();
    const activeMatter = await readPlannerMatterSummary(matterStore, { matterName });
    const plannerPayload = {
      userRequest: requestText,
      skillIdea: summarizeSkillIdea(skillIdea),
      activeMatter,
      skillRegistry: summarizeRegistry(registry),
      designBrief: sanitizeSkillIdeaDesignBrief(designBrief),
      schema: SKILL_INTERVIEW_PLAN_SCHEMA,
    };

    try {
      const { plan, aiRun } = plannerProvider
        ? { plan: await plannerProvider(plannerPayload), aiRun: resolvedAiRun }
        : await invokeSkillInterviewPlanner({ aiProviderService, ...plannerPayload });
      return {
        schema_version: SKILL_INTERVIEW_PLAN_SCHEMA_VERSION,
        planner: {
          enabled: true,
          used: true,
          provider: aiRun?.provider || providerConfig.provider,
          model: aiRun?.model || providerConfig.model,
          fallback: aiRun?.fallback || resolvedAiRun?.fallback,
          policyPromptVersion: aiRun?.policyPromptVersion || resolvedAiRun?.policyPromptVersion,
        },
        plan,
      };
    } catch (error) {
      return disabledPlan(error.message || "skill interview planner unavailable");
    }
  }

  return {
    planInterview,
  };
}

async function invokeSkillInterviewPlanner({
  aiProviderService,
  userRequest,
  skillIdea,
  activeMatter,
  skillRegistry,
  designBrief,
  schema,
}) {
  const result = await aiProviderService.invoke({
    task: AI_TASKS.SKILL_DESIGN_INTERVIEW,
    systemPrompt: SKILL_INTERVIEW_SYSTEM_PROMPT,
    userPayload: plannerUserPayload({
      userRequest,
      skillIdea,
      activeMatter,
      skillRegistry,
      designBrief,
    }),
    schema,
    schemaName: "skill_interview_plan",
    responseMode: "json",
    label: "Skill interview planner",
  });
  return { plan: result.parsed, aiRun: result.aiRun };
}

function disabledPlan(reason) {
  return {
    schema_version: SKILL_INTERVIEW_PLAN_SCHEMA_VERSION,
    planner: {
      enabled: false,
      used: false,
      fallback: "deterministic_fallback",
      reason: normalizeText(reason),
    },
    plan: null,
  };
}

async function readPlannerMatterSummary(matterStore, { matterName } = {}) {
  const requestedMatterName = normalizeText(matterName);
  let root = matterStore?.getMatterRoot?.();
  if (requestedMatterName && matterStore?.resolveExistingMatter) {
    try {
      const resolved = await matterStore.resolveExistingMatter(requestedMatterName);
      root = resolved.matterPath;
    } catch {
      return sanitizeMatterSummary({ matterName: requestedMatterName });
    }
  }
  if (!root) return null;
  let metadata = {};
  try {
    metadata = await matterStore.readMatterMetadata(root);
  } catch {
    metadata = {};
  }
  return sanitizeMatterSummary({
    matterName: metadata.matterName || matterStore.activeMatterNameWithinHome?.() || "",
    matterType: metadata.matterType || "",
    jurisdiction: metadata.jurisdiction || "",
    client: metadata.clientName || metadata.client || "",
    oppositeParty: metadata.oppositeParty || "",
  });
}

function summarizeRegistry(registry) {
  return (Array.isArray(registry?.skills) ? registry.skills : []).map((skill) => ({
    slash: normalizeText(skill.slash),
    title: normalizeText(skill.title),
    purpose: normalizeText(skill.purpose || skill.description),
    inputs: normalizeStringArray(skill.inputs, 5),
    outputs: normalizeStringArray(skill.outputs, 5),
    lane: normalizeText(skill.default_lane || skill.defaultLane),
    sourceBacked: normalizeText(skill.source_backed || skill.sourceBacked),
    paidProviderCall: Boolean(skill.paid_provider_call),
  })).filter((skill) => skill.slash || skill.title);
}

function summarizeSkillIdea(skillIdea) {
  return {
    type: normalizeText(skillIdea?.type),
    mode: normalizeText(skillIdea?.mode),
    text: normalizeText(skillIdea?.text),
    idea: normalizeText(skillIdea?.idea),
  };
}

function sanitizeMatterSummary(value = {}) {
  return {
    matterName: normalizeText(value.matterName),
    matterType: normalizeText(value.matterType),
    jurisdiction: normalizeText(value.jurisdiction),
    client: normalizeText(value.client),
    oppositeParty: normalizeText(value.oppositeParty),
  };
}

function normalizeStringArray(value, limit) {
  return Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean).slice(0, limit)
    : [];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

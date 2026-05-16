import { resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import {
  LEGAL_WORKBENCH_POLICY_PROMPT_VERSION,
} from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { createDefaultSkillInterviewPlannerProvider } from "./skill-interview-planner-providers.mjs";

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
      required: [
        "intendedUser",
        "problem",
        "expectedInputs",
        "expectedOutputArtifact",
        "targetLane",
        "paidPosture",
        "riskLevel",
        "notes",
      ],
      properties: {
        intendedUser: { type: "string" },
        problem: { type: "string" },
        expectedInputs: { type: "string" },
        expectedOutputArtifact: { type: "string" },
        targetLane: {
          type: "string",
          enum: ["10_Library", "20_Workshop", "30_Drafts", "40_Dispatch"],
        },
        paidPosture: {
          type: "string",
          enum: ["free", "paid", "unknown"],
        },
        riskLevel: {
          type: "string",
          enum: ["low", "medium", "high"],
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
  env = process.env,
  fetchImpl = fetch,
  endpoint,
} = {}) {
  if (!registryService) throw new Error("registryService is required");

  async function planInterview({ skillIdea = {}, userRequest = "", designBrief = {} } = {}) {
    const requestText = normalizeText(userRequest || skillIdea.text || skillIdea.idea);
    if (!requestText) {
      const error = new Error("userRequest is required");
      error.statusCode = 400;
      throw error;
    }

    if (String(env.SKILL_INTERVIEW_PLANNER_ENABLED || "").trim() !== "1") {
      return disabledPlan("SKILL_INTERVIEW_PLANNER_ENABLED is not enabled");
    }

    let policy;
    let providerConfig;
    try {
      policy = resolveModelPolicy(AI_TASKS.SKILL_DESIGN_INTERVIEW, { env });
      providerConfig = resolveProviderConfig(policy, { endpoint });
    } catch (error) {
      return disabledPlan(error.message);
    }
    if (!providerConfig.model) {
      return disabledPlan("Skill interview planner model is not configured");
    }

    const registry = await registryService.readRegistry();
    const activeMatter = await readPlannerMatterSummary(matterStore);
    const provider = plannerProvider || createDefaultSkillInterviewPlannerProvider({
      providerConfig,
      env,
      fetchImpl,
    });

    try {
      const plan = await provider({
        userRequest: requestText,
        skillIdea: summarizeSkillIdea(skillIdea),
        activeMatter,
        skillRegistry: summarizeRegistry(registry),
        designBrief: sanitizeDesignBrief(designBrief),
        schema: SKILL_INTERVIEW_PLAN_SCHEMA,
      });
      return {
        schema_version: SKILL_INTERVIEW_PLAN_SCHEMA_VERSION,
        planner: {
          enabled: true,
          used: true,
          provider: providerConfig.provider,
          model: providerConfig.model,
          fallback: policy.fallback,
          policyPromptVersion: LEGAL_WORKBENCH_POLICY_PROMPT_VERSION,
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

async function readPlannerMatterSummary(matterStore) {
  const root = matterStore?.getMatterRoot?.();
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

function sanitizeDesignBrief(value = {}) {
  return {
    intendedUser: normalizeText(value.intendedUser),
    problem: normalizeText(value.problem),
    expectedInputs: normalizeText(value.expectedInputs),
    expectedOutputArtifact: normalizeText(value.expectedOutputArtifact),
    targetLane: normalizeText(value.targetLane),
    paidPosture: normalizeText(value.paidPosture),
    riskLevel: normalizeText(value.riskLevel),
    notes: normalizeText(value.notes),
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

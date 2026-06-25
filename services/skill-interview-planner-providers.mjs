import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_PROVIDERS, AI_TASKS } from "../shared/model-policy.mjs";
import { createAiProviderService } from "./ai-provider-service.mjs";

export const SKILL_INTERVIEW_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You plan short design interviews for future Legal Workbench skills.",
  "Return only strict JSON matching the supplied schema.",
  "Your job is to understand the exact skill idea and ask the lawyer-readable follow-up questions actually needed.",
  "Ask only the questions that are genuinely useful.",
  "You may ask up to about ten questions when the skill idea needs more design work.",
  "If the user's request is already detailed, ask fewer questions.",
  "If the user already supplied a detailed step-by-step skill specification, return zero questions and move it toward sample review.",
  "If more than ten questions would be useful, put the remaining topics in open_questions instead of asking them now.",
  "You may infer safe defaults, target lane, output artifact, risk flags, and design brief fields.",
  "You must not generate runnable skill code, prompts, schemas, provider runtime config, legal conclusions, or final legal advice.",
  "Use only these target lanes: 10_Library, 20_Workshop, 30_Drafts, 40_Dispatch.",
  "The expectedOutputArtifact must be a markdown path inside the target lane.",
  "External-facing or client-facing drafting belongs in 30_Drafts and should usually be high risk.",
  "For client update emails, prefer 30_Drafts/Client Update Email.md and keep raw FILE citations internal by default.",
  "Legal review, strategy, limitation, weakness, evidence-gap, and pleading-analysis ideas belong in 20_Workshop, not 30_Drafts, unless the user explicitly asks for an external draft.",
  "For formal party names, officers, signatories, aliases, or party-identity mapping, prefer 20_Workshop/Party and Officer Map.md and keep it source-backed.",
  "When a lawyer says limitation, assume statutory limitation/time-bar review unless the user specifically says limitation clause.",
  "For limitation review, prefer 20_Workshop/Limitation Review.md and ask about whose position, output decision shape, and applicable legal setting/statute/forum.",
  "For weakness review from the client's perspective, prefer 20_Workshop/Weakness Review.md and ask about weakness focus, output structure, and audience.",
  "If source discipline matters, include it as a default assumption unless it truly needs a user choice.",
  "For external-facing drafting, ask about audience, tone, and whether legal assessment should be included.",
  "For adjacent skill improvements, ask what changes and what must stay unchanged.",
], {
  customSkill: true,
});

export function createDefaultSkillInterviewPlannerProvider({ providerService, providerConfig = null, env = process.env, fetchImpl = fetch } = {}) {
  const service = providerService || createAiProviderService({
    env: providerConfig?.provider ? { ...env, SKILL_INTERVIEW_PLANNER_PROVIDER: providerConfig.provider } : env,
    fetchImpl,
  });
  return async function skillInterviewPlannerProvider({
    userRequest,
    skillIdea,
    activeMatter,
    skillRegistry,
    designBrief,
    schema,
  } = {}) {
    try {
      const result = await service.invoke({
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
        overrides: providerConfigToOverrides(providerConfig),
        label: "Skill interview planner",
      });
      return result.parsed;
    } catch (error) {
      if (error?.code && error.code !== "provider.error") {
        error.code = "provider.error";
      }
      throw error;
    }
  };
}

export function createOpenAiSkillInterviewPlannerProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens,
  timeoutMs,
} = {}) {
  return createDefaultSkillInterviewPlannerProvider({
    providerConfig: {
      provider: AI_PROVIDERS.OPENAI_DIRECT,
      endpoint,
      model,
      maxOutputTokens,
      timeoutMs,
    },
    env: { OPENAI_API_KEY: apiKey || "" },
    fetchImpl,
  });
}

export function createOpenRouterSkillInterviewPlannerProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens,
  timeoutMs,
  requireParameters = true,
  allowFallbacks = false,
} = {}) {
  return createDefaultSkillInterviewPlannerProvider({
    providerConfig: {
      provider: AI_PROVIDERS.OPENROUTER,
      endpoint,
      model,
      maxOutputTokens,
      timeoutMs,
      requireParameters,
      allowFallbacks,
    },
    env: { OPENROUTER_API_KEY: apiKey || "" },
    fetchImpl,
  });
}

export function plannerUserPayload({ userRequest, skillIdea, activeMatter, skillRegistry, designBrief }) {
  return {
    task: "Plan a non-runnable skill idea interview.",
    user_skill_idea: userRequest,
    skill_idea: skillIdea,
    active_matter: activeMatter,
    skill_registry: skillRegistry,
    current_design_brief: designBrief,
    strict_rules: [
      "ask up to about 10 useful questions; fewer if enough context is already supplied",
      "if the user already supplied a detailed step-by-step skill specification, return zero questions",
      "if more than 10 questions are needed, put remaining topics in open_questions",
      "lawyer-readable labels",
      "specific to the requested skill",
      "do not ask already-inferred low-risk defaults",
      "no raw matter documents are provided or needed",
      "no skill generation",
      "no prompt generation",
      "no activation",
    ],
  };
}

function providerConfigToOverrides(providerConfig) {
  if (!providerConfig || typeof providerConfig !== "object") return {};
  return {
    endpoint: providerConfig.endpoint,
    model: providerConfig.model,
    maxOutputTokens: providerConfig.maxOutputTokens,
    timeoutMs: providerConfig.timeoutMs,
    providerOrder: providerConfig.providerOrder,
    providerSort: providerConfig.providerSort,
    maxPrice: providerConfig.maxPrice,
    requireParameters: providerConfig.requireParameters,
    allowFallbacks: providerConfig.allowFallbacks,
    extraHeaders: providerConfig.extraHeaders || { "x-title": "Matter Workbench Skill Interview Planner" },
  };
}

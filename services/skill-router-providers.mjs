import { DEFAULT_OPENAI_MODEL } from "../shared/ai-defaults.mjs";
import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import {
  AI_PROVIDERS,
  AI_TASKS,
  DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
} from "../shared/model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT } from "../shared/responses-client.mjs";
import { createAiProviderService } from "./ai-provider-service.mjs";

export const SKILL_ROUTER_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You are the Legal Workbench skill router.",
  "Classify a user's request against copilot, native skill, existing skill, skill modification, tuning, and new reusable skill paths.",
  "Do not assume every request containing words like create, make, draft, review, or note is a reusable skill request.",
  "Classify one-time matter questions, ad hoc analysis, document lookup, quick notes, temporary summaries, and conversational help as transient_copilot.",
  "Classify as new_skill only when the user is asking for a reusable future workflow, slash command, skill, template-like repeatable process, or cross-matter tool.",
  "Classify as modify_existing_skill when the user wants to change, tune, extend, or add a mode to an existing skill.",
  "Be MECE: do not recommend duplicate skills when an existing skill has the same category, goal, input contract, and output contract.",
  "If there is a direct MECE violation, recommend modifying the existing skill and require user approval.",
  "Treat expert preferences or legal heuristics as skill tuning, not a new executable workflow.",
  "Be legal-setting aware: forum, jurisdiction, case type, procedural stage, side, relief, and audience may justify profiles or tuning before new skills.",
  "All AI legal work product should be markdown-first until export/print skills are mature; DOCX/PDF belong to Export skills.",
  "Return only JSON in the requested schema.",
], {
  customSkill: true,
  sourceVisibility: false,
});

export function createDefaultSkillRouterProvider({ providerService, providerConfig = null, env = process.env, fetchImpl = fetch } = {}) {
  const service = providerService || createAiProviderService({
    env: providerConfig?.provider ? { ...env, SKILL_ROUTER_PROVIDER: providerConfig.provider } : env,
    fetchImpl,
  });
  return async function skillRouterProvider({ userRequest, overrideJustification, registry, schema } = {}) {
    const result = await service.invoke({
      task: AI_TASKS.SKILL_ROUTER,
      systemPrompt: SKILL_ROUTER_SYSTEM_PROMPT,
      userPayload: routerUserPayload({ userRequest, overrideJustification, registry }),
      schema,
      schemaName: "skill_router_decision",
      schemaDescription: "MECE-aware routing decision for legal-workbench skill requests.",
      responseMode: "json",
      overrides: providerConfigToOverrides(providerConfig),
      label: "Skill router",
    });
    return result.parsed;
  };
}

export function createOpenAiSkillRouterProvider({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  endpoint = DEFAULT_RESPONSES_ENDPOINT,
  maxOutputTokens = DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
  fetchImpl = fetch,
} = {}) {
  return createDefaultSkillRouterProvider({
    providerConfig: {
      provider: AI_PROVIDERS.OPENAI_DIRECT,
      endpoint,
      model,
      maxOutputTokens,
    },
    env: { OPENAI_API_KEY: apiKey || "" },
    fetchImpl,
  });
}

export function createOpenRouterSkillRouterProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens = DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
  timeoutMs,
  requireParameters = true,
  allowFallbacks = false,
} = {}) {
  return createDefaultSkillRouterProvider({
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

export function routerUserPayload({ userRequest, overrideJustification, registry }) {
  return {
    user_request: userRequest,
    override_justification: overrideJustification,
    registry_principles: registry.principles || {},
    skill_registry: registry.skills.map((skill) => ({
      slash: skill.slash,
      category: skill.category,
      purpose: skill.purpose,
      inputs: skill.inputs,
      outputs: skill.outputs,
      upstream: skill.upstream,
      downstream: skill.downstream,
      mode: skill.mode,
      source_backed: skill.source_backed,
      legal_setting_scope: skill.legal_setting_scope,
      markdown_first: skill.markdown_first,
    })),
    transient_copilot_rule: "Use transient_copilot for one-time matter Q&A, one-off notes, document lookup, quick analysis, or temporary drafting that the user has not asked to save as a reusable skill.",
    new_skill_rule: "Use new_skill only for a reusable workflow or future repeatable skill, not for a single matter task.",
    modify_skill_rule: "Use modify_existing_skill when the request changes behavior, scope, output, audience, or mode of an existing skill.",
    direct_mece_violation_rule: "same category + same goal + same input contract + same output contract",
    user_gate_choices: ["Use or improve existing skill", "Create separate skill with reason"],
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
    extraHeaders: providerConfig.extraHeaders || { "x-title": "Matter Workbench Skill Router" },
  };
}

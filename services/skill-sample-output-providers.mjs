import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_PROVIDERS, AI_TASKS } from "../shared/model-policy.mjs";
import { createAiProviderService } from "./ai-provider-service.mjs";

export const SAMPLE_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You create sample outputs for proposed Legal Workbench skills.",
  "This is not skill generation. Do not produce code, prompts, schemas, configuration, or slash commands.",
  "Return Markdown only.",
  "Use the proposed skill request, design brief, and bounded matter context packet.",
  "The sample should look like the artifact the future skill would produce for the chosen test matter.",
  "If the output is internal legal review, preserve source labels plus raw FILE-NNNN pX.bY citations for factual points.",
  "If the output is client-facing or dispatch-facing, keep raw FILE citations internal unless the design brief explicitly asks to show them.",
  "Do not invent facts. Mark uncertainty and missing evidence clearly.",
  "Do not claim the skill is runnable or ready.",
], {
  customSkill: true,
});

export function createOpenAiSkillSampleOutputProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens,
  timeoutMs,
} = {}) {
  return createDefaultSkillSampleOutputProvider({
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

export function createOpenRouterSkillSampleOutputProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens,
  timeoutMs,
  requireParameters = true,
  allowFallbacks = false,
} = {}) {
  return createDefaultSkillSampleOutputProvider({
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

export function createDefaultSkillSampleOutputProvider({ providerService, providerConfig = null, env = process.env, fetchImpl = fetch } = {}) {
  const service = providerService || createAiProviderService({
    env: providerConfig?.provider ? { ...env, SKILL_SAMPLE_OUTPUT_PROVIDER: providerConfig.provider } : env,
    fetchImpl,
  });
  return async function skillSampleOutputProvider({ idea, feedback, previousSample, matterContext } = {}) {
    const result = await service.invoke({
      task: AI_TASKS.SKILL_SAMPLE_OUTPUT,
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userPayload: sampleUserPayload({ idea, feedback, previousSample, matterContext }),
      responseMode: "text",
      overrides: providerConfigToOverrides(providerConfig),
      label: "Skill sample output",
    });
    return result.parsed;
  };
}

export function sampleUserPayload({ idea, feedback, previousSample, matterContext }) {
  return {
    task: "Generate a non-runnable sample output for user review.",
    strict_boundaries: [
      "Do not create or claim to create a skill.",
      "Do not produce a slash command.",
      "Do not produce prompt text, schema, code, or configuration.",
      "Do not write artifacts.",
      "Output Markdown only.",
    ],
    skill_request: idea,
    test_matter_context: matterContext,
    previous_sample: previousSample || "",
    reviewer_feedback: feedback || "",
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
    extraHeaders: providerConfig.extraHeaders || { "x-title": "Matter Workbench Skill Sample Output" },
  };
}

import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_PROVIDERS } from "../shared/model-policy.mjs";
import {
  extractOpenAiOutputText,
  extractOpenRouterMessageText,
  fetchProviderJsonWithTimeout,
} from "../shared/provider-http.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

const SAMPLE_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
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
  return async function openAiSkillSampleOutputProvider({
    idea,
    feedback,
    previousSample,
    matterContext,
  } = {}) {
    if (!apiKey) throw makeHttpError("OPENAI_API_KEY is required for skill sample output generation", 409, "skill_sample_output.provider_api_key_required");
    const body = {
      model,
      max_output_tokens: maxOutputTokens,
      input: [
        { role: "system", content: SAMPLE_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(sampleUserPayload({ idea, feedback, previousSample, matterContext })) },
      ],
    };
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      body,
      timeoutMs,
      timeoutMessage: `OpenAI skill sample output request timed out after ${timeoutMs}ms`,
    });
    return extractOpenAiOutputText(payload, "OpenAI skill sample output");
  };
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
  return async function openRouterSkillSampleOutputProvider({
    idea,
    feedback,
    previousSample,
    matterContext,
  } = {}) {
    if (!apiKey) throw makeHttpError("OPENROUTER_API_KEY is required for skill sample output generation", 409, "skill_sample_output.provider_api_key_required");
    const body = {
      model,
      messages: [
        { role: "system", content: SAMPLE_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(sampleUserPayload({ idea, feedback, previousSample, matterContext })) },
      ],
      temperature: 0,
      max_tokens: maxOutputTokens,
      provider: {
        require_parameters: requireParameters,
        allow_fallbacks: allowFallbacks,
      },
    };
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      body,
      timeoutMs,
      extraHeaders: {
        "http-referer": "https://github.com/molotovsingh/matter-workbench",
        "x-title": "Matter Workbench Skill Sample Output",
      },
      timeoutMessage: `OpenRouter skill sample output request timed out after ${timeoutMs}ms`,
    });
    return extractOpenRouterMessageText(payload, "OpenRouter skill sample output");
  };
}

export function createDefaultSkillSampleOutputProvider({ providerConfig, env, fetchImpl }) {
  if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
    return createOpenRouterSkillSampleOutputProvider({
      apiKey: env.OPENROUTER_API_KEY,
      endpoint: providerConfig.endpoint,
      fetchImpl,
      model: providerConfig.model,
      maxOutputTokens: providerConfig.maxOutputTokens,
      timeoutMs: providerConfig.timeoutMs,
      requireParameters: providerConfig.requireParameters,
      allowFallbacks: providerConfig.allowFallbacks,
    });
  }
  return createOpenAiSkillSampleOutputProvider({
    apiKey: env.OPENAI_API_KEY,
    endpoint: providerConfig.endpoint,
    fetchImpl,
    model: providerConfig.model,
    maxOutputTokens: providerConfig.maxOutputTokens,
    timeoutMs: providerConfig.timeoutMs,
  });
}

function sampleUserPayload({ idea, feedback, previousSample, matterContext }) {
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
    feedback: feedback || "",
  };
}

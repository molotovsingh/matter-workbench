import { publicSkill } from "./configurable-skill-definition.mjs";
import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_PROVIDERS, AI_TASKS } from "../shared/model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT } from "../shared/responses-client.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { createAiProviderService } from "./ai-provider-service.mjs";

export const AUTHORING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "slash",
    "description",
    "target_lane",
    "output_artifact",
    "matter_required",
    "paid_provider_call",
    "source_backed",
    "prompt",
    "citation_policy",
  ],
  properties: {
    title: { type: "string" },
    slash: { type: "string" },
    description: { type: "string" },
    target_lane: { type: "string", enum: ["10_Library", "20_Workshop", "30_Drafts", "40_Dispatch"] },
    output_artifact: { type: "string" },
    matter_required: { type: "boolean" },
    paid_provider_call: { type: "boolean" },
    source_backed: { type: "string", enum: ["required", "optional", "none"] },
    prompt: { type: "string" },
    citation_policy: { type: "string" },
  },
};

export const AUTHORING_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You create strict configurable skill definitions for Matter Workbench.",
  "Return only JSON matching the schema.",
  "Do not generate code, routes, tests, files, or executable JavaScript.",
  "Create a reusable prompt/config for the future skill runner.",
  "The skill must be faithful to the approved sample and design brief.",
  "Prefer safe internal workshop artifacts unless the approved design clearly asks for drafts or dispatch.",
  "The prompt must require source-backed factual statements when the skill is internal legal work product.",
  "For source_backed required skills, the prompt and citation_policy must require readable source labels plus raw FILE-NNNN pX.bY audit citations.",
  "If raw citations should not appear in normal prose, require a clearly marked internal audit/source-handles section instead.",
  "Never claim the skill is court-ready or final legal advice.",
], {
  customSkill: true,
});

export const RUN_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You are running an approved configurable Matter Workbench skill.",
  "Return Markdown only.",
  "Use the supplied skill prompt, matter context packet, and output artifact contract.",
  "Do not produce code, schema, provider config, or activation text.",
  "Do not mention that you are an AI model.",
  "Do not invent facts. Mark uncertainty and missing evidence clearly.",
  "For source-backed work, cite readable source labels in normal lawyer-visible text.",
  "For source-backed work, include raw FILE-NNNN pX.bY citations in a clearly marked internal audit/source-handles section.",
  "Do not present raw audit handles as court-facing text.",
], {
  customSkill: true,
});

export function createDefaultAuthoringProvider({ providerService, providerConfig = null, env = process.env, fetchImpl = fetch } = {}) {
  const service = providerService || createAiProviderService({
    env: providerConfig?.provider ? { ...env, SKILL_AUTHORING_PROVIDER: providerConfig.provider } : env,
    fetchImpl,
  });
  return async function authoringProvider({ idea, sample, existingSlashes, targetSkill, schema } = {}) {
    try {
      const result = await service.invoke({
        task: AI_TASKS.SKILL_AUTHORING,
        systemPrompt: AUTHORING_SYSTEM_PROMPT,
        userPayload: authoringPayload({ idea, sample, existingSlashes, targetSkill }),
        schema,
        schemaName: "configurable_skill_definition",
        responseMode: "json",
        overrides: providerConfigToOverrides(providerConfig, { xTitle: "Matter Workbench Skill Authoring" }),
        label: providerConfig?.label || "Configurable skill authoring",
      });
      return result.parsed;
    } catch (error) {
      throw normalizeConfigurableProviderError(error);
    }
  };
}

export function createDefaultRunProvider({ providerService, providerConfig = null, env = process.env, fetchImpl = fetch } = {}) {
  const service = providerService || createAiProviderService({
    env: providerConfig?.provider ? { ...env, CONFIGURABLE_SKILL_RUN_PROVIDER: providerConfig.provider } : env,
    fetchImpl,
  });
  return async function runProvider({ skill, matterContext } = {}) {
    try {
      const result = await service.invoke({
        task: AI_TASKS.CONFIGURABLE_SKILL_RUN,
        systemPrompt: RUN_SYSTEM_PROMPT,
        userPayload: runPayload({ skill, matterContext }),
        responseMode: "text",
        overrides: providerConfigToOverrides(providerConfig, { xTitle: "Matter Workbench Configurable Skill Run" }),
        label: providerConfig?.label || "Configurable skill run",
      });
      return result.parsed;
    } catch (error) {
      throw normalizeConfigurableProviderError(error);
    }
  };
}

export function createOpenAiAuthoringProvider({ apiKey, endpoint = DEFAULT_RESPONSES_ENDPOINT, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return createDefaultAuthoringProvider({
    providerConfig: {
      provider: AI_PROVIDERS.OPENAI_DIRECT,
      endpoint,
      model,
      maxOutputTokens,
      timeoutMs,
      label: "OpenAI skill authoring",
    },
    env: { OPENAI_API_KEY: apiKey || "" },
    fetchImpl,
  });
}

export function createOpenRouterAuthoringProvider({ apiKey, endpoint, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return createDefaultAuthoringProvider({
    providerConfig: {
      provider: AI_PROVIDERS.OPENROUTER,
      endpoint,
      model,
      maxOutputTokens,
      timeoutMs,
      requireParameters: true,
      allowFallbacks: false,
      extraHeaders: { "x-title": "Matter Workbench Skill Authoring" },
      label: "OpenRouter skill authoring",
    },
    env: { OPENROUTER_API_KEY: apiKey || "" },
    fetchImpl,
  });
}

export function createOpenAiRunProvider({ apiKey, endpoint = DEFAULT_RESPONSES_ENDPOINT, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return createDefaultRunProvider({
    providerConfig: {
      provider: AI_PROVIDERS.OPENAI_DIRECT,
      endpoint,
      model,
      maxOutputTokens,
      timeoutMs,
      label: "OpenAI configurable skill run",
    },
    env: { OPENAI_API_KEY: apiKey || "" },
    fetchImpl,
  });
}

export function createOpenRouterRunProvider({ apiKey, endpoint, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return createDefaultRunProvider({
    providerConfig: {
      provider: AI_PROVIDERS.OPENROUTER,
      endpoint,
      model,
      maxOutputTokens,
      timeoutMs,
      requireParameters: true,
      allowFallbacks: false,
      extraHeaders: { "x-title": "Matter Workbench Configurable Skill Run" },
      label: "OpenRouter configurable skill run",
    },
    env: { OPENROUTER_API_KEY: apiKey || "" },
    fetchImpl,
  });
}

export function authoringPayload({ idea, sample, existingSlashes, targetSkill = null }) {
  return {
    task: targetSkill
      ? "Create a new version of an existing configurable skill from an approved revised sample."
      : "Create a configurable skill definition from an approved sample.",
    strict_boundaries: [
      "Do not generate code.",
      "Do not create routes.",
      "Do not claim activation.",
      "Return only the skill definition JSON.",
      "For an existing-skill revision, keep the slash command stable unless the caller explicitly supplied a different activation plan.",
    ],
    idea: {
      id: idea?.id,
      text: idea?.text,
      designBrief: idea?.designBrief,
    },
    approved_sample: {
      id: sample?.id,
      matter: sample?.matter,
      markdown: sample?.sampleMarkdown,
    },
    existing_skill: targetSkill ? publicSkill(targetSkill) : null,
    existing_slashes: existingSlashes,
  };
}

export function runPayload({ skill, matterContext }) {
  return {
    task: "Run this active configurable skill for the selected matter.",
    skill: {
      title: skill?.title,
      slash: skill?.slash,
      description: skill?.description,
      outputArtifact: skill?.outputArtifact,
      sourceBacked: skill?.sourceBacked,
      prompt: skill?.promptConfig?.prompt,
      citationPolicy: skill?.promptConfig?.citationPolicy,
    },
    matter_context: matterContext,
  };
}

function providerConfigToOverrides(providerConfig, { xTitle } = {}) {
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
    extraHeaders: providerConfig.extraHeaders || (xTitle ? { "x-title": xTitle } : undefined),
  };
}

function normalizeConfigurableProviderError(error) {
  if (String(error?.code || "").endsWith("api_key_required")) {
    return makeHttpError(error.message, 409, "configurable_skill_provider.api_key_required");
  }
  return error;
}

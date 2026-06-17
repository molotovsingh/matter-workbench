import { publicSkill } from "./configurable-skill-definition.mjs";
import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_PROVIDERS } from "../shared/model-policy.mjs";
import {
  extractOpenAiOutputText,
  extractOpenRouterMessageText,
  fetchProviderJsonWithTimeout,
  parseOpenAiJsonOutput,
  parseOpenRouterJsonMessage,
} from "../shared/provider-http.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

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

const AUTHORING_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
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

const RUN_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
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

export function createDefaultAuthoringProvider({ providerConfig, env, fetchImpl }) {
  if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
    return createOpenRouterAuthoringProvider({
      apiKey: env.OPENROUTER_API_KEY,
      endpoint: providerConfig.endpoint,
      fetchImpl,
      model: providerConfig.model,
      maxOutputTokens: providerConfig.maxOutputTokens,
      timeoutMs: providerConfig.timeoutMs,
    });
  }
  return createOpenAiAuthoringProvider({
    apiKey: env.OPENAI_API_KEY,
    endpoint: providerConfig.endpoint,
    fetchImpl,
    model: providerConfig.model,
    maxOutputTokens: providerConfig.maxOutputTokens,
    timeoutMs: providerConfig.timeoutMs,
  });
}

export function createDefaultRunProvider({ providerConfig, env, fetchImpl }) {
  if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
    return createOpenRouterRunProvider({
      apiKey: env.OPENROUTER_API_KEY,
      endpoint: providerConfig.endpoint,
      fetchImpl,
      model: providerConfig.model,
      maxOutputTokens: providerConfig.maxOutputTokens,
      timeoutMs: providerConfig.timeoutMs,
    });
  }
  return createOpenAiRunProvider({
    apiKey: env.OPENAI_API_KEY,
    endpoint: providerConfig.endpoint,
    fetchImpl,
    model: providerConfig.model,
    maxOutputTokens: providerConfig.maxOutputTokens,
    timeoutMs: providerConfig.timeoutMs,
  });
}

export function createOpenAiAuthoringProvider({ apiKey, endpoint, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return async function openAiAuthoringProvider({ idea, sample, existingSlashes, targetSkill, schema } = {}) {
    if (!apiKey) {
      throw makeHttpError(
        "OPENAI_API_KEY is required for skill authoring",
        409,
        "configurable_skill_provider.api_key_required",
      );
    }
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      timeoutMs,
      timeoutMessage: `OpenAI skill authoring request timed out after ${timeoutMs}ms`,
      body: {
        model,
        max_output_tokens: maxOutputTokens,
        input: [
          { role: "system", content: AUTHORING_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(authoringPayload({ idea, sample, existingSlashes, targetSkill })) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "configurable_skill_definition",
            strict: true,
            schema,
          },
        },
      },
    });
    return parseOpenAiJsonOutput(payload, "OpenAI skill authoring");
  };
}

export function createOpenRouterAuthoringProvider({ apiKey, endpoint, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return async function openRouterAuthoringProvider({ idea, sample, existingSlashes, targetSkill, schema } = {}) {
    if (!apiKey) {
      throw makeHttpError(
        "OPENROUTER_API_KEY is required for skill authoring",
        409,
        "configurable_skill_provider.api_key_required",
      );
    }
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      timeoutMs,
      extraHeaders: {
        "http-referer": "https://github.com/molotovsingh/matter-workbench",
        "x-title": "Matter Workbench Skill Authoring",
      },
      timeoutMessage: `OpenRouter skill authoring request timed out after ${timeoutMs}ms`,
      body: {
        model,
        messages: [
          { role: "system", content: AUTHORING_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(authoringPayload({ idea, sample, existingSlashes, targetSkill })) },
        ],
        temperature: 0,
        max_tokens: maxOutputTokens,
        provider: { require_parameters: true, allow_fallbacks: false },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "configurable_skill_definition",
            strict: true,
            schema,
          },
        },
      },
    });
    return parseOpenRouterJsonMessage(payload, "OpenRouter skill authoring");
  };
}

export function createOpenAiRunProvider({ apiKey, endpoint, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return async function openAiRunProvider({ skill, matterContext } = {}) {
    if (!apiKey) {
      throw makeHttpError(
        "OPENAI_API_KEY is required for configurable skill runs",
        409,
        "configurable_skill_provider.api_key_required",
      );
    }
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      timeoutMs,
      timeoutMessage: `OpenAI configurable skill run timed out after ${timeoutMs}ms`,
      body: {
        model,
        max_output_tokens: maxOutputTokens,
        input: [
          { role: "system", content: RUN_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(runPayload({ skill, matterContext })) },
        ],
      },
    });
    return extractOpenAiOutputText(payload, "OpenAI configurable skill run");
  };
}

export function createOpenRouterRunProvider({ apiKey, endpoint, fetchImpl = fetch, model, maxOutputTokens, timeoutMs } = {}) {
  return async function openRouterRunProvider({ skill, matterContext } = {}) {
    if (!apiKey) {
      throw makeHttpError(
        "OPENROUTER_API_KEY is required for configurable skill runs",
        409,
        "configurable_skill_provider.api_key_required",
      );
    }
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      timeoutMs,
      extraHeaders: {
        "http-referer": "https://github.com/molotovsingh/matter-workbench",
        "x-title": "Matter Workbench Configurable Skill Run",
      },
      timeoutMessage: `OpenRouter configurable skill run timed out after ${timeoutMs}ms`,
      body: {
        model,
        messages: [
          { role: "system", content: RUN_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(runPayload({ skill, matterContext })) },
        ],
        temperature: 0,
        max_tokens: maxOutputTokens,
        provider: { require_parameters: true, allow_fallbacks: false },
      },
    });
    return extractOpenRouterMessageText(payload, "OpenRouter configurable skill run");
  };
}

function authoringPayload({ idea, sample, existingSlashes, targetSkill = null }) {
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
      id: idea.id,
      text: idea.text,
      designBrief: idea.designBrief,
    },
    approved_sample: {
      id: sample.id,
      matter: sample.matter,
      markdown: sample.sampleMarkdown,
    },
    existing_skill: targetSkill ? publicSkill(targetSkill) : null,
    existing_slashes: existingSlashes,
  };
}

function runPayload({ skill, matterContext }) {
  return {
    task: "Run this active configurable skill for the selected matter.",
    skill: {
      title: skill.title,
      slash: skill.slash,
      description: skill.description,
      outputArtifact: skill.outputArtifact,
      sourceBacked: skill.sourceBacked,
      prompt: skill.promptConfig.prompt,
      citationPolicy: skill.promptConfig.citationPolicy,
    },
    matter_context: matterContext,
  };
}

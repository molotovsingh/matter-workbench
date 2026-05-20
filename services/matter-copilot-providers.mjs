import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_PROVIDERS } from "../shared/model-policy.mjs";
import {
  fetchProviderJsonWithTimeout,
  parseOpenAiJsonOutput,
  parseOpenRouterJsonMessage,
} from "../shared/provider-http.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

const COPILOT_ANSWER_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You answer one-time matter questions inside Matter Workbench.",
  "Use only the supplied bounded matter context packet. This is a closed-world task.",
  "Do not use outside knowledge, legal memory, assumptions, or uncited facts.",
  "If the packet does not support the answer, return not_found or partial with a limitation.",
  "Keep the answer concise and lawyer-readable.",
  "Separate source-supported facts from inference.",
  "When chronology_entries are present, read them first as the matter's prepared chronology, then use sources and evidence_blocks to verify, cite, or fill gaps.",
  "Do not mention omitted evidence-block counts or packet limits in answer_markdown. If coverage is limited, say it is a quick answer from selected matter records.",
  "Do preserve useful OCR, bad-copy, or needs-review warnings where they may affect reliability.",
  "In answer_markdown, write like a careful lawyer: say 'the record indicates', 'the record shows', or 'I cannot confirm from the record'.",
  "Do not say 'the packet supports', 'the supplied packet', 'bounded context', or similar implementation language in answer_markdown.",
  "Use implementation language only in internal reasoning, never in the visible answer.",
  "Use lawyer-facing source labels in answer text; raw FILE citations belong only in the structured sources array.",
  "Return only JSON matching the schema.",
], {
  copilot: true,
});

export function createOpenAiMatterCopilotProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens,
  timeoutMs,
} = {}) {
  return async function openAiMatterCopilotProvider({ question, matterContext, schema } = {}) {
    if (!apiKey) throw makeHttpError("OPENAI_API_KEY is required for matter copilot answers", 409);
    const body = {
      model,
      max_output_tokens: maxOutputTokens,
      input: [
        { role: "system", content: COPILOT_ANSWER_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(copilotUserPayload({ question, matterContext })) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "matter_copilot_answer",
          strict: true,
          schema,
        },
      },
    };
    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      body,
      timeoutMs,
      timeoutMessage: `OpenAI matter copilot answer request timed out after ${timeoutMs}ms`,
    });
    return parseOpenAiJsonOutput(payload, "OpenAI matter copilot answer");
  };
}

export function createOpenRouterMatterCopilotProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens,
  timeoutMs,
  requireParameters = true,
  allowFallbacks = false,
} = {}) {
  return async function openRouterMatterCopilotProvider({ question, matterContext, schema } = {}) {
    if (!apiKey) throw makeHttpError("OPENROUTER_API_KEY is required for matter copilot answers", 409);
    const body = {
      model,
      messages: [
        { role: "system", content: COPILOT_ANSWER_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(copilotUserPayload({ question, matterContext })) },
      ],
      temperature: 0,
      max_tokens: maxOutputTokens,
      provider: {
        require_parameters: requireParameters,
        allow_fallbacks: allowFallbacks,
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "matter_copilot_answer",
          strict: true,
          schema,
        },
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
        "x-title": "Matter Workbench Matter Copilot",
      },
      timeoutMessage: `OpenRouter matter copilot answer request timed out after ${timeoutMs}ms`,
    });
    return parseOpenRouterJsonMessage(payload, "OpenRouter matter copilot answer");
  };
}

export function createDefaultMatterCopilotProvider({ providerConfig, env, fetchImpl }) {
  if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
    return createOpenRouterMatterCopilotProvider({
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
  return createOpenAiMatterCopilotProvider({
    apiKey: env.OPENAI_API_KEY,
    endpoint: providerConfig.endpoint,
    fetchImpl,
    model: providerConfig.model,
    maxOutputTokens: providerConfig.maxOutputTokens,
    timeoutMs: providerConfig.timeoutMs,
  });
}

function copilotUserPayload({ question, matterContext }) {
  return {
    task: "Answer the user's one-time matter question from the bounded matter context only.",
    visible_answer_voice: [
      "Do not mention packets, context packets, bounded context, maxBlocks, extraction limits, or internal implementation terms in answer_markdown.",
      "Do not mention omitted evidence-block counts in answer_markdown.",
      "Use 'the record' or 'the current record' for lawyer-facing uncertainty.",
      "Keep technical limitations in warnings, not the answer body.",
    ],
    question,
    matter_context: matterContext,
    strict_rules: [
      "Do not write matter artifacts.",
      "Do not run skills.",
      "Do not provide final legal advice.",
      "Do not cite anything outside the supplied packet.",
      "Use not_found when the supplied packet does not answer the question.",
    ],
  };
}

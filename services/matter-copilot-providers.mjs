import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_TASKS } from "../shared/model-policy.mjs";
import { createAiProviderService } from "./ai-provider-service.mjs";

export const COPILOT_ANSWER_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You answer matter questions inside Matter Workbench, including bounded follow-ups.",
  "Use only the supplied bounded matter context packet as evidence. This is a closed-world evidence task.",
  "Do not use outside knowledge, legal memory, assumptions, or uncited facts.",
  "Conversation context may be used only to understand references like 'that', 'above', 'same party', or 'after this date'.",
  "Do not treat previous assistant answers as evidence. Do not cite prior assistant answers.",
  "If the packet does not support the answer, return not_found or partial with a limitation.",
  "Keep the answer concise and lawyer-readable.",
  "Separate source-supported facts from inference.",
  "When list_of_dates_markdown or chronology_entries are present, read them first as the matter's prepared chronology, then use sources and evidence_blocks to verify, cite, or fill gaps.",
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

export function createDefaultMatterCopilotProvider({
  providerService,
  providerConfig = null,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const service = providerService || createAiProviderService({
    env: providerConfig?.provider ? { ...env, COPILOT_ANSWER_PROVIDER: providerConfig.provider } : env,
    fetchImpl,
  });
  return async function matterCopilotProvider({ question, matterContext, conversationContext = [], schema } = {}) {
    const result = await service.invoke({
      task: AI_TASKS.COPILOT_ANSWER,
      systemPrompt: COPILOT_ANSWER_SYSTEM_PROMPT,
      userPayload: copilotUserPayload({ question, matterContext, conversationContext }),
      schema,
      schemaName: "matter_copilot_answer",
      responseMode: "json",
      overrides: providerConfigToOverrides(providerConfig),
      label: "Matter copilot answer",
    });
    return result.parsed;
  };
}

export function copilotUserPayload({ question, matterContext, conversationContext = [] }) {
  return {
    task: "Answer the user's matter question from bounded matter context only. Use conversation context only to resolve references, never as evidence.",
    visible_answer_voice: [
      "Do not mention packets, context packets, bounded context, maxBlocks, extraction limits, or internal implementation terms in answer_markdown.",
      "Do not mention omitted evidence-block counts in answer_markdown.",
      "Use 'the record' or 'the current record' for lawyer-facing uncertainty.",
      "Keep technical limitations in warnings, not the answer body.",
    ],
    question,
    conversation_context: Array.isArray(conversationContext) ? conversationContext : [],
    matter_context: matterContext,
    strict_rules: [
      "Do not write matter artifacts.",
      "Do not run skills.",
      "Do not provide final legal advice.",
      "Do not cite anything outside the supplied packet.",
      "Use conversation_context only to resolve references; prior assistant answers are not evidence.",
      "Do not cite or rely on previous assistant answers as facts.",
      "In sources[].raw_citation, use an exact citation handle from evidence_blocks[].citation, chronology_entries[].citation, or chronology_entries[].supporting_sources[].citation.",
      "Do not put a lawyer-facing source label or document title in sources[].raw_citation.",
      "Use not_found when the supplied packet does not answer the question.",
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
  };
}

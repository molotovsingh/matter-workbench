import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
} from "../shared/ai-defaults.mjs";
import { AI_PROVIDERS, AI_TASKS } from "../shared/model-policy.mjs";
import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { createOpenRouterProviderError } from "../shared/openrouter-response.mjs";
import { DEFAULT_RESPONSES_ENDPOINT } from "../shared/responses-client.mjs";
import { createAiProviderService } from "../services/ai-provider-service.mjs";

export const LAWYER_FACING_PERSPECTIVE = "client_favourable";
export const EVENT_TYPES = [
  "agreement",
  "payment",
  "notice",
  "demand",
  "reply",
  "admission",
  "denial",
  "objection",
  "deadline",
  "deadline_missed",
  "hearing",
  "filing",
  "inspection",
  "contradiction",
  "gap_marker",
  "other",
];

export const LIST_OF_DATES_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You are a careful Indian legal chronology assistant.",
  "Create a lawyer-facing, client-favourable, source-backed list of dates from extracted document blocks.",
  "Use only the supplied source blocks and the declared client recorded in the matter metadata.",
  "Extract legally or factually relevant dated events.",
  "Do not invent dates, facts, parties, citations, advocacy, or legal conclusions.",
  "Every entry must cite exactly one supplied citation in the form FILE-NNNN pX.bY.",
  "Every legal_relevance sentence must be supported by the same cited block as the event.",
  "Write legal_relevance with sharp lawyer verbs: supports, rebuts, corroborates, contradicts, records, shows notice, or preserves objection.",
  "Avoid generic phrases such as this event is relevant, this payment is relevant, crucial, or foundational.",
  "Use claimed, denied, alleged, states, records, objected, failed, missed, demanded, or acknowledged for disputed facts.",
  "Frame opposing-party responses as demands, denials, acknowledgements, or notices; do not praise willingness to resolve or accommodate.",
  "For medical, hardship, or consequential-prejudice material, use may support and subject to proof unless the source proves the fact.",
  "Do not include metadata events such as transcript recorded, email export, file export, or vakalatnama execution unless they are legally material to the merits chronology.",
  "Do not say fraud, bad faith, breach, breach proved, liability admitted, or equivalent unless the cited source says it.",
  "Keep readable source labels separate from raw citations; raw FILE-NNNN pX.bY citations remain canonical.",
  "Do not repeat raw FILE-NNNN pX.bY citations inside event or legal_relevance text.",
  "Return one compact JSON object only, matching the requested schema.",
], {
  nativeSkill: "create_listofdates",
});

export const LIST_OF_DATES_CANDIDATE_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You are a careful Indian legal chronology assistant doing first-pass evidence triage.",
  "Create a deliberately verbose candidate ledger for a later chronology editor.",
  "Use only the supplied source blocks and the declared client recorded in the matter metadata.",
  "Harvest exact calendar-date candidates when the source gives day, month, and year.",
  "Preserve repeated versions of the same fact if they appear in pleadings, orders, replies, affidavits, appeals, revisions, correspondence, or payment records.",
  "Keep foundation and collateral-proceeding dates if they explain ownership, authority, limitation, parallel litigation, appeal delay, or enforceability.",
  "Do not decide the final chronology, merge duplicates, or drop uncertain but potentially material candidates.",
  "Every candidate must cite exactly one supplied citation in the form FILE-NNNN pX.bY.",
  "Use readable source labels when supplied, but raw FILE-NNNN pX.bY citations remain canonical.",
  "Mark OCR suspicion and date uncertainty instead of hiding it.",
  "Return one compact JSON object only, matching the requested schema.",
], {
  nativeSkill: "create_listofdates",
});

export const LIST_OF_DATES_EDITOR_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You are a careful Indian legal chronology editor.",
  "Convert a verbose candidate ledger into a lawyer-facing, client-perspective List of Dates.",
  "Use only the supplied candidate ledger and matter metadata.",
  "Merge duplicate or near-duplicate candidates into one final row while preserving useful supporting citations through the canonical citation field.",
  "Drop pure precedent, statute, or case-law dates unless they are part of this matter's own procedural history.",
  "Keep ownership, authority, limitation, collateral-proceeding, appeal-delay, and enforceability dates when they materially explain the matter.",
  "Use readable source labels for reasoning, but every final row must cite one raw FILE-NNNN pX.bY citation from the candidate ledger.",
  "Do not invent dates, facts, parties, citations, advocacy, or legal conclusions.",
  "Write legal_relevance as one source-supported sentence explaining why the event matters to the declared client's case.",
  "Use needs_review=true if OCR noise, ambiguity, or low source confidence makes the event uncertain.",
  "Return one compact JSON object only, matching the requested schema.",
], {
  nativeSkill: "create_listofdates",
});

export function createListOfDatesProvider({ task = AI_TASKS.SOURCE_BACKED_ANALYSIS, providerConfig, apiKey, env, fetchImpl, prompt = {}, providerService = null }) {
  if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
    return createOpenRouterProvider({
      apiKey: apiKey || env.OPENROUTER_API_KEY,
      endpoint: providerConfig.endpoint,
      fetchImpl,
      maxOutputTokens: providerConfig.maxOutputTokens,
      model: providerConfig.model,
      requireParameters: providerConfig.requireParameters,
      allowFallbacks: providerConfig.allowFallbacks,
      providerOrder: providerConfig.providerOrder,
      providerSort: providerConfig.providerSort,
      maxPrice: providerConfig.maxPrice,
      timeoutMs: providerConfig.timeoutMs,
      task,
      providerService,
      ...prompt,
    });
  }
  return createOpenAiProvider({
    apiKey: apiKey || env.OPENAI_API_KEY,
    model: providerConfig.model,
    endpoint: providerConfig.endpoint,
    maxOutputTokens: providerConfig.maxOutputTokens,
    task,
    providerService,
    ...prompt,
  });
}

export function createOpenAiProvider({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  endpoint = DEFAULT_RESPONSES_ENDPOINT,
  maxOutputTokens = DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  systemPrompt = LIST_OF_DATES_SYSTEM_PROMPT,
  payloadBuilder = listOfDatesPromptPayload,
  schemaName = "list_of_dates_chunk",
  schemaDescription = "Cited legal chronology entries extracted from source blocks.",
  task = AI_TASKS.SOURCE_BACKED_ANALYSIS,
  providerService = null,
} = {}) {
  const service = providerService || createAiProviderService({
    env: { OPENAI_API_KEY: apiKey || "", SOURCE_BACKED_ANALYSIS_PROVIDER: AI_PROVIDERS.OPENAI_DIRECT },
  });
  return async function openAiListOfDatesProvider({ matter, chunk, chunkIndex, chunkCount, candidates, schema }) {
    if (!apiKey && !providerService) {
      const error = new Error("OPENAI_API_KEY is required for /create_listofdates");
      error.statusCode = 409;
      throw error;
    }
    const result = await service.invoke({
      task,
      systemPrompt,
      userPayload: payloadBuilder({ matter, chunk, chunkIndex, chunkCount, candidates }),
      schema,
      schemaName,
      schemaDescription,
      responseMode: "json",
      overrides: {
        endpoint,
        model,
        maxOutputTokens,
      },
      label: "OpenAI list-of-dates",
    });
    return {
      ...result.parsed,
      ai_run: listOfDatesResponseAiRun(result.aiRun),
    };
  };
}

export function createOpenRouterProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  maxOutputTokens,
  model,
  providerOrder = [],
  providerSort = "",
  maxPrice = null,
  requireParameters = true,
  allowFallbacks = false,
  timeoutMs,
  systemPrompt = LIST_OF_DATES_SYSTEM_PROMPT,
  payloadBuilder = listOfDatesPromptPayload,
  schemaName = "list_of_dates_chunk",
  task = AI_TASKS.SOURCE_BACKED_ANALYSIS,
  providerService = null,
} = {}) {
  const service = providerService || createAiProviderService({
    env: { OPENROUTER_API_KEY: apiKey || "", SOURCE_BACKED_ANALYSIS_PROVIDER: AI_PROVIDERS.OPENROUTER },
    fetchImpl,
  });
  return async function openRouterListOfDatesProvider({ matter, chunk, chunkIndex, chunkCount, candidates, schema }) {
    if (!apiKey && !providerService) {
      const error = new Error("OPENROUTER_API_KEY is required for /create_listofdates");
      error.statusCode = 409;
      throw error;
    }
    if (!model) {
      const error = new Error("OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL is required for /create_listofdates");
      error.statusCode = 409;
      throw error;
    }

    let result;
    try {
      result = await service.invoke({
        task,
        systemPrompt,
        userPayload: payloadBuilder({ matter, chunk, chunkIndex, chunkCount, candidates }),
        schema,
        schemaName,
        responseMode: "json",
        overrides: {
          endpoint,
          model,
          maxOutputTokens,
          timeoutMs,
          providerOrder,
          providerSort,
          maxPrice,
          requireParameters,
          allowFallbacks,
          omitTemperature: true,
          extraHeaders: { "x-title": "Matter Workbench List of Dates" },
          mapProviderError: createOpenRouterProviderError,
        },
        label: "OpenRouter list-of-dates",
      });
    } catch (error) {
      if (error?.code === "provider.invalid_json") {
        const wrapped = new Error(error.message.replace("OpenRouter list-of-dates response was not valid JSON", "OpenRouter response did not include valid JSON message content"));
        wrapped.statusCode = error.statusCode || 502;
        wrapped.code = error.code;
        throw wrapped;
      }
      throw error;
    }
    return {
      ...result.parsed,
      ai_run: listOfDatesResponseAiRun(result.aiRun),
    };
  };
}

export function toOpenRouterCompatibleJsonSchema(schema) {
  return stripUnsupportedJsonSchemaKeywords(schema);
}

const OPENROUTER_STRICT_SCHEMA_UNSUPPORTED_KEYS = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "multipleOf",
  "pattern",
]);

function stripUnsupportedJsonSchemaKeywords(value) {
  if (Array.isArray(value)) return value.map(stripUnsupportedJsonSchemaKeywords);
  if (!value || typeof value !== "object") return value;
  const copy = {};
  for (const [key, child] of Object.entries(value)) {
    if (OPENROUTER_STRICT_SCHEMA_UNSUPPORTED_KEYS.has(key)) continue;
    copy[key] = stripUnsupportedJsonSchemaKeywords(child);
  }
  return copy;
}

function listOfDatesPromptPayload({ matter, chunk, chunkIndex, chunkCount }) {
  return {
    task: "Create list of dates from this chunk of extraction records.",
    matter,
    chunk_index: chunkIndex,
    chunk_count: chunkCount,
    instructions: [
      "Include exact calendar dates only when the source gives day, month, and year.",
      "Normalize dates to YYYY-MM-DD.",
      "Write event text as a concise lawyer-reviewable fact from the cited block.",
      `Write perspective exactly as ${LAWYER_FACING_PERSPECTIVE}.`,
      "Classify event_type using one allowed event type.",
      "Write legal_relevance as one source-supported sentence explaining why this event matters to the declared client's case.",
      "Prefer precise legal relevance forms: Supports that the client performed payment obligations; Rebuts any suggestion that the client was in default; Corroborates delay despite payment; Shows the opposing party had notice before responding; Preserves the client's objection.",
      "Avoid generic relevance text such as this event is relevant, this payment is relevant, crucial, or foundational.",
      "Use client-favourable legal framing only when the cited block supports it.",
      "Use issue_tags as short conservative review handles such as payment, delay, possession, notice, deadline, contradiction, admission, denial, objection, evidence_gap, procedure, or damages.",
      "Use claimed, denied, alleged, states, or records for disputed facts; do not present disputed allegations as proven.",
      "Frame opposing-party responses as demands, denials, acknowledgements, or notices; do not characterize them as willingness to resolve or accommodate.",
      "For hardship, hospitalization, or medical facts, write may support hardship or consequential prejudice, subject to proof.",
      "Exclude transcript-recorded, email-export, file-export, and vakalatnama-executed metadata rows unless the cited block makes them legally material to the merits chronology.",
      "Do not say fraud, bad faith, breach, breach proved, liability admitted, or equivalent unless the cited block itself says it.",
      "Do not repeat raw FILE-NNNN pX.bY citations inside event or legal_relevance text; use the citation field only.",
      "Do not collapse multiple same-day events when they carry different legal meaning or different citations.",
      "Use needs_review=true if OCR noise, ambiguity, or low source confidence makes the event uncertain.",
      "Ignore bare years, statute years, section numbers, page numbers, and unrelated citation years unless tied to an event in the source block.",
    ],
    allowed_event_types: EVENT_TYPES,
    source_blocks: chunk.map((block) => ({
      citation: block.citation,
      source: block.source_label || block.original_name || block.source_path,
      short_source: block.source_short_label || block.original_name || "",
      confidence: block.confidence,
      needs_review: block.needs_review,
      text: block.text,
    })),
  };
}

export function listOfDatesCandidatePromptPayload({ matter, chunk, chunkIndex, chunkCount }) {
  return {
    task: "Create a verbose candidate ledger for a later List of Dates editor pass.",
    matter,
    chunk_index: chunkIndex,
    chunk_count: chunkCount,
    instructions: [
      "Harvest exact calendar dates only when the source gives day, month, and year.",
      "Keep repeated versions of the same legal fact; do not merge them in pass 1.",
      "Keep foundation, authority, limitation, collateral-proceeding, appeal-delay, and enforceability dates if they may help a lawyer understand the matter.",
      "Drop obvious metadata dates such as file export, transcript recording, or index creation unless the block itself makes them legally material.",
      "Use one supplied FILE-NNNN pX.bY citation per candidate.",
      "Write legal_materiality as a short reason why a lawyer might care about this date.",
      "Use source_excerpt to preserve the decisive words from the source block.",
      "Use same_fact_hint to point out likely duplicates or related candidates, but do not remove them.",
      "Use ocr_suspicion and date_uncertainty when the source text is unclear.",
    ],
    source_blocks: chunk.map((block) => ({
      citation: block.citation,
      source: block.source_label || block.original_name || block.source_path,
      short_source: block.source_short_label || block.original_name || "",
      confidence: block.confidence,
      needs_review: block.needs_review,
      text: block.text,
    })),
  };
}

export function listOfDatesEditorPromptPayload({ matter, candidates }) {
  return {
    task: "Edit a verbose candidate ledger into the final lawyer-facing List of Dates.",
    matter,
    instructions: [
      "Use only these candidates.",
      "Merge duplicate and near-duplicate candidates into one final row.",
      "Preserve material collateral dates when they explain ownership, authority, limitation, parallel litigation, appeal delay, or enforceability.",
      "Drop pure precedent or statute dates unless they describe this matter's own procedural history.",
      "Use the final event and legal_relevance fields to write a client-perspective chronology supported by the cited candidate.",
      `Write perspective exactly as ${LAWYER_FACING_PERSPECTIVE}.`,
      "Use one raw FILE-NNNN pX.bY citation from the candidate ledger for each final row.",
      "Do not repeat raw citations inside event or legal_relevance text.",
      "Use needs_review=true when OCR noise, uncertainty, or candidate conflict remains.",
    ],
    allowed_event_types: EVENT_TYPES,
    candidates: candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      date_iso: candidate.date_iso,
      date_text: candidate.date_text,
      event_candidate: candidate.event_candidate,
      legal_materiality: candidate.legal_materiality,
      citation: candidate.citation,
      source_label: candidate.source_label || candidate.original_name || candidate.source_path,
      source_excerpt: candidate.source_excerpt,
      candidate_type: candidate.candidate_type,
      party_posture: candidate.party_posture,
      same_fact_hint: candidate.same_fact_hint,
      date_uncertainty: candidate.date_uncertainty,
      ocr_suspicion: candidate.ocr_suspicion,
      needs_review: candidate.needs_review,
    })),
  };
}

function listOfDatesResponseAiRun(aiRun = {}) {
  const responseAiRun = {};
  if (aiRun.returnedModel) responseAiRun.returnedModel = aiRun.returnedModel;
  if (aiRun.returnedProvider) responseAiRun.returnedProvider = aiRun.returnedProvider;
  if (aiRun.usage) responseAiRun.usage = aiRun.usage;
  return responseAiRun;
}

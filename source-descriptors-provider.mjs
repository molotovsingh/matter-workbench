import { modelPolicyMetadata, resolveProviderConfig } from "./shared/ai-provider-policy.mjs";
import {
  LEGAL_WORKBENCH_POLICY_PROMPT_VERSION,
  legalWorkbenchSystemPrompt,
} from "./shared/legal-workbench-policy-prompt.mjs";
import { SOURCE_INDEX_RELATIVE } from "./shared/matter-artifacts.mjs";
import { AI_TASKS, resolveModelPolicy } from "./shared/model-policy.mjs";
import {
  createOpenRouterProviderError,
  parseOpenRouterJsonContent,
} from "./shared/openrouter-response.mjs";
import { fetchProviderJsonWithTimeout } from "./shared/provider-http.mjs";

const SOURCE_DESCRIPTOR_TASK_INSTRUCTIONS = [
  "You create source descriptors for legal matter source documents.",
  "Follow the Source Descriptors contract: keep FILE-NNNN citations canonical, add human-readable document labels, and never overstate weak evidence.",
  "When a reliable document date is known, include that date in display_label.",
  "In display_label and short_label, write dates in lawyer-readable form such as 20 April 2026, not ISO form such as 2026-04-20.",
  "Use the strongest date_basis: email_header for email headers, court_order_date for court order headings, and file_name only when the filename is the best reliable evidence.",
  "document_date must be null or a real ISO calendar date in YYYY-MM-DD form.",
  "If source text says the document is blurred, unclear, or low confidence, do not use a filename date as the document_date; use null, date_basis unknown, needs_review true, and lower confidence.",
  "For unknown party string fields, return an empty string, not None, unknown, or N/A.",
  "Do not include FILE-NNNN identifiers in display_label or short_label; those identifiers belong only in file_id, evidence citations, and audit fields.",
  "The backend owns source identity fields such as hashes and paths; use file_id only to attach your labels and evidence to the supplied source packet.",
  "Return JSON only in the requested schema.",
  "Use only the supplied source packets.",
];

const SOURCE_DESCRIPTOR_SYSTEM_PROMPT = legalWorkbenchSystemPrompt(SOURCE_DESCRIPTOR_TASK_INSTRUCTIONS, {
  nativeSkill: "source_labels",
});

const SOURCE_INDEX_SCHEMA_VERSION = "source-index/v1";

export function createOpenRouterSourceDescriptorProvider({
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
} = {}) {
  return async function openRouterSourceDescriptorProvider({ matter, sources, schema }) {
    if (!apiKey) {
      const error = new Error("OPENROUTER_API_KEY is required for source description");
      error.statusCode = 409;
      throw error;
    }
    if (!model) {
      const error = new Error("OPENROUTER_SOURCE_DESCRIPTION_MODEL is required for source description");
      error.statusCode = 409;
      throw error;
    }

    const body = buildOpenRouterSourceDescriptorRequest({
      allowFallbacks,
      maxOutputTokens,
      maxPrice,
      matter,
      model,
      providerOrder,
      providerSort,
      requireParameters,
      schema,
      sources,
    });

    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      timeoutMs,
      extraHeaders: {
        "http-referer": "https://github.com/molotovsingh/matter-workbench",
        "x-title": "Matter Workbench Source Descriptors",
      },
      timeoutMessage: `OpenRouter source description request timed out after ${timeoutMs}ms`,
      isErrorPayload: ({ response }) => !response.ok,
      mapProviderError: createOpenRouterProviderError,
      body,
    });

    return parseOpenRouterJsonContent(payload);
  };
}

export function resolveSourceDescriptorProvider(options) {
  const injectedProvider = options.provider || options.sourceDescriptorProvider;
  if (typeof injectedProvider === "function") {
    return {
      provider: injectedProvider,
      aiRun: options.aiRun || fakeProviderMetadata(),
    };
  }

  const env = options.env || process.env;
  const policy = resolveModelPolicy(AI_TASKS.SOURCE_DESCRIPTION, { env });
  const model = options.model || policy.model;
  if (!model) {
    throw new Error("sourceDescriptorProvider is required unless OPENROUTER_SOURCE_DESCRIPTION_MODEL is configured.");
  }
  const fallbackModel = normalizeFallbackModel(options.fallbackModel || env.OPENROUTER_SOURCE_DESCRIPTION_FALLBACK_MODEL, model);
  const providerConfig = resolveProviderConfig(policy, {
    endpoint: options.endpoint,
    maxPrice: options.maxPrice,
    maxOutputTokens: options.maxOutputTokens,
    model,
    providerOrder: options.providerOrder,
    providerSort: options.providerSort,
    timeoutMs: options.timeoutMs,
  });
  const primaryProvider = createOpenRouterSourceDescriptorProvider({
    apiKey: options.apiKey || env.OPENROUTER_API_KEY,
    endpoint: providerConfig.endpoint,
    fetchImpl: options.fetchImpl || fetch,
    maxOutputTokens: providerConfig.maxOutputTokens,
    model: providerConfig.model,
    providerOrder: providerConfig.providerOrder,
    providerSort: providerConfig.providerSort,
    maxPrice: providerConfig.maxPrice,
    requireParameters: providerConfig.requireParameters,
    allowFallbacks: providerConfig.allowFallbacks,
    timeoutMs: providerConfig.timeoutMs,
  });
  const fallbackProvider = fallbackModel
    ? createOpenRouterSourceDescriptorProvider({
      apiKey: options.apiKey || env.OPENROUTER_API_KEY,
      endpoint: providerConfig.endpoint,
      fetchImpl: options.fetchImpl || fetch,
      maxOutputTokens: providerConfig.maxOutputTokens,
      model: fallbackModel,
      providerOrder: providerConfig.providerOrder,
      providerSort: providerConfig.providerSort,
      maxPrice: providerConfig.maxPrice,
      requireParameters: providerConfig.requireParameters,
      allowFallbacks: providerConfig.allowFallbacks,
      timeoutMs: providerConfig.timeoutMs,
    })
    : null;
  const aiRun = options.aiRun || {
    ...modelPolicyMetadata(policy, providerConfig),
    ...(fallbackModel ? {
      fallbackModel,
      fallbackStrategy: "approved_model_after_primary_failure",
    } : {}),
  };
  return {
    provider: fallbackProvider
      ? createApprovedFallbackSourceDescriptorProvider({ primaryProvider, fallbackProvider, fallbackModel })
      : primaryProvider,
    aiRun,
  };
}

function createApprovedFallbackSourceDescriptorProvider({ primaryProvider, fallbackProvider, fallbackModel }) {
  return async function approvedFallbackSourceDescriptorProvider(args) {
    try {
      return await primaryProvider(args);
    } catch (primaryError) {
      const fallbackResult = await fallbackProvider(args);
      return {
        ...fallbackResult,
        ai_run: {
          ...(fallbackResult.ai_run || {}),
          fallbackUsed: true,
          fallbackModel,
          primaryError: summarizeProviderError(primaryError),
        },
      };
    }
  };
}

function summarizeProviderError(error) {
  return {
    statusCode: error?.statusCode || 502,
    message: error?.message || String(error || "Source descriptor primary provider failed"),
    ...(error?.providerName ? { providerName: error.providerName } : {}),
    ...(error?.openRouterCode ? { openRouterCode: error.openRouterCode } : {}),
  };
}

function normalizeFallbackModel(value, primaryModel) {
  const fallbackModel = String(value || "").trim();
  if (!fallbackModel || fallbackModel === String(primaryModel || "").trim()) return "";
  return fallbackModel;
}

export function mergeAiRunMetadata(baseAiRun, responseAiRun) {
  if (!responseAiRun || typeof responseAiRun !== "object" || Array.isArray(responseAiRun)) return baseAiRun;
  return {
    ...baseAiRun,
    ...responseAiRun,
  };
}

function buildOpenRouterSourceDescriptorRequest({
  allowFallbacks,
  maxOutputTokens,
  maxPrice,
  matter,
  model,
  providerOrder,
  providerSort,
  requireParameters,
  schema,
  sources,
}) {
  const body = {
    model,
    messages: [
      {
        role: "system",
        content: SOURCE_DESCRIPTOR_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Create source descriptors for these source packets.",
          matter,
          contract_summary: {
            artifact: SOURCE_INDEX_RELATIVE,
            schema_version: SOURCE_INDEX_SCHEMA_VERSION,
            descriptor_key: ["file_id"],
            evidence_required: true,
            source_identity_owned_by_backend: true,
            display_label_should_include_reliable_document_date: true,
            raw_citations_remain_canonical: true,
            source_text_beats_filename_for_date_basis: true,
            prefer_unknown_over_guess: true,
          },
          sources,
        }),
      },
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
        name: "source_index",
        strict: true,
        schema,
      },
    },
  };
  if (providerOrder.length) body.provider.order = providerOrder;
  if (providerSort) body.provider.sort = providerSort;
  if (maxPrice) body.provider.max_price = maxPrice;
  return body;
}

function fakeProviderMetadata() {
  return {
    policyVersion: "source-index-skeleton/v1",
    policyPromptVersion: LEGAL_WORKBENCH_POLICY_PROMPT_VERSION,
    task: "source_description",
    tier: "source_description",
    provider: "fake-provider",
    model: "injected-test-provider",
    maxOutputTokens: null,
    fallback: "none",
  };
}

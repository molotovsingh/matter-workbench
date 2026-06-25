import { resolveProviderConfig, modelPolicyMetadata } from "../shared/ai-provider-policy.mjs";
import { AI_PROVIDERS, AI_TASKS, listModelPolicyTasks, resolveModelPolicy } from "../shared/model-policy.mjs";
import { openRouterTemperatureParams } from "../shared/openrouter-model-params.mjs";
import {
  extractOpenAiOutputText,
  extractOpenRouterMessageText,
  fetchProviderJsonWithTimeout,
  parseOpenAiJsonOutput,
  parseOpenRouterJsonMessage,
} from "../shared/provider-http.mjs";
import { AI_RUN_CONTEXT_FIELDS, normalizeAiRunMetadata } from "../shared/ai-run-metadata.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

const OPENROUTER_APP_HEADERS = Object.freeze({
  "http-referer": "https://github.com/molotovsingh/matter-workbench",
  "x-title": "Matter Workbench",
});

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

const PING_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
  },
});

export function createAiProviderService({
  env = process.env,
  fetchImpl = fetch,
  endpoint,
  openRouterEndpoint,
  ocrProviders = {},
} = {}) {
  function resolveTask(task, overrides = {}) {
    const policy = resolveModelPolicy(task, { env });
    const providerConfig = resolveProviderConfig(policy, {
      endpoint: policy.provider === AI_PROVIDERS.OPENROUTER
        ? (overrides.endpoint || openRouterEndpoint)
        : (overrides.endpoint || endpoint),
      model: overrides.model,
      maxOutputTokens: overrides.maxOutputTokens,
      timeoutMs: overrides.timeoutMs,
      providerOrder: overrides.providerOrder,
      providerSort: overrides.providerSort,
      maxPrice: overrides.maxPrice,
    });
    if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
      if (typeof overrides.requireParameters === "boolean") providerConfig.requireParameters = overrides.requireParameters;
      if (typeof overrides.allowFallbacks === "boolean") providerConfig.allowFallbacks = overrides.allowFallbacks;
    }
    return {
      policy,
      providerConfig,
      aiRun: buildAiRunMetadata({ policy, providerConfig }),
    };
  }

  async function invoke({
    task,
    systemPrompt = "",
    userPayload = {},
    schema = null,
    schemaName = "",
    schemaDescription = "",
    responseMode = schema ? "json" : "text",
    overrides = {},
    label = "",
  } = {}) {
    if (!task) throw makeHttpError("AI task is required.", 400, "ai_provider.task_required");
    const { policy, providerConfig } = resolveTask(task, overrides);
    const startedAt = new Date().toISOString();
    const normalizedResponseMode = responseMode === "json" || schema ? "json" : "text";
    const payloadLabel = label || labelForTask(task, providerConfig.provider);

    if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
      assertApiKey(env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY is required for this AI task", "ai_provider.openrouter_api_key_required");
      const body = buildOpenRouterBody({
        providerConfig,
        systemPrompt,
        userPayload,
        schema,
        schemaName: schemaName || schemaNameForTask(task),
      });
      const rawPayload = await fetchProviderJsonWithTimeout({
        fetchImpl,
        endpoint: providerConfig.endpoint,
        apiKey: env.OPENROUTER_API_KEY,
        body,
        timeoutMs: providerConfig.timeoutMs,
        extraHeaders: OPENROUTER_APP_HEADERS,
        timeoutMessage: `OpenRouter ${task} request timed out after ${providerConfig.timeoutMs}ms`,
      });
      const parsed = normalizedResponseMode === "json"
        ? parseOpenRouterJsonMessage(rawPayload, payloadLabel)
        : extractOpenRouterMessageText(rawPayload, payloadLabel);
      return {
        parsed,
        aiRun: buildAiRunMetadata({ policy, providerConfig, rawPayload, startedAt, finishedAt: new Date().toISOString() }),
        rawPayload,
      };
    }

    assertApiKey(env.OPENAI_API_KEY, "OPENAI_API_KEY is required for this AI task", "ai_provider.openai_api_key_required");
    const body = buildOpenAiBody({
      providerConfig,
      systemPrompt,
      userPayload,
      schema,
      schemaName: schemaName || schemaNameForTask(task),
      schemaDescription,
    });
    const rawPayload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint: providerConfig.endpoint,
      apiKey: env.OPENAI_API_KEY,
      body,
      timeoutMs: providerConfig.timeoutMs,
      timeoutMessage: `OpenAI ${task} request timed out after ${providerConfig.timeoutMs}ms`,
    });
    const parsed = normalizedResponseMode === "json"
      ? parseOpenAiJsonOutput(rawPayload, payloadLabel)
      : extractOpenAiOutputText(rawPayload, payloadLabel);
    return {
      parsed,
      aiRun: buildAiRunMetadata({ policy, providerConfig, rawPayload, startedAt, finishedAt: new Date().toISOString() }),
      rawPayload,
    };
  }

  async function invokeOcr({ provider = "", pdfPath = "", pageCount = 0, ...rest } = {}) {
    const providerName = String(provider || "").trim().toLowerCase();
    const adapter = providerName ? ocrProviders[providerName] : null;
    if (typeof adapter !== "function") {
      throw makeHttpError(
        "OCR provider boundary is not configured yet.",
        501,
        "ai_provider.ocr_not_configured",
      );
    }
    const startedAt = new Date().toISOString();
    const rawPayload = await adapter({ pdfPath, pageCount, ...rest });
    const pages = Array.isArray(rawPayload?.pages) ? rawPayload.pages : [];
    return {
      pages,
      aiRun: buildOcrAiRunMetadata({ provider: providerName, rawPayload, startedAt, finishedAt: new Date().toISOString() }),
      rawPayload,
    };
  }

  async function ping(task = AI_TASKS.COPILOT_ANSWER) {
    const started = Date.now();
    let resolved = null;
    try {
      resolved = resolveTask(task);
      const result = await invoke({
        task,
        systemPrompt: "Return JSON only. Confirm the configured provider can answer a trivial health check.",
        userPayload: { task: "provider_ping", expected: { ok: true } },
        schema: PING_SCHEMA,
        schemaName: "provider_ping",
        responseMode: "json",
        label: "AI provider ping",
      });
      return {
        ok: true,
        task,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        provider: resolved.providerConfig.provider,
        model: resolved.providerConfig.model,
        aiRun: result.aiRun,
      };
    } catch (error) {
      return {
        ok: false,
        task,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        provider: resolved?.providerConfig?.provider || "",
        model: resolved?.providerConfig?.model || "",
        code: error?.code || "ai_provider.ping_failed",
        error: error?.message || "AI provider ping failed",
      };
    }
  }

  function settingsSummary({ tasks = listModelPolicyTasks() } = {}) {
    return {
      schema_version: "ai-provider-settings-summary/v1",
      tasks: tasks.map((task) => {
        const { policy, providerConfig, aiRun } = resolveTask(task);
        return {
          task,
          tier: policy.tier,
          provider: providerConfig.provider,
          model: providerConfig.model,
          maxOutputTokens: providerConfig.maxOutputTokens,
          timeoutMs: providerConfig.timeoutMs || null,
          fallback: policy.fallback,
          apiKeyConfigured: apiKeyConfiguredForProvider(providerConfig.provider, env),
          aiRun,
        };
      }),
    };
  }

  return {
    invoke,
    invokeOcr,
    ping,
    resolveTask,
    settingsSummary,
  };
}

function buildOpenAiBody({ providerConfig, systemPrompt, userPayload, schema, schemaName, schemaDescription }) {
  const body = {
    model: providerConfig.model,
    max_output_tokens: providerConfig.maxOutputTokens,
    input: [
      { role: "system", content: String(systemPrompt || "") },
      { role: "user", content: stringifyUserPayload(userPayload) },
    ],
  };
  if (schema) {
    body.text = {
      format: {
        type: "json_schema",
        name: schemaName,
        ...(schemaDescription ? { description: schemaDescription } : {}),
        strict: true,
        schema,
      },
    };
  }
  return body;
}

function buildOpenRouterBody({ providerConfig, systemPrompt, userPayload, schema, schemaName }) {
  const body = {
    model: providerConfig.model,
    messages: [
      { role: "system", content: String(systemPrompt || "") },
      { role: "user", content: stringifyUserPayload(userPayload) },
    ],
    ...openRouterTemperatureParams(providerConfig.model, 0),
    max_tokens: providerConfig.maxOutputTokens,
    provider: {
      require_parameters: providerConfig.requireParameters,
      allow_fallbacks: providerConfig.allowFallbacks,
    },
  };
  if (Array.isArray(providerConfig.providerOrder) && providerConfig.providerOrder.length) {
    body.provider.order = providerConfig.providerOrder;
  }
  if (providerConfig.providerSort) body.provider.sort = providerConfig.providerSort;
  if (providerConfig.maxPrice) body.provider.max_price = providerConfig.maxPrice;
  if (schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        strict: true,
        schema: toOpenRouterCompatibleJsonSchema(schema),
      },
    };
  }
  return body;
}

function buildAiRunMetadata({ policy, providerConfig, rawPayload = null, startedAt = "", finishedAt = "" }) {
  const usage = normalizeProviderUsage(rawPayload);
  return normalizeAiRunMetadata({
    ...modelPolicyMetadata(policy, providerConfig),
    returnedModel: returnedModel(rawPayload),
    returnedProvider: returnedProvider(rawPayload),
    ...(usage ? { usage } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
  }, {
    fields: AI_RUN_CONTEXT_FIELDS,
    includeUsage: true,
  });
}

function buildOcrAiRunMetadata({ provider, rawPayload = null, startedAt = "", finishedAt = "" }) {
  const usage = normalizeProviderUsage(rawPayload);
  return normalizeAiRunMetadata({
    provider,
    model: rawPayload?.engine || rawPayload?.model || provider,
    task: "ocr",
    ...(usage ? { usage } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
  }, {
    fields: ["provider", "model", "task"],
    includeUsage: true,
  });
}

function normalizeProviderUsage(payload) {
  const usage = payload?.usage || payload?.usage_metadata;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const normalized = {};
  const promptTokens = firstNumber(usage.prompt_tokens, usage.input_tokens, usage.promptTokenCount);
  const completionTokens = firstNumber(usage.completion_tokens, usage.output_tokens, usage.candidatesTokenCount);
  const totalTokens = firstNumber(usage.total_tokens, usage.totalTokenCount);
  if (promptTokens !== null) normalized.promptTokens = promptTokens;
  if (completionTokens !== null) normalized.completionTokens = completionTokens;
  if (totalTokens !== null) normalized.totalTokens = totalTokens;
  return Object.keys(normalized).length ? normalized : null;
}

function returnedModel(payload) {
  return String(payload?.model || payload?.model_name || payload?.choices?.[0]?.model || "").trim();
}

function returnedProvider(payload) {
  return String(payload?.provider || payload?.provider_name || payload?.choices?.[0]?.provider || "").trim();
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function assertApiKey(apiKey, message, code) {
  if (String(apiKey || "").trim()) return;
  throw makeHttpError(message, 409, code);
}

function apiKeyConfiguredForProvider(provider, env = {}) {
  if (provider === AI_PROVIDERS.OPENROUTER) return Boolean(String(env.OPENROUTER_API_KEY || "").trim());
  if (provider === AI_PROVIDERS.OPENAI_DIRECT) return Boolean(String(env.OPENAI_API_KEY || "").trim());
  return false;
}

function stringifyUserPayload(userPayload) {
  if (typeof userPayload === "string") return userPayload;
  return JSON.stringify(userPayload ?? {});
}

function schemaNameForTask(task) {
  return `${String(task || "ai_task").toLowerCase().replace(/[^a-z0-9_]+/g, "_")}_response`;
}

function labelForTask(task, provider) {
  return `${provider === AI_PROVIDERS.OPENROUTER ? "OpenRouter" : "OpenAI"} ${task}`;
}

function toOpenRouterCompatibleJsonSchema(schema) {
  return stripUnsupportedJsonSchemaKeywords(schema);
}

function stripUnsupportedJsonSchemaKeywords(value) {
  if (Array.isArray(value)) return value.map(stripUnsupportedJsonSchemaKeywords);
  if (!value || typeof value !== "object") return value;
  const cleaned = {};
  for (const [key, child] of Object.entries(value)) {
    if (OPENROUTER_STRICT_SCHEMA_UNSUPPORTED_KEYS.has(key)) continue;
    cleaned[key] = stripUnsupportedJsonSchemaKeywords(child);
  }
  return cleaned;
}

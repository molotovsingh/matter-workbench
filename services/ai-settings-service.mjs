import path from "node:path";
import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
} from "../shared/ai-defaults.mjs";
import { extractResponsesOutputText } from "../shared/responses-client.mjs";
import {
  classifyProviderErrorCode,
  providerErrorMessageForCode,
} from "../shared/provider-http.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { upsertLocalEnv } from "../shared/local-env.mjs";
import {
  AI_PROVIDERS,
  AI_TASKS,
  DEFAULT_OPENROUTER_ENDPOINT,
  resolveModelPolicy,
} from "../shared/model-policy.mjs";
import { openRouterTemperatureParams } from "../shared/openrouter-model-params.mjs";

const OPENAI_KEY_PATTERN = /^sk-[A-Za-z0-9_-]+$/;
const COPILOT_PROVIDER_ENV_KEY = "COPILOT_ANSWER_PROVIDER";
const OPENAI_COPILOT_MODEL_ENV_KEY = "OPENAI_COPILOT_ANSWER_MODEL";
const OPENROUTER_COPILOT_MODEL_ENV_KEY = "OPENROUTER_COPILOT_ANSWER_MODEL";
const COPILOT_MODEL_CHECK_TIMEOUT_MS = 30_000;
const COPILOT_MODEL_CHECK_MAX_TOKENS = 128;
const COPILOT_MODEL_CHECK_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
  },
});

const AI_TASK_STATUS = [
  {
    task: AI_TASKS.SKILL_ROUTER,
    label: "Skill router",
    surface: "AI command routing",
    modelEnvKey: "OPENAI_MODEL",
  },
  {
    task: AI_TASKS.SOURCE_DESCRIPTION,
    label: "/describe_sources",
    surface: "Source Index.json labels",
    modelEnvKey: "OPENROUTER_SOURCE_DESCRIPTION_MODEL",
  },
  {
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    label: "/create_listofdates",
    surface: "List of Dates chronology",
    modelEnvKey: "OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL",
  },
  {
    task: AI_TASKS.COPILOT_ANSWER,
    label: "Matter Copilot",
    surface: "Source-backed matter Q&A",
    modelEnvKey: "OPENAI_COPILOT_ANSWER_MODEL",
    openRouterModelEnvKey: "OPENROUTER_COPILOT_ANSWER_MODEL",
  },
];

export function createAiSettingsService({
  appDir,
  env = process.env,
  endpoint = "https://api.openai.com/v1/responses",
  openRouterEndpoint = DEFAULT_OPENROUTER_ENDPOINT,
  fetchImpl = fetch,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  let latestCopilotCheck = null;

  function readSettings() {
    return {
      provider: "OpenAI",
      apiKeyConfigured: Boolean(env.OPENAI_API_KEY),
      model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      maxOutputTokens: parsePositiveInteger(env.OPENAI_MAX_OUTPUT_TOKENS) || DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
      envPath: path.join(root, ".env"),
      aiTasks: readAiTaskStatuses(),
      startupChecks: latestCopilotCheck ? { copilot: latestCopilotCheck } : {},
    };
  }

  async function saveSettings(raw = {}) {
    const values = {};
    const hasCopilotFields = hasAnyOwnProperty(raw, ["copilotProvider", "copilotModel", "copilotApiKey"]);
    const hasGlobalFields = hasAnyOwnProperty(raw, ["apiKey", "model", "maxOutputTokens"]);

    if (hasGlobalFields || !hasCopilotFields) {
      Object.assign(values, normalizeGlobalAiSettings(raw));
    }

    let shouldPingCopilot = false;
    if (hasCopilotFields) {
      Object.assign(values, normalizeCopilotSettings(raw));
      shouldPingCopilot = true;
    }

    if (shouldPingCopilot) await pingCopilotSettings({ env: { ...env, ...values } });

    await upsertLocalEnv({ appDir: root, values });
    Object.assign(env, values);
    return readSettings();
  }

  async function checkCopilotModel({ provider = "", model = "" } = {}) {
    const policy = resolveModelPolicy(AI_TASKS.COPILOT_ANSWER, { env });
    const resolvedProvider = provider || policy.provider;
    const resolvedModel = model || policy.model;
    const candidateEnv = {
      ...env,
      [COPILOT_PROVIDER_ENV_KEY]: resolvedProvider,
      ...(resolvedProvider === AI_PROVIDERS.OPENROUTER
        ? { [OPENROUTER_COPILOT_MODEL_ENV_KEY]: resolvedModel }
        : { [OPENAI_COPILOT_MODEL_ENV_KEY]: resolvedModel }),
    };
    const started = Date.now();
    try {
      await pingCopilotSettings({ env: candidateEnv });
      latestCopilotCheck = {
        ok: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        provider: resolvedProvider,
        model: resolvedModel,
      };
    } catch (error) {
      latestCopilotCheck = {
        ok: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        provider: resolvedProvider,
        model: resolvedModel,
        error: redactSensitiveText(error?.message || "Matter Copilot model check failed"),
        code: error?.code || "provider.error",
        statusCode: error?.statusCode || 503,
      };
    }
    return latestCopilotCheck;
  }

  async function testConnection() {
    const settings = readSettings();
    if (!env.OPENAI_API_KEY) {
      const error = new Error("OPENAI_API_KEY is not configured");
      error.statusCode = 409;
      throw error;
    }

    const started = Date.now();
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        input: "Reply with exactly: ok",
        max_output_tokens: 16,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `OpenAI returned ${response.status}`);
      error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
      throw redactedAiSettingsError(error, "OpenAI test connection failed");
    }

    return {
      ok: true,
      provider: settings.provider,
      model: settings.model,
      latencyMs: Date.now() - started,
    };
  }

  return {
    checkCopilotModel,
    readSettings,
    saveSettings,
    testConnection,
  };

  function readAiTaskStatuses() {
    return AI_TASK_STATUS.map((item) => {
      try {
        const policy = resolveModelPolicy(item.task, { env });
        const apiKeyEnvKey = policy.provider === AI_PROVIDERS.OPENROUTER
          ? "OPENROUTER_API_KEY"
          : "OPENAI_API_KEY";
        const apiKeyConfigured = Boolean(env[apiKeyEnvKey]);
        const modelConfigured = Boolean(policy.model);
        const modelEnvKey = policy.provider === AI_PROVIDERS.OPENROUTER
          ? item.openRouterModelEnvKey || item.modelEnvKey
          : item.modelEnvKey;
        const missing = [];
        if (!apiKeyConfigured) missing.push(`${apiKeyEnvKey} missing`);
        if (!modelConfigured) missing.push(`${modelEnvKey} missing`);
        return {
          task: policy.task,
          label: item.label,
          surface: item.surface,
          provider: policy.provider,
          model: policy.model,
          maxOutputTokens: policy.maxOutputTokens,
          timeoutMs: policy.timeoutMs || null,
          fallback: policy.fallback,
          apiKeyConfigured,
          modelConfigured,
          ready: apiKeyConfigured && modelConfigured,
          note: missing.length ? missing.join("; ") : "Ready",
        };
      } catch (error) {
        return {
          task: item.task,
          label: item.label,
          surface: item.surface,
          provider: "",
          model: "",
          maxOutputTokens: null,
          timeoutMs: null,
          fallback: "",
          apiKeyConfigured: false,
          modelConfigured: false,
          ready: false,
          note: error.message,
          error: error.message,
        };
      }
    });
  }

  async function pingCopilotSettings({ env: candidateEnv }) {
    const provider = candidateEnv[COPILOT_PROVIDER_ENV_KEY] || AI_PROVIDERS.OPENAI_DIRECT;
    const model = provider === AI_PROVIDERS.OPENROUTER
      ? candidateEnv[OPENROUTER_COPILOT_MODEL_ENV_KEY]
      : candidateEnv[OPENAI_COPILOT_MODEL_ENV_KEY];
    const apiKeyEnvKey = provider === AI_PROVIDERS.OPENROUTER ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
    const apiKey = candidateEnv[apiKeyEnvKey];

    if (!apiKey) {
      const error = new Error(`${apiKeyEnvKey} is required to test the selected Matter Copilot model`);
      error.statusCode = 409;
      throw error;
    }

    if (!model) {
      const error = new Error("Matter Copilot model is required");
      error.statusCode = 400;
      throw error;
    }

    if (provider === AI_PROVIDERS.OPENROUTER) {
      await pingOpenRouterCopilot({ apiKey, model });
      return;
    }
    await pingOpenAiCopilot({ apiKey, model });
  }

  async function pingOpenAiCopilot({ apiKey, model }) {
    await fetchCopilotPingJson({
      provider: "OpenAI",
      url: endpoint,
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: "Return JSON matching the schema with ok set to true.",
        max_output_tokens: COPILOT_MODEL_CHECK_MAX_TOKENS,
        text: {
          format: {
            type: "json_schema",
            name: "matter_copilot_model_check",
            strict: true,
            schema: COPILOT_MODEL_CHECK_SCHEMA,
          },
        },
      }),
    });
  }

  async function pingOpenRouterCopilot({ apiKey, model }) {
    await fetchCopilotPingJson({
      provider: "OpenRouter",
      url: openRouterEndpoint,
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
        "http-referer": "https://github.com/molotovsingh/matter-workbench",
        "x-title": "Matter Workbench Matter Copilot Settings Check",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "user", content: "Return JSON matching the schema with ok set to true." },
        ],
        ...openRouterTemperatureParams(model, 0),
        max_tokens: COPILOT_MODEL_CHECK_MAX_TOKENS,
        provider: {
          require_parameters: true,
          allow_fallbacks: false,
        },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "matter_copilot_model_check",
            strict: true,
            schema: COPILOT_MODEL_CHECK_SCHEMA,
          },
        },
      }),
    });
  }

  async function fetchCopilotPingJson({ provider, url, headers, body }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COPILOT_MODEL_CHECK_TIMEOUT_MS);
    let response;
    let payload;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      payload = await response.json().catch((error) => {
        if (controller.signal.aborted || error?.name === "AbortError") throw error;
        return null;
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        const timeout = new Error(`Matter Copilot model check timed out after ${COPILOT_MODEL_CHECK_TIMEOUT_MS}ms`);
        timeout.statusCode = 504;
        throw timeout;
      }
      throw redactedAiSettingsError(error, "Matter Copilot model check failed");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok || payload?.error) {
      throwCopilotPingError(provider, response, payload);
    }
    assertCopilotPingPayload(provider, payload);
    return payload;
  }
}

function throwCopilotPingError(provider, response, payload) {
  const choiceError = Array.isArray(payload?.choices)
    ? payload.choices.find((choice) => choice?.error)?.error
    : null;
  const providerPayload = { error: payload?.error || choiceError };
  const rawMessage = redactSensitiveText(
    payload?.error?.message || choiceError?.message || `${provider} returned ${response?.status || "an error"}`,
  );
  const code = classifyProviderErrorCode(providerPayload, rawMessage);
  const message = providerErrorMessageForCode(code, rawMessage);
  const error = new Error(`Matter Copilot model check failed: ${message}`);
  error.statusCode = response?.status >= 400 && response.status < 500 ? 502 : 503;
  error.code = code;
  throw error;
}

function redactedAiSettingsError(error, fallbackMessage) {
  const message = redactSensitiveText(error?.message || fallbackMessage);
  const safe = new Error(message || fallbackMessage);
  safe.statusCode = error?.statusCode || 503;
  return safe;
}

function assertCopilotPingPayload(provider, payload) {
  const choiceError = Array.isArray(payload?.choices)
    ? payload.choices.find((choice) => choice?.error)?.error
    : null;
  if (choiceError) throwCopilotPingError(provider, { status: 200, ok: true }, payload);

  const raw = provider === "OpenAI"
    ? extractResponsesOutputText(payload)
    : payload?.choices?.[0]?.message?.content;
  const parsed = parseCopilotPingContent(raw);
  if (parsed?.ok !== true) {
    const error = new Error(`Matter Copilot model check failed: ${provider} did not return the expected structured response`);
    error.statusCode = 502;
    throw error;
  }
}

function parseCopilotPingContent(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeGlobalAiSettings(raw) {
  const values = {};
  const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
  if (apiKey) {
    if (!OPENAI_KEY_PATTERN.test(apiKey)) {
      const error = new Error("OpenAI API key must start with sk-");
      error.statusCode = 400;
      throw error;
    }
    values.OPENAI_API_KEY = apiKey;
  }

  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!model) {
    const error = new Error("Model is required");
    error.statusCode = 400;
    throw error;
  }
  values.OPENAI_MODEL = model;

  const maxOutputTokens = parsePositiveInteger(raw.maxOutputTokens);
  if (!maxOutputTokens) {
    const error = new Error("Max output tokens must be a positive integer");
    error.statusCode = 400;
    throw error;
  }
  values.OPENAI_MAX_OUTPUT_TOKENS = String(maxOutputTokens);
  return values;
}

function normalizeCopilotSettings(raw) {
  const values = {};
  const provider = typeof raw.copilotProvider === "string"
    ? raw.copilotProvider.trim()
    : "";
  if (![AI_PROVIDERS.OPENAI_DIRECT, AI_PROVIDERS.OPENROUTER].includes(provider)) {
    const error = new Error("Matter Copilot provider must be openai-direct or openrouter");
    error.statusCode = 400;
    throw error;
  }

  const model = typeof raw.copilotModel === "string" ? raw.copilotModel.trim() : "";
  if (!model) {
    const error = new Error("Matter Copilot model is required");
    error.statusCode = 400;
    throw error;
  }

  values[COPILOT_PROVIDER_ENV_KEY] = provider;
  if (provider === AI_PROVIDERS.OPENROUTER) {
    values[OPENROUTER_COPILOT_MODEL_ENV_KEY] = model;
  } else {
    values[OPENAI_COPILOT_MODEL_ENV_KEY] = model;
  }

  const apiKey = typeof raw.copilotApiKey === "string" ? raw.copilotApiKey.trim() : "";
  if (apiKey) {
    if (provider === AI_PROVIDERS.OPENAI_DIRECT) {
      if (!OPENAI_KEY_PATTERN.test(apiKey)) {
        const error = new Error("OpenAI API key must start with sk-");
        error.statusCode = 400;
        throw error;
      }
      values.OPENAI_API_KEY = apiKey;
    } else {
      values.OPENROUTER_API_KEY = apiKey;
    }
  }

  return values;
}

function hasAnyOwnProperty(record, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

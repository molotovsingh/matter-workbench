import path from "node:path";
import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
} from "../shared/ai-defaults.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { upsertLocalEnv } from "../shared/local-env.mjs";
import {
  AI_PROVIDERS,
  AI_TASKS,
  DEFAULT_OPENROUTER_ENDPOINT,
  listAiTaskStatusMetadata,
  listCopilotModelPresets,
  resolveModelPolicy,
} from "../shared/model-policy.mjs";
import { createAiProviderService } from "./ai-provider-service.mjs";

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
      copilotModelPresets: listCopilotModelPresets(),
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
    return listAiTaskStatusMetadata().map((item) => {
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

    const providerService = createAiProviderService({
      env: candidateEnv,
      endpoint,
      openRouterEndpoint,
      fetchImpl,
    });
    try {
      const result = await providerService.invoke({
        task: AI_TASKS.COPILOT_ANSWER,
        systemPrompt: "Return JSON only. Confirm the configured provider can answer a trivial Matter Copilot health check.",
        userPayload: { task: "matter_copilot_model_check", expected: { ok: true } },
        schema: COPILOT_MODEL_CHECK_SCHEMA,
        schemaName: "matter_copilot_model_check",
        responseMode: "json",
        overrides: {
          maxOutputTokens: COPILOT_MODEL_CHECK_MAX_TOKENS,
          timeoutMs: COPILOT_MODEL_CHECK_TIMEOUT_MS,
          extraHeaders: { "x-title": "Matter Workbench Matter Copilot Settings Check" },
        },
        label: "Matter Copilot model check",
      });
      if (result.parsed?.ok !== true) {
        const error = new Error("Matter Copilot model check failed: provider did not return the expected structured response");
        error.statusCode = 502;
        throw error;
      }
    } catch (error) {
      throw copilotModelCheckError(error);
    }
  }
}

function copilotModelCheckError(error) {
  if (!error?.statusCode && !error?.code) return redactedAiSettingsError(error, "Matter Copilot model check failed");
  const rawMessage = redactSensitiveText(error?.message || "Matter Copilot model check failed");
  const message = /^Matter Copilot model check failed:/i.test(rawMessage)
    ? rawMessage
    : `Matter Copilot model check failed: ${rawMessage}`;
  const safe = new Error(message);
  safe.statusCode = error?.statusCode || 503;
  if (error?.code) safe.code = error.code;
  return safe;
}

function redactedAiSettingsError(error, fallbackMessage) {
  const message = redactSensitiveText(error?.message || fallbackMessage);
  const safe = new Error(message || fallbackMessage);
  safe.statusCode = error?.statusCode || 503;
  if (error?.code) safe.code = error.code;
  return safe;
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

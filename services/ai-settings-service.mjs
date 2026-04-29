import path from "node:path";
import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
} from "../shared/ai-defaults.mjs";
import { upsertLocalEnv } from "../shared/local-env.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";

const OPENAI_KEY_PATTERN = /^sk-[A-Za-z0-9_-]+$/;
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
];

export function createAiSettingsService({
  appDir,
  env = process.env,
  endpoint = "https://api.openai.com/v1/responses",
} = {}) {
  const root = path.resolve(appDir || process.cwd());

  function readSettings() {
    return {
      provider: "OpenAI",
      apiKeyConfigured: Boolean(env.OPENAI_API_KEY),
      model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      maxOutputTokens: parsePositiveInteger(env.OPENAI_MAX_OUTPUT_TOKENS) || DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
      envPath: path.join(root, ".env"),
      aiTasks: readAiTaskStatuses(),
    };
  }

  async function saveSettings(raw = {}) {
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

    await upsertLocalEnv({ appDir: root, values });
    Object.assign(env, values);
    return readSettings();
  }

  async function testConnection() {
    const settings = readSettings();
    if (!env.OPENAI_API_KEY) {
      const error = new Error("OPENAI_API_KEY is not configured");
      error.statusCode = 409;
      throw error;
    }

    const started = Date.now();
    const response = await fetch(endpoint, {
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
      throw error;
    }

    return {
      ok: true,
      provider: settings.provider,
      model: settings.model,
      latencyMs: Date.now() - started,
    };
  }

  return {
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
        const missing = [];
        if (!apiKeyConfigured) missing.push(`${apiKeyEnvKey} missing`);
        if (!modelConfigured) missing.push(`${item.modelEnvKey} missing`);
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
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

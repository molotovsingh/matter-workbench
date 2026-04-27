import path from "node:path";
import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
} from "../create-listofdates-engine.mjs";
import { upsertLocalEnv } from "../shared/local-env.mjs";

const OPENAI_KEY_PATTERN = /^sk-[A-Za-z0-9_-]+$/;

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
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

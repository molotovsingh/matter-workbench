import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";
import { createAiProviderService } from "../services/ai-provider-service.mjs";
import { AI_PROVIDERS, AI_TASKS } from "../shared/model-policy.mjs";

const OK_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: {
    ok: { type: "boolean", maxLength: 5 },
  },
});

function providerResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

test("AI provider service invokes OpenAI Responses with task policy and json schema", async () => {
  const calls = [];
  const service = createAiProviderService({
    env: {
      OPENAI_API_KEY: "sk-test",
      SKILL_ROUTER_PROVIDER: AI_PROVIDERS.OPENAI_DIRECT,
      OPENAI_MODEL: "gpt-test-router",
    },
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, options, body: JSON.parse(options.body) });
      return providerResponse({
        output_text: JSON.stringify({ ok: true }),
        model: "gpt-test-router",
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      });
    },
  });

  const result = await service.invoke({
    task: AI_TASKS.SKILL_ROUTER,
    systemPrompt: "Return JSON only.",
    userPayload: { hello: "world" },
    schema: OK_SCHEMA,
    schemaName: "unit_ok",
  });

  assert.deepEqual(result.parsed, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "gpt-test-router");
  assert.equal(calls[0].body.input[0].role, "system");
  assert.equal(calls[0].body.input[1].content, JSON.stringify({ hello: "world" }));
  assert.equal(calls[0].body.text.format.type, "json_schema");
  assert.equal(calls[0].body.text.format.name, "unit_ok");
  assert.equal(calls[0].options.headers.authorization, "Bearer sk-test");
  assert.equal(result.aiRun.task, AI_TASKS.SKILL_ROUTER);
  assert.equal(result.aiRun.provider, AI_PROVIDERS.OPENAI_DIRECT);
  assert.equal(result.aiRun.model, "gpt-test-router");
  assert.deepEqual(result.aiRun.usage, { promptTokens: 3, completionTokens: 2, totalTokens: 5 });
  assert.equal(result.rawPayload.model, "gpt-test-router");
});

test("AI provider service invokes OpenRouter with provider routing and compatible schema", async () => {
  const calls = [];
  const service = createAiProviderService({
    env: {
      OPENROUTER_API_KEY: "or-test",
      COPILOT_ANSWER_PROVIDER: AI_PROVIDERS.OPENROUTER,
      OPENROUTER_COPILOT_ANSWER_MODEL: "openai/gpt-4.1",
      OPENROUTER_COPILOT_ANSWER_PROVIDER_SORT: "latency",
    },
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, options, body: JSON.parse(options.body) });
      return providerResponse({
        model: "openai/gpt-4.1",
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
      });
    },
  });

  const result = await service.invoke({
    task: AI_TASKS.COPILOT_ANSWER,
    systemPrompt: "Return JSON only.",
    userPayload: { question: "ping" },
    schema: OK_SCHEMA,
    schemaName: "router_ok",
  });

  assert.deepEqual(result.parsed, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "openai/gpt-4.1");
  assert.equal(calls[0].body.provider.require_parameters, true);
  assert.equal(calls[0].body.provider.allow_fallbacks, false);
  assert.equal(calls[0].body.provider.sort, "latency");
  assert.equal(calls[0].body.response_format.type, "json_schema");
  assert.equal(calls[0].body.response_format.json_schema.schema.properties.ok.type, "boolean");
  assert.equal(calls[0].body.response_format.json_schema.schema.properties.ok.maxLength, undefined);
  assert.equal(calls[0].options.headers["http-referer"], "https://github.com/molotovsingh/matter-workbench");
  assert.equal(calls[0].options.headers["x-title"], "Matter Workbench");
  assert.equal(result.aiRun.task, AI_TASKS.COPILOT_ANSWER);
  assert.equal(result.aiRun.provider, AI_PROVIDERS.OPENROUTER);
  assert.deepEqual(result.aiRun.usage, { promptTokens: 4, completionTokens: 1, totalTokens: 5 });
});

test("AI provider service supports text responses and settings summaries without moving callers", async () => {
  const service = createAiProviderService({
    env: {
      OPENAI_API_KEY: "sk-test",
      SKILL_SAMPLE_OUTPUT_PROVIDER: AI_PROVIDERS.OPENAI_DIRECT,
      OPENAI_SKILL_SAMPLE_OUTPUT_MODEL: "gpt-sample",
    },
    fetchImpl: async () => providerResponse({ output_text: "# Sample\n\nBody." }),
  });

  const result = await service.invoke({
    task: AI_TASKS.SKILL_SAMPLE_OUTPUT,
    systemPrompt: "Return Markdown.",
    userPayload: { sample: true },
    responseMode: "text",
  });
  assert.equal(result.parsed, "# Sample\n\nBody.");

  const summary = service.settingsSummary({ tasks: [AI_TASKS.SKILL_SAMPLE_OUTPUT] });
  assert.equal(summary.schema_version, "ai-provider-settings-summary/v1");
  assert.equal(summary.tasks[0].task, AI_TASKS.SKILL_SAMPLE_OUTPUT);
  assert.equal(summary.tasks[0].provider, AI_PROVIDERS.OPENAI_DIRECT);
  assert.equal(summary.tasks[0].apiKeyConfigured, true);
  assert.equal(summary.tasks[0].aiRun.task, AI_TASKS.SKILL_SAMPLE_OUTPUT);
});

test("AI provider service ping uses the same invoke boundary", async () => {
  const service = createAiProviderService({
    env: {
      OPENAI_API_KEY: "sk-test",
      COPILOT_ANSWER_PROVIDER: AI_PROVIDERS.OPENAI_DIRECT,
      OPENAI_COPILOT_ANSWER_MODEL: "gpt-ping",
    },
    fetchImpl: async () => providerResponse({ output_text: JSON.stringify({ ok: true }) }),
  });

  const check = await service.ping(AI_TASKS.COPILOT_ANSWER);
  assert.equal(check.ok, true);
  assert.equal(check.task, AI_TASKS.COPILOT_ANSWER);
  assert.equal(check.provider, AI_PROVIDERS.OPENAI_DIRECT);
  assert.equal(check.model, "gpt-ping");
  assert.equal(check.aiRun.task, AI_TASKS.COPILOT_ANSWER);
});

test("Workbench service graph exposes the first-class AI provider service", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "mwb-ai-provider-service-"));
  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: path.join(appDir, "matters") },
    host: "127.0.0.1",
    port: 0,
  });

  assert.equal(typeof app.services.aiProviderService.invoke, "function");
  assert.equal(typeof app.services.aiProviderService.invokeOcr, "function");
  assert.equal(typeof app.services.aiProviderService.ping, "function");
  assert.equal(app.services.aiProvider, null);
});

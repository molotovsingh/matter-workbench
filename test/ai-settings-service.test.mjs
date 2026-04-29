import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAiSettingsService } from "../services/ai-settings-service.mjs";

test("AI settings save model/token config and replace API key without exposing it", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-"));
  await writeFile(path.join(appDir, ".env"), [
    "# existing local config",
    "OPENAI_API_KEY=sk-old",
    "MATTERS_HOME=/tmp/matters",
    "",
  ].join("\n"));

  const env = { OPENAI_API_KEY: "sk-old", MATTERS_HOME: "/tmp/matters" };
  const service = createAiSettingsService({ appDir, env });
  const saved = await service.saveSettings({
    apiKey: "sk-new_value",
    model: "gpt-5-mini",
    maxOutputTokens: "2048",
  });

  assert.equal(saved.provider, "OpenAI");
  assert.equal(saved.apiKeyConfigured, true);
  assert.equal(saved.model, "gpt-5-mini");
  assert.equal(saved.maxOutputTokens, 2048);
  assert.equal(saved.envPath, path.join(appDir, ".env"));
  assert.ok(saved.aiTasks.some((task) => task.task === "source_backed_analysis"));
  assert.equal(env.OPENAI_API_KEY, "sk-new_value");
  assert.equal(env.OPENAI_MODEL, "gpt-5-mini");
  assert.equal(env.OPENAI_MAX_OUTPUT_TOKENS, "2048");

  const text = await readFile(path.join(appDir, ".env"), "utf8");
  assert.match(text, /OPENAI_API_KEY=sk-new_value/);
  assert.match(text, /OPENAI_MODEL=gpt-5-mini/);
  assert.match(text, /OPENAI_MAX_OUTPUT_TOKENS=2048/);
  assert.match(text, /MATTERS_HOME=\/tmp\/matters/);
});

test("AI settings expose read-only provider status without secrets", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-"));
  const service = createAiSettingsService({
    appDir,
    env: {
      OPENAI_API_KEY: "sk-openai-test",
      OPENAI_MODEL: "openai-policy-model",
      OPENAI_MAX_OUTPUT_TOKENS: "2400",
      OPENROUTER_API_KEY: "sk-or-test",
      OPENROUTER_SOURCE_DESCRIPTION_MODEL: "meta-llama/source-description-model",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL: "meta-llama/listofdates-model",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_MAX_OUTPUT_TOKENS: "3000",
      OPENROUTER_SOURCE_BACKED_ANALYSIS_TIMEOUT_MS: "90000",
      SOURCE_BACKED_ANALYSIS_PROVIDER: "openrouter",
    },
  });

  const settings = service.readSettings();
  assert.equal(settings.aiTasks.length, 3);
  const listOfDates = settings.aiTasks.find((task) => task.task === "source_backed_analysis");
  assert.equal(listOfDates.label, "/create_listofdates");
  assert.equal(listOfDates.provider, "openrouter");
  assert.equal(listOfDates.model, "meta-llama/listofdates-model");
  assert.equal(listOfDates.maxOutputTokens, 3000);
  assert.equal(listOfDates.timeoutMs, 90000);
  assert.equal(listOfDates.ready, true);
  assert.equal(listOfDates.note, "Ready");

  const serialized = JSON.stringify(settings);
  assert.doesNotMatch(serialized, /sk-openai-test/);
  assert.doesNotMatch(serialized, /sk-or-test/);
});

test("AI settings test connection sends a tiny server-side OpenAI request", async () => {
  const bodies = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ output_text: "ok" }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const service = createAiSettingsService({
      appDir: await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-")),
      env: {
        OPENAI_API_KEY: "sk-test",
        OPENAI_MODEL: "gpt-5-mini",
        OPENAI_MAX_OUTPUT_TOKENS: "2048",
      },
      endpoint: `http://${address.address}:${address.port}/v1/responses`,
    });
    const result = await service.testConnection();
    assert.equal(result.ok, true);
    assert.equal(result.model, "gpt-5-mini");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, "gpt-5-mini");
  assert.equal(bodies[0].max_output_tokens, 16);
  assert.equal(bodies[0].input, "Reply with exactly: ok");
});

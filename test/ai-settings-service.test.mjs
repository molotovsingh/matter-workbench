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

  assert.deepEqual(saved, {
    provider: "OpenAI",
    apiKeyConfigured: true,
    model: "gpt-5-mini",
    maxOutputTokens: 2048,
    envPath: path.join(appDir, ".env"),
  });
  assert.equal(env.OPENAI_API_KEY, "sk-new_value");
  assert.equal(env.OPENAI_MODEL, "gpt-5-mini");
  assert.equal(env.OPENAI_MAX_OUTPUT_TOKENS, "2048");

  const text = await readFile(path.join(appDir, ".env"), "utf8");
  assert.match(text, /OPENAI_API_KEY=sk-new_value/);
  assert.match(text, /OPENAI_MODEL=gpt-5-mini/);
  assert.match(text, /OPENAI_MAX_OUTPUT_TOKENS=2048/);
  assert.match(text, /MATTERS_HOME=\/tmp\/matters/);
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

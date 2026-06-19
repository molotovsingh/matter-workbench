import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAiSettingsService } from "../services/ai-settings-service.mjs";

async function closeTestServer(server) {
  const closed = new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await closed;
}

async function fetchJsonOnce(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(url), {
      method: options.method || "GET",
      headers: {
        ...(options.headers || {}),
        connection: "close",
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          json: async () => JSON.parse(body || "null"),
          text: async () => body,
        });
      });
    });
    request.on("error", reject);
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        request.destroy(error);
      }, { once: true });
    }
    if (options.body) request.write(options.body);
    request.end();
  });
}

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
  assert.equal(settings.aiTasks.length, 4);
  const copilot = settings.aiTasks.find((task) => task.task === "copilot_answer");
  assert.equal(copilot.label, "Matter Copilot");
  assert.equal(copilot.provider, "openrouter");
  assert.equal(copilot.model, "openai/gpt-4.1");
  assert.equal(copilot.ready, true);
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

test("AI settings save Matter Copilot routing without changing global AI defaults", async () => {
  const bodies = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }));
    });
  });

  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-"));
  await writeFile(path.join(appDir, ".env"), [
    "OPENAI_API_KEY=sk-openai-existing",
    "OPENAI_MODEL=gpt-existing",
    "OPENAI_MAX_OUTPUT_TOKENS=2048",
    "",
  ].join("\n"));

  const env = {
    OPENAI_API_KEY: "sk-openai-existing",
    OPENAI_MODEL: "gpt-existing",
    OPENAI_MAX_OUTPUT_TOKENS: "2048",
  };

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  let saved;
  try {
    const service = createAiSettingsService({
      appDir,
      env,
      openRouterEndpoint: `http://${address.address}:${address.port}/chat/completions`,
      fetchImpl: fetchJsonOnce,
    });
    saved = await service.saveSettings({
      copilotProvider: "openrouter",
      copilotModel: "openai/gpt-4.1",
      copilotApiKey: "sk-or-v1-test",
    });
  } finally {
    await closeTestServer(server);
  }

  assert.equal(env.OPENAI_MODEL, "gpt-existing");
  assert.equal(env.OPENAI_MAX_OUTPUT_TOKENS, "2048");
  assert.equal(env.COPILOT_ANSWER_PROVIDER, "openrouter");
  assert.equal(env.OPENROUTER_COPILOT_ANSWER_MODEL, "openai/gpt-4.1");
  assert.equal(env.OPENROUTER_API_KEY, "sk-or-v1-test");

  const copilot = saved.aiTasks.find((task) => task.task === "copilot_answer");
  assert.equal(copilot.provider, "openrouter");
  assert.equal(copilot.model, "openai/gpt-4.1");
  assert.equal(copilot.ready, true);
  assert.equal(copilot.note, "Ready");
  assert.equal(saved.model, "gpt-existing");

  const text = await readFile(path.join(appDir, ".env"), "utf8");
  assert.match(text, /OPENAI_MODEL=gpt-existing/);
  assert.match(text, /COPILOT_ANSWER_PROVIDER=openrouter/);
  assert.match(text, /OPENROUTER_COPILOT_ANSWER_MODEL=openai\/gpt-4\.1/);
  assert.match(text, /OPENROUTER_API_KEY=sk-or-v1-test/);

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, "openai/gpt-4.1");
  assert.equal(bodies[0].provider.allow_fallbacks, false);
  assert.equal(bodies[0].provider.require_parameters, true);
  assert.equal(bodies[0].response_format.type, "json_schema");
});

test("AI settings omits OpenRouter temperature for GPT-5 Copilot checks", async () => {
  const bodies = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }));
    });
  });

  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-"));
  const env = { OPENROUTER_API_KEY: "sk-or-v1-test" };

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const service = createAiSettingsService({
      appDir,
      env,
      openRouterEndpoint: `http://${address.address}:${address.port}/chat/completions`,
      fetchImpl: fetchJsonOnce,
    });
    await service.saveSettings({
      copilotProvider: "openrouter",
      copilotModel: "openai/gpt-5.4",
    });
  } finally {
    await closeTestServer(server);
  }

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, "openai/gpt-5.4");
  assert.equal(Object.hasOwn(bodies[0], "temperature"), false);
  assert.equal(bodies[0].provider.require_parameters, true);
});

test("AI settings startup Copilot check records live status without persisting settings", async () => {
  const bodies = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }));
    });
  });

  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-"));
  await writeFile(path.join(appDir, ".env"), [
    "OPENROUTER_API_KEY=sk-or-v1-test",
    "COPILOT_ANSWER_PROVIDER=openrouter",
    "OPENROUTER_COPILOT_ANSWER_MODEL=openai/gpt-5.4",
    "",
  ].join("\n"));
  const env = {
    OPENROUTER_API_KEY: "sk-or-v1-test",
    COPILOT_ANSWER_PROVIDER: "openrouter",
    OPENROUTER_COPILOT_ANSWER_MODEL: "openai/gpt-5.4",
  };

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  let result;
  try {
    const service = createAiSettingsService({
      appDir,
      env,
      openRouterEndpoint: `http://${address.address}:${address.port}/chat/completions`,
      fetchImpl: fetchJsonOnce,
    });
    result = await service.checkCopilotModel();
    const settings = service.readSettings();
    assert.deepEqual(settings.startupChecks.copilot, result);
  } finally {
    await closeTestServer(server);
  }

  assert.equal(result.ok, true);
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, "openai/gpt-5.4");
  assert.equal(Object.hasOwn(bodies[0], "temperature"), false);
  const text = await readFile(path.join(appDir, ".env"), "utf8");
  assert.match(text, /OPENROUTER_COPILOT_ANSWER_MODEL=openai\/gpt-5\.4/);
});

test("AI settings do not persist Matter Copilot switch when model ping fails", async () => {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "model not available" } }));
    });
  });

  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-"));
  await writeFile(path.join(appDir, ".env"), [
    "OPENAI_API_KEY=sk-openai-existing",
    "OPENAI_MODEL=gpt-existing",
    "",
  ].join("\n"));
  const env = {
    OPENAI_API_KEY: "sk-openai-existing",
    OPENAI_MODEL: "gpt-existing",
  };

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const service = createAiSettingsService({
      appDir,
      env,
      openRouterEndpoint: `http://${address.address}:${address.port}/chat/completions`,
      fetchImpl: fetchJsonOnce,
    });
    await assert.rejects(
      () => service.saveSettings({
        copilotProvider: "openrouter",
        copilotModel: "openai/gpt-4.1",
        copilotApiKey: "sk-or-v1-test",
      }),
      /Matter Copilot model check failed: model not available/,
    );
  } finally {
    await closeTestServer(server);
  }

  assert.equal(env.COPILOT_ANSWER_PROVIDER, undefined);
  assert.equal(env.OPENROUTER_COPILOT_ANSWER_MODEL, undefined);
  assert.equal(env.OPENROUTER_API_KEY, undefined);
  const text = await readFile(path.join(appDir, ".env"), "utf8");
  assert.doesNotMatch(text, /COPILOT_ANSWER_PROVIDER/);
  assert.doesNotMatch(text, /OPENROUTER_COPILOT_ANSWER_MODEL/);
  assert.doesNotMatch(text, /OPENROUTER_API_KEY/);
});

test("AI settings Matter Copilot switch normalizes provider quota failures", async () => {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({
        error: {
          code: "insufficient_quota",
          message: "You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.",
        },
      }));
    });
  });

  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-"));
  await writeFile(path.join(appDir, ".env"), [
    "OPENAI_API_KEY=sk-openai-existing",
    "OPENAI_MODEL=gpt-existing",
    "",
  ].join("\n"));
  const env = {
    OPENAI_API_KEY: "sk-openai-existing",
    OPENAI_MODEL: "gpt-existing",
  };

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const service = createAiSettingsService({
      appDir,
      env,
      endpoint: `http://${address.address}:${address.port}/v1/responses`,
      fetchImpl: fetchJsonOnce,
    });
    await assert.rejects(
      () => service.saveSettings({
        copilotProvider: "openai-direct",
        copilotModel: "gpt-5.4",
      }),
      (error) => {
        assert.equal(error.code, "provider.quota_exceeded");
        assert.equal(error.statusCode, 502);
        assert.equal(error.message, "Matter Copilot model check failed: AI quota or billing limit reached. Ask the operator to check the AI account before trying again.");
        assert.doesNotMatch(error.message, /platform\.openai\.com/);
        return true;
      },
    );
  } finally {
    await closeTestServer(server);
  }

  assert.equal(env.COPILOT_ANSWER_PROVIDER, undefined);
  assert.equal(env.OPENAI_COPILOT_ANSWER_MODEL, undefined);
  const text = await readFile(path.join(appDir, ".env"), "utf8");
  assert.doesNotMatch(text, /COPILOT_ANSWER_PROVIDER/);
  assert.doesNotMatch(text, /OPENAI_COPILOT_ANSWER_MODEL/);
});

test("AI settings reject Matter Copilot switch when OpenRouter returns a choice error", async () => {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [
          { error: { message: "structured outputs unavailable for selected provider" } },
        ],
      }));
    });
  });

  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-"));
  await writeFile(path.join(appDir, ".env"), "OPENAI_MODEL=gpt-existing\n");
  const env = { OPENROUTER_API_KEY: "sk-or-v1-existing" };

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const service = createAiSettingsService({
      appDir,
      env,
      openRouterEndpoint: `http://${address.address}:${address.port}/chat/completions`,
      fetchImpl: fetchJsonOnce,
    });
    await assert.rejects(
      () => service.saveSettings({
        copilotProvider: "openrouter",
        copilotModel: "openai/gpt-4.1",
      }),
      /structured outputs unavailable/,
    );
  } finally {
    await closeTestServer(server);
  }

  assert.equal(env.COPILOT_ANSWER_PROVIDER, undefined);
  const text = await readFile(path.join(appDir, ".env"), "utf8");
  assert.doesNotMatch(text, /COPILOT_ANSWER_PROVIDER/);
});

test("AI settings redacts submitted API keys from Copilot ping transport errors", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-"));
  await writeFile(path.join(appDir, ".env"), "OPENAI_MODEL=gpt-existing\n");
  const submittedKey = "sk-or-v1-sensitive-secret";
  const service = createAiSettingsService({
    appDir,
    env: {},
    fetchImpl: async () => {
      throw new Error(`transport failed with Authorization: Bearer ${submittedKey}`);
    },
  });

  await assert.rejects(
    () => service.saveSettings({
      copilotProvider: "openrouter",
      copilotModel: "google/gemini-2.5-pro",
      copilotApiKey: submittedKey,
    }),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(submittedKey));
      assert.match(error.message, /redacted-secret/);
      return true;
    },
  );

  const text = await readFile(path.join(appDir, ".env"), "utf8");
  assert.doesNotMatch(text, /OPENROUTER_API_KEY/);
  assert.equal(service.readSettings().aiTasks.some((task) => JSON.stringify(task).includes(submittedKey)), false);
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
      fetchImpl: fetchJsonOnce,
    });
    const result = await service.testConnection();
    assert.equal(result.ok, true);
    assert.equal(result.model, "gpt-5-mini");
  } finally {
    await closeTestServer(server);
  }

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, "gpt-5-mini");
  assert.equal(bodies[0].max_output_tokens, 16);
  assert.equal(bodies[0].input, "Reply with exactly: ok");
});

test("AI settings test connection redacts upstream OpenAI error messages", async () => {
  const leakedKey = "sk-leaked-test-connection";
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `Invalid key ${leakedKey}` } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const service = createAiSettingsService({
      appDir: await mkdtemp(path.join(os.tmpdir(), "matter-ai-settings-")),
      env: {
        OPENAI_API_KEY: "sk-test",
        OPENAI_MODEL: "gpt-5-mini",
      },
      endpoint: `http://${address.address}:${address.port}/v1/responses`,
      fetchImpl: fetchJsonOnce,
    });

    await assert.rejects(
      () => service.testConnection(),
      (error) => {
        assert.doesNotMatch(error.message, new RegExp(leakedKey));
        assert.match(error.message, /redacted-secret/);
        return true;
      },
    );
  } finally {
    await closeTestServer(server);
  }
});

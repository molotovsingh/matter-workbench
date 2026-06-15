import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchProviderJsonWithTimeout,
  extractOpenAiOutputText,
  extractOpenRouterMessageText,
  parseOpenAiJsonOutput,
  parseOpenRouterJsonMessage,
} from "../shared/provider-http.mjs";
import {
  createOpenRouterProviderError,
  parseOpenRouterJsonContent,
} from "../shared/openrouter-response.mjs";

test("provider HTTP timeout failures carry a stable app error code", async () => {
  await assert.rejects(
    () => fetchProviderJsonWithTimeout({
      endpoint: "https://provider.example/v1",
      apiKey: "sk-test",
      body: {},
      timeoutMs: 1,
      fetchImpl: async (_endpoint, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      }),
    }),
    (error) => {
      assert.equal(error.statusCode, 504);
      assert.equal(error.code, "provider.timeout");
      return true;
    },
  );
});

test("provider HTTP response failures carry a stable app error code", async () => {
  await assert.rejects(
    () => fetchProviderJsonWithTimeout({
      endpoint: "https://provider.example/v1",
      apiKey: "sk-test",
      body: {},
      timeoutMs: 0,
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "Rate limit exceeded" } }),
      }),
    }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.error");
      assert.match(error.message, /Rate limit exceeded/);
      return true;
    },
  );
});

test("provider HTTP quota and billing failures carry a specific app error code", async () => {
  await assert.rejects(
    () => fetchProviderJsonWithTimeout({
      endpoint: "https://provider.example/v1",
      apiKey: "sk-test",
      body: {},
      timeoutMs: 0,
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            message: "You exceeded your current quota, please check your plan and billing details.",
            code: "insufficient_quota",
          },
        }),
      }),
    }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.quota_exceeded");
      assert.match(error.message, /AI quota or billing limit reached/);
      assert.doesNotMatch(error.message, /platform\.openai\.com/);
      return true;
    },
  );
});

test("provider output parsing failures distinguish empty output from invalid JSON", () => {
  assert.throws(
    () => parseOpenAiJsonOutput({}, "OpenAI skill authoring"),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.empty_output");
      return true;
    },
  );
  assert.throws(
    () => extractOpenAiOutputText({}, "OpenAI skill run"),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.empty_output");
      return true;
    },
  );
  assert.throws(
    () => parseOpenAiJsonOutput({ output_text: "not json" }, "OpenAI skill authoring"),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.invalid_json");
      return true;
    },
  );
});

test("OpenRouter provider parsing failures carry stable app error codes", () => {
  assert.throws(
    () => parseOpenRouterJsonMessage({ choices: [{ message: { content: "not json" } }] }, "OpenRouter skill authoring"),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.invalid_json");
      return true;
    },
  );
  assert.throws(
    () => parseOpenRouterJsonMessage({ choices: [{ message: {} }] }, "OpenRouter skill authoring"),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.empty_output");
      return true;
    },
  );
  assert.throws(
    () => extractOpenRouterMessageText({ choices: [{ message: {} }] }, "OpenRouter skill run"),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.empty_output");
      return true;
    },
  );
});

test("shared OpenRouter response helpers carry stable provider failure codes", () => {
  assert.throws(
    () => parseOpenRouterJsonContent({ choices: [{ message: { content: "not json" } }] }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.invalid_json");
      return true;
    },
  );
  assert.throws(
    () => parseOpenRouterJsonContent({ choices: [{ message: {} }] }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.empty_output");
      return true;
    },
  );

  const mapped = createOpenRouterProviderError(
    { status: 429 },
    { error: { code: 429, message: "Rate limit exceeded" } },
  );
  assert.equal(mapped.statusCode, 502);
  assert.equal(mapped.code, "provider.error");
});

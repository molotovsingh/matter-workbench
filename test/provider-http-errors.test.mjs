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
import { requestResponsesJson } from "../shared/responses-client.mjs";

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

test("provider HTTP choice errors preserve the provider choice message", async () => {
  await assert.rejects(
    () => fetchProviderJsonWithTimeout({
      endpoint: "https://provider.example/v1",
      apiKey: "sk-test",
      body: {},
      timeoutMs: 0,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { error: { message: "structured outputs unavailable for selected provider" } },
          ],
        }),
      }),
    }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.error");
      assert.match(error.message, /structured outputs unavailable/);
      assert.doesNotMatch(error.message, /Provider returned 200/);
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

test("Responses API quota failures carry the same stable app error code", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          message: "You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.",
          code: "insufficient_quota",
        },
      }),
    });

    await assert.rejects(
      () => requestResponsesJson({
        apiKey: "sk-test",
        body: { model: "gpt-test", input: "hello" },
      }),
      (error) => {
        assert.equal(error.statusCode, 502);
        assert.equal(error.code, "provider.quota_exceeded");
        assert.equal(error.message, "AI quota or billing limit reached. Ask the operator to check the AI account before trying again.");
        assert.doesNotMatch(error.message, /platform\.openai\.com/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("provider output parsing identifies truncated structured responses", () => {
  assert.throws(
    () => parseOpenAiJsonOutput({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: '{"entries":[',
    }, "OpenAI list-of-dates"),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, "provider.output_truncated");
      assert.match(error.message, /cut off before completion/i);
      assert.match(error.message, /No partial output was saved/i);
      assert.doesNotMatch(error.message, /Unexpected end of JSON input/i);
      return true;
    },
  );
  assert.throws(
    () => parseOpenRouterJsonMessage({
      choices: [{ finish_reason: "length", message: { content: '{"entries":[' } }],
    }, "OpenRouter list-of-dates"),
    (error) => error.code === "provider.output_truncated",
  );
  assert.throws(
    () => extractOpenAiOutputText({
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
      output_text: "partial text",
    }, "OpenAI source-backed analysis"),
    (error) => error.code === "provider.incomplete_response",
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

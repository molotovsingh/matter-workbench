import assert from "node:assert/strict";
import test from "node:test";

import { AI_TASKS } from "../shared/model-policy.mjs";
import {
  TWO_PASS_ENV_FLAG,
  createConfiguredListOfDatesProvider,
  isTwoPassListOfDatesEnabled,
} from "../listofdates/run-config.mjs";

test("List of Dates run config resolves two-pass mode from explicit options before env", () => {
  assert.equal(TWO_PASS_ENV_FLAG, "CREATE_LISTOFDATES_TWO_PASS_ENABLED");

  assert.equal(isTwoPassListOfDatesEnabled({
    env: { CREATE_LISTOFDATES_TWO_PASS_ENABLED: "1" },
    options: { twoPass: false },
  }), false);
  assert.equal(isTwoPassListOfDatesEnabled({
    env: { CREATE_LISTOFDATES_TWO_PASS_ENABLED: "0" },
    options: { twoPass: true },
  }), true);
});

test("List of Dates run config recognizes env truthy values only", () => {
  for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
    assert.equal(isTwoPassListOfDatesEnabled({
      env: { CREATE_LISTOFDATES_TWO_PASS_ENABLED: value },
      options: {},
    }), true, value);
  }

  for (const value of ["", "0", "false", "off", "maybe"]) {
    assert.equal(isTwoPassListOfDatesEnabled({
      env: { CREATE_LISTOFDATES_TWO_PASS_ENABLED: value },
      options: {},
    }), false, value);
  }
});

test("List of Dates run config returns injected provider with policy metadata", () => {
  const injectedProvider = async () => ({ entries: [] });

  const configured = createConfiguredListOfDatesProvider({
    task: AI_TASKS.CREATE_LISTOFDATES_PASS1,
    env: {},
    options: {
      endpoint: "https://example.invalid/v1",
      model: "custom-model",
      maxOutputTokens: 1234,
      timeoutMs: 5678,
    },
    injectedProvider,
  });

  assert.equal(configured.provider, injectedProvider);
  assert.deepEqual(configured.baseAiRun, {
    policyVersion: "model-policy/v1-current",
    policyPromptVersion: "legal-workbench-policy/v1",
    task: "create_listofdates_pass1",
    tier: "source_backed_analysis",
    provider: "openai-direct",
    model: "custom-model",
    maxOutputTokens: 1234,
    fallback: "fail_closed",
  });
});

test("List of Dates run config passes provider factory inputs through for real providers", () => {
  const prompt = {
    systemPrompt: "system",
    payloadBuilder: () => ({}),
    schemaName: "schema",
    schemaDescription: "description",
  };
  const fetchImpl = async () => {};
  const calls = [];

  const configured = createConfiguredListOfDatesProvider({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    env: { OPENAI_API_KEY: "env-key" },
    options: {
      apiKey: "explicit-key",
      endpoint: "https://example.invalid/v1",
      model: "gpt-4.1",
      maxOutputTokens: 2000,
      timeoutMs: 9000,
      fetchImpl,
    },
    prompt,
    providerFactory: (args) => {
      calls.push(args);
      return async () => ({ entries: [] });
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    providerConfig: {
      provider: "openai-direct",
      endpoint: "https://example.invalid/v1",
      model: "gpt-4.1",
      maxOutputTokens: 2000,
      timeoutMs: 9000,
    },
    apiKey: "explicit-key",
    env: { OPENAI_API_KEY: "env-key" },
    fetchImpl,
    prompt,
  });
  assert.equal(typeof configured.provider, "function");
  assert.equal(configured.baseAiRun.model, "gpt-4.1");
});

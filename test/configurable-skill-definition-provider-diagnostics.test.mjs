import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedOutputMarkdown,
  normalizeStoredSkill,
  uniqueSlash,
} from "../services/configurable-skill-definition.mjs";
import {
  createOpenAiAuthoringProvider,
  createOpenAiRunProvider,
  createOpenRouterAuthoringProvider,
  createOpenRouterRunProvider,
} from "../services/configurable-skill-providers.mjs";

test("configurable skill definition helpers expose stable diagnostic codes", () => {
  assert.throws(
    () => uniqueSlash("/demo", [
      "/demo",
      ...Array.from({ length: 998 }, (_value, index) => `/demo_${index + 2}`),
    ]),
    (error) => error.statusCode === 409
      && error.code === "configurable_skill_definition.slash_unavailable",
  );

  assert.throws(
    () => boundedOutputMarkdown(""),
    (error) => error.statusCode === 502
      && error.code === "configurable_skill_definition.output_empty",
  );

  assert.throws(
    () => boundedOutputMarkdown("x".repeat(80_001)),
    (error) => error.statusCode === 502
      && error.code === "configurable_skill_definition.output_too_large",
  );

  assert.throws(
    () => normalizeStoredSkill({ promptConfig: { prompt: "x".repeat(8_001) } }),
    (error) => error.statusCode === 400
      && error.code === "configurable_skill_definition.prompt_too_large",
  );
});

test("configurable skill providers expose stable missing-key diagnostic codes", async () => {
  const providers = [
    createOpenAiAuthoringProvider({}),
    createOpenRouterAuthoringProvider({}),
    createOpenAiRunProvider({}),
    createOpenRouterRunProvider({}),
  ];

  for (const provider of providers) {
    await assert.rejects(
      () => provider({}),
      (error) => error.statusCode === 409
        && error.code === "configurable_skill_provider.api_key_required",
    );
  }
});

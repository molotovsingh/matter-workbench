import assert from "node:assert/strict";
import test from "node:test";

import {
  openRouterTemperatureParams,
  supportsOpenRouterTemperature,
} from "../shared/openrouter-model-params.mjs";

test("OpenRouter temperature params are omitted for GPT-5 route family", () => {
  for (const model of ["openai/gpt-5", "openai/gpt-5.4", "openai/gpt-5.4-mini", "OPENAI/GPT-5-CHAT"]) {
    assert.equal(supportsOpenRouterTemperature(model), false, model);
    assert.deepEqual(openRouterTemperatureParams(model), {});
  }
});

test("OpenRouter temperature params remain enabled for non-GPT-5 routes", () => {
  assert.equal(supportsOpenRouterTemperature("openai/gpt-4o-mini"), true);
  assert.deepEqual(openRouterTemperatureParams("openai/gpt-4o-mini", 0.2), { temperature: 0.2 });
});

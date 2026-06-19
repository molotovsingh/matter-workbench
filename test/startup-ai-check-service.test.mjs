import assert from "node:assert/strict";
import test from "node:test";

import { runStartupAiChecks } from "../services/startup-ai-check-service.mjs";

test("startup AI checks log Copilot route health without secrets", async () => {
  const lines = [];
  const result = await runStartupAiChecks({
    aiSettingsService: {
      checkCopilotModel: async () => ({
        ok: false,
        provider: "openrouter",
        model: "openai/gpt-5.4",
        error: "failed with OPENROUTER_API_KEY=sk-secret-token",
      }),
    },
    log: (line) => lines.push(line),
  });

  assert.equal(result.ok, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Matter Copilot startup check: failed/);
  assert.match(lines[0], /openai\/gpt-5\.4/);
  assert.match(lines[0], /OPENROUTER_API_KEY=\[redacted-secret\]/);
  assert.doesNotMatch(lines[0], /sk-secret-token/);
});

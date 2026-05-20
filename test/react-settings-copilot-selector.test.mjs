import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPagePath = new URL("../react-ui/src/views/SettingsPage.tsx", import.meta.url);
const copilotModelsPath = new URL("../react-ui/src/lib/copilotModels.ts", import.meta.url);

test("React Settings exposes Matter Copilot as a task-scoped model selector", async () => {
  const source = await readFile(settingsPagePath, "utf8");
  const models = await readFile(copilotModelsPath, "utf8");

  assert.match(source, /Matter Copilot/);
  assert.match(source, /COPILOT_MODEL_PRESETS/);
  assert.match(models, /GPT-4\.1/);
  assert.match(models, /provider: 'openrouter', model: 'openai\/gpt-4\.1'/);
  assert.match(models, /shortLabel: '4\.1'/);
  assert.match(models, /Gemini 2\.5 Pro/);
  assert.match(models, /shortLabel: 'Gemini'/);
  assert.match(models, /provider: 'openrouter', model: 'google\/gemini-2\.5-pro'/);
  assert.match(models, /Claude Sonnet 4\.6/);
  assert.match(models, /anthropic\/claude-sonnet-4\.6/);
  assert.match(models, /Claude Sonnet 4\.5/);
  assert.match(models, /anthropic\/claude-sonnet-4\.5/);
  assert.match(source, /copilotProvider/);
  assert.match(source, /copilotModel/);
  assert.match(source, /Skills and List of Dates keep their governed routes/);
});

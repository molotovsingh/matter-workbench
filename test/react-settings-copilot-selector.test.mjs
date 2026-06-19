import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPagePath = new URL("../react-ui/src/views/SettingsPage.tsx", import.meta.url);
const copilotSettingsPanelPath = new URL("../react-ui/src/components/settings/CopilotSettingsPanel.tsx", import.meta.url);
const copilotModelsPath = new URL("../react-ui/src/lib/copilotModels.ts", import.meta.url);
const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);

test("React Settings exposes Matter Copilot as a task-scoped model selector", async () => {
  const settingsSource = await readFile(settingsPagePath, "utf8");
  const panelSource = await readFile(copilotSettingsPanelPath, "utf8");
  const source = `${settingsSource}\n${panelSource}`;
  const models = await readFile(copilotModelsPath, "utf8");

  assert.match(source, /Matter Copilot/);
  assert.match(source, /COPILOT_MODEL_PRESETS/);
  assert.match(models, /label: 'Low'/);
  assert.match(models, /shortLabel: 'Low'/);
  assert.match(models, /provider: 'openrouter', model: 'openai\/gpt-4o-mini'/);
  assert.match(models, /label: 'Medium'/);
  assert.match(models, /shortLabel: 'Medium'/);
  assert.match(models, /provider: 'openrouter', model: 'openai\/gpt-5\.4-mini'/);
  assert.match(models, /label: 'High'/);
  assert.match(models, /shortLabel: 'High'/);
  assert.match(models, /provider: 'openrouter', model: 'openai\/gpt-5\.4'/);
  assert.doesNotMatch(models, /\{[^\n]*provider: 'openai-direct'/);
  assert.doesNotMatch(models, /google\/gemini/);
  assert.doesNotMatch(models, /label: 'GPT-4\.1'/);
  assert.doesNotMatch(models, /shortLabel: '4\.1'/);
  assert.doesNotMatch(models, /label: 'Gemini 2\.5 Pro'/);
  assert.doesNotMatch(models, /shortLabel: 'Gemini'/);
  assert.doesNotMatch(models, /provider-branded model labels/);
  assert.match(source, /copilotProvider/);
  assert.match(source, /copilotModel/);
  assert.match(source, /Skills and List of Dates keep their governed routes/);
});

test("tester-facing Copilot strength is hidden from non-operators", async () => {
  const source = await readFile(commandPanelPath, "utf8");
  assert.match(source, /canSeeOperatorSurface\(state\.authEnabled, state\.authUser\)/);
  assert.match(source, /canManageCopilotSettings && \(/);
  assert.match(source, /if \(!canManageCopilotSettings\) return undefined/);
  assert.doesNotMatch(source, /disabled=\{!canManageCopilotSettings \|\| copilotSwitching\}/);
});

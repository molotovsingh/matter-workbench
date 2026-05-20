import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPagePath = new URL("../react-ui/src/views/SettingsPage.tsx", import.meta.url);

test("React Settings exposes Matter Copilot as a task-scoped model selector", async () => {
  const source = await readFile(settingsPagePath, "utf8");

  assert.match(source, /Matter Copilot/);
  assert.match(source, /Claude Sonnet 4\.5/);
  assert.match(source, /anthropic\/claude-sonnet-4\.5/);
  assert.match(source, /copilotProvider/);
  assert.match(source, /copilotModel/);
  assert.match(source, /Skills and List of Dates keep their governed routes/);
});

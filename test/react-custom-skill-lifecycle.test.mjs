import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const skillsPagePath = new URL("../react-ui/src/views/SkillsPage.tsx", import.meta.url);

test("React custom skill lifecycle controls are scoped to custom skills", async () => {
  const apiSource = await readFile(apiClientPath, "utf8");
  const commandSource = await readFile(commandPanelPath, "utf8");
  const skillsSource = await readFile(skillsPagePath, "utf8");

  assert.match(apiSource, /updateConfigurableSkillLifecycle/);
  assert.match(apiSource, /\/api\/configurable-skills\/\$\{encodeURIComponent\(skillId\)\}\/lifecycle/);

  assert.match(commandSource, /status !== 'active'/);
  assert.match(commandSource, /customSkill: true/);

  assert.match(skillsSource, /Pause/);
  assert.match(skillsSource, /Resume/);
  assert.match(skillsSource, /Archive/);
  assert.match(skillsSource, /Restore to paused/);
  assert.match(skillsSource, /Delete/);
  assert.match(skillsSource, /Archived custom skills/);
  assert.match(skillsSource, /Built-in · Managed by Matter Workbench/);
  assert.doesNotMatch(skillsSource, /updateConfigurableSkillLifecycle\([^)]*skill\.slash/);
});

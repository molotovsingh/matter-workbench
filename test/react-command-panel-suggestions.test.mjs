import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const stylesPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("React command panel suggestions include custom skills and a larger command menu", async () => {
  const source = await readFile(commandPanelPath, "utf8");

  assert.match(source, /api\.getConfigurableSkills\(\)/);
  assert.match(source, /const loadCommandSuggestions = useCallback/);
  assert.match(source, /onFocus=\{\(\) => \{ void loadCommandSuggestions\(\); \}\}/);
  assert.match(source, /onClose=\{resetCommandPanel\}/);
  assert.match(source, /status !== 'active'/);
  assert.match(source, /skill\.slash/);
  assert.match(source, /setSuggestions\(matched\.slice\(0, 12\)\)/);
  assert.doesNotMatch(source, /setSuggestions\(matched\.slice\(0, 5\)\)/);
});

test("React command handling can invoke configurable skills returned by intent routing", async () => {
  const source = await readFile(new URL("../react-ui/src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /result\.matched_skill_card\?\.configurable/);
  assert.match(source, /api\.runConfigurableSkill\(\{ slash: result\.matched_skill/);
  assert.match(source, /run\.state === 'requires_overwrite'/);
});

test("React command suggestions overlay the command input instead of reflowing the panel", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(styles, /\.ai-command-form \{[^}]*position: relative;/s);
  assert.match(styles, /\.command-suggestions \{[^}]*position: absolute;[^}]*bottom: calc\(100% \+ 6px\);[^}]*z-index:/s);
});

test("React command panel exposes New task and resets transient assistant state", async () => {
  const source = await readFile(commandPanelPath, "utf8");

  assert.match(source, /const resetCommandPanel = useCallback/);
  assert.match(source, /inputOverrideRef\.current = null/);
  assert.match(source, /setInput\(''\)/);
  assert.match(source, /setSkillIdeaInput\(null\)/);
  assert.match(source, /setPendingIntentChoice\(null\)/);
  assert.match(source, /SET_COMMAND_COPY[\s\S]*DEFAULT_COMMAND_COPY_TEXT/);
  assert.match(source, /className="command-panel-new-task"/);
  assert.match(source, />\s*New task\s*</);
  assert.match(source, /lastActiveMatterNameRef/);
  assert.match(source, /state\.activeMatter\?\.name/);
});

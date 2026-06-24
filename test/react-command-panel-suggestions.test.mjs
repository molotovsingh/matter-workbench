import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const commandSuggestionsHookPath = new URL("../react-ui/src/hooks/useCommandSuggestions.ts", import.meta.url);
const stylesPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("React command panel suggestions include custom skills and a larger command menu", async () => {
  const commandPanelSource = await readFile(commandPanelPath, "utf8");
  const source = await readFile(commandSuggestionsHookPath, "utf8");

  assert.match(commandPanelSource, /useCommandSuggestions/);
  assert.match(source, /api\.getConfigurableSkills\(\)/);
  assert.match(source, /const loadCommandSuggestions = useCallback/);
  assert.match(commandPanelSource, /onFocus=\{\(\) => \{ void loadCommandSuggestions\(\); \}\}/);
  assert.match(commandPanelSource, /onClose=\{resetCommandPanel\}/);
  assert.match(source, /status !== 'active'/);
  assert.match(source, /skill\.slash/);
  assert.match(source, /customSkill\?: boolean/);
  assert.match(source, /customSkill: true/);
  assert.match(source, /setSuggestions\(matched\.slice\(0, 12\)\)/);
  assert.doesNotMatch(source, /setSuggestions\(matched\.slice\(0, 5\)\)/);
});

test("React command panel suggestions expose all built-in workflow labels", async () => {
  const source = await readFile(new URL("../react-ui/src/lib/nativeCommands.ts", import.meta.url), "utf8");

  for (const label of [
    "Set up matter",
    "Prepare matter",
    "Read documents",
    "Source Labels / Document Index",
    "Preview matter context",
    "Find in matter",
    "Create List of Dates",
    "Check matter health",
  ]) {
    const labelIndex = source.indexOf(`label: '${label}'`);
    assert.notEqual(labelIndex, -1, `${label} should exist as a native command label`);
    const commandEnd = source.indexOf("\n  },", labelIndex);
    const commandBlock = source.slice(labelIndex, commandEnd);
    assert.match(commandBlock, /showInCommandPanel: true/, `${label} should be visible in command suggestions`);
  }
});

test("React command handling can invoke configurable skills returned by intent routing", async () => {
  const source = await readFile(new URL("../react-ui/src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /result\.matched_skill_card\?\.configurable/);
  assert.match(source, /runConfigurableSkillFromCommand\(\{[\s\S]*slash: result\.matched_skill/);
  assert.match(source, /api\.runConfigurableSkill\(\{ slash, overwrite, matterName \}\)/);
  assert.match(source, /run\.state === 'requires_overwrite'/);
});

test("React command rail exposes custom skill overwrite confirmation actions", async () => {
  const commandPanelSource = await readFile(commandPanelPath, "utf8");
  const appSource = await readFile(new URL("../react-ui/src/App.tsx", import.meta.url), "utf8");

  assert.match(commandPanelSource, /pendingConfigurableOverwrite/);
  assert.match(commandPanelSource, /onConfirmConfigurableOverwrite/);
  assert.match(commandPanelSource, /onCancelConfigurableOverwrite/);
  assert.match(commandPanelSource, />\s*Run again\s*</);
  assert.match(commandPanelSource, />\s*Keep existing output\s*</);

  assert.match(appSource, /setPendingConfigurableOverwrite/);
  assert.match(appSource, /runConfigurableSkillFromCommand\(\{[\s\S]*slash: pendingConfigurableOverwrite\.slash[\s\S]*matterName: pendingConfigurableOverwrite\.matterName[\s\S]*overwrite: true/);
  assert.match(appSource, /api\.cancelSkillRun\(\{/);
  assert.doesNotMatch(appSource, /Open Skills to review or rerun it/);
});

test("React command suggestions overlay the command input instead of reflowing the panel", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(styles, /\.ai-command-form \{[^}]*position: relative;/s);
  assert.match(styles, /\.command-suggestions \{[^}]*position: absolute;[^}]*bottom: calc\(100% \+ 6px\);[^}]*z-index:/s);
});

test("React command composer supports multi-line questions without moving out of the bottom rail", async () => {
  const commandPanelSource = await readFile(commandPanelPath, "utf8");
  const hookSource = await readFile(commandSuggestionsHookPath, "utf8");
  const styles = await readFile(stylesPath, "utf8");

  assert.match(commandPanelSource, /function growTextarea\(\)/);
  assert.match(commandPanelSource, /<textarea[\s\S]*id="aiCommandInput"[\s\S]*rows=\{1\}/);
  assert.match(commandPanelSource, /e\.key === 'Enter' && !e\.shiftKey/);
  assert.match(commandPanelSource, /requestSubmit\(\)/);
  assert.match(hookSource, /KeyboardEvent<HTMLElement>/);
  assert.match(styles, /\.command-composer \{[^}]*margin-top: auto;/s);
  assert.match(styles, /\.ai-command-form textarea \{[^}]*resize: none;[^}]*overflow-y: hidden;/s);
  assert.match(styles, /\.ai-command-form \.command-panel-input-row \{[^}]*align-items: flex-end;/s);
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
  assert.match(source, />\s*New\s*</);
  assert.match(source, /lastActiveMatterNameRef/);
  assert.match(source, /state\.activeMatter\?\.name/);
});

test("React command quick actions clear stale skill sessions before native commands", async () => {
  const source = await readFile(commandPanelPath, "utf8");
  const functionStart = source.indexOf("function runExampleCommand(command: string)");
  const functionEnd = source.indexOf("async function answerPendingIntentOnce", functionStart);
  const runExampleCommandSource = source.slice(functionStart, functionEnd);

  assert.notEqual(functionStart, -1);
  assert.notEqual(functionEnd, -1);
  assert.match(runExampleCommandSource, /if \(command === 'new skill'\) \{[\s\S]*setSkillIdeaInput\(command\);[\s\S]*return;[\s\S]*\}/);
  assert.match(runExampleCommandSource, /setSkillIdeaInput\(null\);[\s\S]*onCommand\(command\);/);
});

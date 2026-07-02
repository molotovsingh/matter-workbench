import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  BUILTIN_SKILL_COMMAND_ALIASES,
  BUILTIN_SKILL_COMMANDS,
} from "../shared/builtin-skill-commands.mjs";

const nativeCommandsPath = new URL("../react-ui/src/lib/nativeCommands.ts", import.meta.url);
const nativeAliasesPath = new URL("../react-ui/src/lib/nativeCommandAliases.ts", import.meta.url);
const reactAppPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);

test("React native commands mirror shared slash commands and aliases", async () => {
  const [commandsSource, aliasesSource] = await Promise.all([
    readFile(nativeCommandsPath, "utf8"),
    readFile(nativeAliasesPath, "utf8"),
  ]);

  const reactCommands = [...commandsSource.matchAll(/\bcommand:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(reactCommands, [...BUILTIN_SKILL_COMMANDS].sort());

  const reactAliases = [...aliasesSource.matchAll(/\[\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\]/g)]
    .map((match) => [match[1], match[2]])
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(
    reactAliases,
    [...BUILTIN_SKILL_COMMAND_ALIASES].sort(([left], [right]) => left.localeCompare(right)),
  );
});

test("React native command resolver handles aliases before model intent", async () => {
  const commandsSource = await readFile(nativeCommandsPath, "utf8");

  assert.match(commandsSource, /export function resolveNativeCommand/);
  assert.match(commandsSource, /getNativeCommandAlias\(normalized\)/);
  assert.match(commandsSource, /return \{ command: aliasCommand, view: aliasView \}/);
});

test("React app shell uses the shared skill-idea input classifier", async () => {
  const appSource = await readFile(reactAppPath, "utf8");

  assert.match(appSource, /parseSkillIdeaText\(cmd\)/);
  assert.doesNotMatch(appSource, /includes\(['"]create a skill['"]\)/);
  assert.doesNotMatch(appSource, /includes\(['"]new skill['"]\)/);
});

test("React app shell runs The Story directly instead of hiding it behind preparation", async () => {
  const appSource = await readFile(reactAppPath, "utf8");

  assert.match(appSource, /runMatterStoryFromCommand/);
  assert.match(appSource, /nativeResolution\.command === ['"]\/the_story['"]/);
  assert.match(appSource, /api\.runMatterStory\(\{ matterName, overwrite: true \}\)/);
  assert.match(appSource, /20_Workshop\/The Story\.md/);
});

test("React app shell runs procedural posture diagnosis as a native skill", async () => {
  const appSource = await readFile(reactAppPath, "utf8");
  const commandsSource = await readFile(nativeCommandsPath, "utf8");

  assert.match(commandsSource, /command: ['"]\/procedural_posture_diagnosis['"]/);
  assert.match(commandsSource, /label: ['"]Diagnose procedural posture['"]/);
  assert.match(appSource, /runProceduralPostureDiagnosisFromCommand/);
  assert.match(appSource, /nativeResolution\.command === ['"]\/procedural_posture_diagnosis['"]/);
  assert.match(appSource, /api\.getProceduralPostureDiagnosis\(matterName\)/);
  assert.match(appSource, /window\.confirm\(/);
  assert.match(appSource, /api\.runProceduralPostureDiagnosis\(\{ matterName, overwrite \}\)/);
  assert.match(appSource, /20_Workshop\/Case Analysis\/Filing and Procedural Posture Diagnosis\.md/);
});

test("React command panel separates procedural posture chat from saved diagnosis", async () => {
  const commandPanelSource = await readFile(commandPanelPath, "utf8");

  assert.match(commandPanelSource, /shouldShowSavedPostureDiagnosisCta/);
  assert.match(commandPanelSource, /This Assistant answer is chat-only/);
  assert.match(commandPanelSource, /shouldAskProceduralPostureModeChoice/);
  assert.match(commandPanelSource, /setPendingPostureChoice\(cmd\)/);
  assert.match(commandPanelSource, /Quick chat answer/);
  assert.match(commandPanelSource, /Run saved procedural diagnosis/);
  assert.match(commandPanelSource, /onCommand\('\/procedural_posture_diagnosis'\)/);
});

test("React command panel preserves explicit slash commands outside skill mode", async () => {
  const commandPanelSource = await readFile(commandPanelPath, "utf8");

  assert.match(commandPanelSource, /function isExplicitSlashCommand/);
  assert.match(commandPanelSource, /if \(isExplicitSlashCommand\(command\)\) return command/);
  assert.match(commandPanelSource, /\^\\\/\(\?!ask\\b\|research\\b\)\\S\+/);
});

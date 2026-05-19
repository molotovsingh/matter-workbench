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

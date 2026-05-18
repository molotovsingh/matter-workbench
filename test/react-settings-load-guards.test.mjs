import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPagePath = new URL("../react-ui/src/views/SettingsPage.tsx", import.meta.url);

test("React Settings ignores late page-load responses after unmount", async () => {
  const source = await readFile(settingsPagePath, "utf8");

  assert.match(source, /let cancelled = false;/);
  assert.match(source, /api\.getConfig\(\)\.then[\s\S]*if \(cancelled\) return;[\s\S]*setMattersHome/);
  assert.match(source, /api\.getAiSettings\(\)\.then[\s\S]*if \(cancelled\) return;[\s\S]*setSettings/);
  assert.match(source, /api\.getSkills\(\)\.then[\s\S]*if \(cancelled\) return;[\s\S]*setSkills/);
  assert.match(source, /return \(\) => \{\s*cancelled = true;\s*\};/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPagePath = new URL("../react-ui/src/views/SettingsPage.tsx", import.meta.url);

test("React Settings ignores late page-load responses after unmount", async () => {
  const source = await readFile(settingsPagePath, "utf8");

  assert.match(source, /let cancelled = false;/);
  assert.match(source, /const loadSettingsData = useCallback/);
  assert.match(source, /Promise\.allSettled\(\[/);
  assert.match(source, /api\.getConfig\(\)/);
  assert.match(source, /api\.getAiSettings\(\)/);
  assert.match(source, /api\.getSkills\(\)/);
  assert.match(source, /if \(isCancelled\(\)\) return;/);
  assert.match(source, /void loadSettingsData\(\(\) => cancelled\);/);
  assert.match(source, /setMattersHome/);
  assert.match(source, /setRuntimeStorageMode/);
  assert.match(source, /isRuntimeDbWorkspace/);
  assert.match(source, /DB workspace/);
  assert.match(source, /There is no local matters folder to configure/);
  assert.match(source, /setSettings/);
  assert.match(source, /setSkills/);
  assert.match(source, /return \(\) => \{\s*cancelled = true;\s*\};/);
});

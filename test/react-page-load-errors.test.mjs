import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const activityPagePath = new URL("../react-ui/src/views/ActivityPage.tsx", import.meta.url);
const settingsPagePath = new URL("../react-ui/src/views/SettingsPage.tsx", import.meta.url);

test("React Activity page keeps load failures local and retryable", async () => {
  const source = await readFile(activityPagePath, "utf8");

  assert.match(source, /const loadActivityRuns = useCallback/);
  assert.match(source, /Try again/);
  assert.doesNotMatch(source, /\[activity\] load failed/);
});

test("React Settings page keeps initial load failures local and retryable", async () => {
  const source = await readFile(settingsPagePath, "utf8");

  assert.match(source, /const loadSettingsData = useCallback/);
  assert.match(source, /Retry loading settings/);
  assert.doesNotMatch(source, /\[settings\] config load failed/);
  assert.doesNotMatch(source, /\[settings\] AI settings load failed/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appContextPath = new URL("../react-ui/src/store/AppContext.tsx", import.meta.url);
const activityBarPath = new URL("../react-ui/src/components/layout/ActivityBar.tsx", import.meta.url);
const sidebarPath = new URL("../react-ui/src/components/layout/Sidebar.tsx", import.meta.url);

test("React matter changes clear matter-scoped preview state", async () => {
  const source = await readFile(appContextPath, "utf8");

  assert.match(source, /RESET_MATTER_TRANSIENT_VIEW/);
  assert.match(
    source,
    /case 'RESET_MATTER_TRANSIENT_VIEW':\s*return \{ \.\.\.state, activeView: 'home', filePreview: null, activeFilePath: null \};/,
  );
  assert.match(
    source,
    /const clearActiveMatter = useCallback[\s\S]*dispatch\(\{ type: 'RESET_MATTER_TRANSIENT_VIEW' \}\);/,
  );
  assert.match(
    source,
    /const switchActiveMatter = useCallback[\s\S]*setActiveMatter\(activeMatter\);\s*dispatch\(\{ type: 'RESET_MATTER_TRANSIENT_VIEW' \}\);/,
  );
});

test("React rail Home keeps the active matter and returns to Matter Home", async () => {
  const source = await readFile(activityBarPath, "utf8");

  assert.match(source, /dispatch\(\{ type: 'SET_TAB', payload: tabId \}\)/);
  assert.match(source, /if \(tabId === 'home'\) \{/);
  assert.match(source, /RESET_MATTER_TRANSIENT_VIEW/);
  assert.match(source, /Matter Home/);
  assert.doesNotMatch(source, /api\.clearActiveMatter\(\)/);
  assert.doesNotMatch(source, /clearActiveMatter\(\)/);
});

test("React activity logo returns to Matter Home without clearing the matter", async () => {
  const source = await readFile(activityBarPath, "utf8");

  assert.match(source, /<button[\s\S]*className="activity-logo"[\s\S]*type="button"[\s\S]*onClick=\{\(\) => \{ handleTabClick\('home'\); \}\}/);
  assert.match(source, /aria-label=\{state\.activeMatter \? 'Go to Matter Home' : 'Go to Matter Workbench home'\}/);
});

test("React sidebar keeps no-matter selection on the Start screen and removes old matter action rail", async () => {
  const source = await readFile(sidebarPath, "utf8");

  assert.doesNotMatch(source, /<MatterPicker/);
  assert.match(source, /Start from the Home screen/);
  assert.match(source, /\{activeMatter && \(/);
  assert.match(source, /Matter Home/);
  assert.match(source, /← All matters/);
  assert.doesNotMatch(source, /Matter Actions/);
  assert.doesNotMatch(source, /SIDEBAR_NATIVE_COMMANDS/);
});

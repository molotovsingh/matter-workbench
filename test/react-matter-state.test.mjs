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

test("React rail Home clears the active matter before showing landing", async () => {
  const source = await readFile(activityBarPath, "utf8");

  assert.match(source, /if \(tabId === 'home' && state\.activeMatter\) \{/);
  assert.match(source, /await api\.clearActiveMatter\(\)/);
  assert.match(source, /clearActiveMatter\(\)/);
  assert.match(source, /dispatch\(\{ type: 'SET_TAB', payload: tabId \}\)/);
});

test("React activity logo returns to global home, not matter home", async () => {
  const source = await readFile(activityBarPath, "utf8");

  assert.match(source, /<button[\s\S]*className="activity-logo"[\s\S]*type="button"[\s\S]*onClick=\{\(\) => \{ void handleTabClick\('home'\); \}\}/);
  assert.match(source, /aria-label="Go to Matter Workbench home"/);
});

test("React sidebar keeps no-matter selection on the Start screen", async () => {
  const source = await readFile(sidebarPath, "utf8");

  assert.doesNotMatch(source, /<MatterPicker/);
  assert.match(source, /Start from the Home screen/);
  assert.match(source, /\{activeMatter && \(/);
});

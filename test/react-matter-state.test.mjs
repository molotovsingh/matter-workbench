import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const appContextPath = new URL("../react-ui/src/store/AppContext.tsx", import.meta.url);
const sidebarPath = new URL("../react-ui/src/components/layout/Sidebar.tsx", import.meta.url);
const globalCssPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("React matter changes clear matter-scoped preview state and stale resume matter", async () => {
  const source = await readFile(appContextPath, "utf8");

  assert.match(source, /RESET_MATTER_TRANSIENT_VIEW/);
  assert.match(
    source,
    /case 'RESET_MATTER_TRANSIENT_VIEW':\s*return \{ \.\.\.state, activeView: 'home', filePreview: null, activeFilePath: null \};/,
  );
  assert.match(
    source,
    /const clearActiveMatter = useCallback[\s\S]*dispatch\(\{ type: 'SET_RESUME_MATTER', payload: null \}\);[\s\S]*dispatch\(\{ type: 'RESET_MATTER_TRANSIENT_VIEW' \}\);/,
  );
  assert.match(
    source,
    /const switchActiveMatter = useCallback[\s\S]*dispatch\(\{ type: 'SET_RESUME_MATTER', payload: name \}\);[\s\S]*setActiveMatter\(activeMatter\);\s*dispatch\(\{ type: 'RESET_MATTER_TRANSIENT_VIEW' \}\);/,
  );
});

test("React Matter Assistant falls back to resumed matter during post-login matter restore", async () => {
  const source = await readFile(appPath, "utf8");

  assert.match(source, /matterName = state\.activeMatter\?\.name \?\? state\.resumeMatterName \?\? null/);
  assert.match(source, /const matterName = state\.activeMatter\?\.name \?\? state\.resumeMatterName \?\? null/);
  assert.match(source, /state\.resumeMatterName/);
});

test("React active matter card keeps the active matter and returns to Matter Home", async () => {
  const source = await readFile(sidebarPath, "utf8");
  const returnToMatterHomeBody = source.match(/function returnToMatterHome\(\) \{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(source, /function returnToMatterHome\(\)/);
  assert.match(returnToMatterHomeBody, /dispatch\(\{ type: 'SET_TAB', payload: 'home' \}\)/);
  assert.match(returnToMatterHomeBody, /RESET_MATTER_TRANSIENT_VIEW/);
  assert.match(source, /className="active-matter-card"[\s\S]*onClick=\{returnToMatterHome\}/);
  assert.match(source, /Matter Home/);
  assert.doesNotMatch(returnToMatterHomeBody, /api\.clearActiveMatter\(\)/);
  assert.doesNotMatch(returnToMatterHomeBody, /clearActiveMatter\(\)/);
});

test("React sidebar brand returns to App Home and clears the active matter", async () => {
  const source = await readFile(sidebarPath, "utf8");

  assert.match(source, /function returnToAppHome\(\)/);
  assert.match(source, /api\.clearActiveMatter\(\)/);
  assert.match(source, /clearActiveMatter\(\)/);
  assert.match(source, /className="sidebar-brand"/);
  assert.match(source, /aria-label="Go to Matter Workbench home"/);
  assert.match(source, /onClick=\{\(\) => \{ void returnToAppHome\(\); \}\}/);
});

test("React sidebar is the single nav rail with Matter Record and All matters", async () => {
  const [app, source, css] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(sidebarPath, "utf8"),
    readFile(globalCssPath, "utf8"),
  ]);

  assert.doesNotMatch(app, /<ActivityBar/);
  assert.doesNotMatch(css, /activity-(bar|logo|item|icon|label|spacer)/);
  assert.doesNotMatch(source, /<MatterPicker/);
  assert.match(source, /Start from the Home screen/);
  assert.match(source, /aria-label="Matter record"/);
  assert.match(source, /Add files/);
  assert.match(source, /Refresh/);
  assert.match(source, /Show technical: operator only/);
  assert.match(source, /showActions=\{false\}/);
  assert.match(source, /onViewAllMatters/);
  assert.match(source, /All matters/);
  assert.match(source, /See all matters or open another matter/);
  assert.doesNotMatch(source, /Matter Actions/);
  assert.doesNotMatch(source, /SIDEBAR_NATIVE_COMMANDS/);
});

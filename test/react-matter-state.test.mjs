import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const appContextPath = new URL("../react-ui/src/store/AppContext.tsx", import.meta.url);
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

test("React single rail Home keeps the active matter and returns to Matter Home", async () => {
  const source = await readFile(sidebarPath, "utf8");

  assert.match(source, /function returnToMatterHome\(\)/);
  assert.match(source, /dispatch\(\{ type: 'SET_TAB', payload: 'home' \}\)/);
  assert.match(source, /RESET_MATTER_TRANSIENT_VIEW/);
  assert.match(source, /Matter Home/);
  assert.doesNotMatch(source, /api\.clearActiveMatter\(\)/);
  assert.doesNotMatch(source, /clearActiveMatter\(\)/);
});

test("React sidebar brand returns to Matter Home without clearing the matter", async () => {
  const source = await readFile(sidebarPath, "utf8");

  assert.match(source, /className="sidebar-brand"/);
  assert.match(source, /aria-label=\{activeMatter \? 'Go to Matter Home' : 'Go to Matter Workbench home'\}/);
  assert.match(source, /onClick=\{returnToMatterHome\}/);
});

test("React sidebar is the single nav rail with Matter Record and All matters", async () => {
  const [app, source] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(sidebarPath, "utf8"),
  ]);

  assert.doesNotMatch(app, /<ActivityBar/);
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

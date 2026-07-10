import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const homeLandingPath = new URL("../react-ui/src/views/HomeLanding.tsx", import.meta.url);
const sidebarPath = new URL("../react-ui/src/components/layout/Sidebar.tsx", import.meta.url);
const stylesPath = new URL("../react-ui/src/styles/global.css", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React Home renders a simple personalized Start screen when no matter is active", async () => {
  const [app, homeLanding, sidebar, styles, types] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(homeLandingPath, "utf8"),
    readFile(sidebarPath, "utf8"),
    readFile(stylesPath, "utf8"),
    readFile(typesPath, "utf8"),
  ]);

  assert.match(types, /export interface AuthUser/);
  assert.match(types, /authUser: AuthUser \| null/);
  assert.match(app, /dispatch\(\{ type: 'SET_CONFIG', payload: \{ authUser: status\.user/);
  assert.match(homeLanding, /function getDisplayName/);
  assert.match(homeLanding, /What do you want to do today\?/);
  assert.match(homeLanding, /Add a new matter/);
  assert.match(homeLanding, /Find an existing matter/);
  assert.match(homeLanding, /Learn how this works/);
  assert.match(homeLanding, /useState\(true\)/);
  assert.match(homeLanding, /Matter Workbench helps you turn uploaded records into a prepared matter/);
  assert.match(homeLanding, /setMatterBrowserOpen\(true\)/);
  assert.match(homeLanding, /onNewMatter/);
  assert.match(sidebar, /Start from the Home screen/);
  assert.doesNotMatch(sidebar, /!activeMatter && <MatterPicker/);
  assert.match(styles, /\.home-start-actions/);
  assert.match(styles, /\.home-learn-panel/);
});

test("React app logo goes to App Home and clears any active matter", async () => {
  const sidebar = await readFile(sidebarPath, "utf8");

  assert.match(sidebar, /aria-label="Go to Matter Workbench home"/);
  assert.match(sidebar, /returnToAppHome/);
  assert.match(sidebar, /api\.clearActiveMatter\(\)/);
  assert.match(sidebar, /clearActiveMatter\(\)/);
  assert.match(sidebar, /RESET_MATTER_TRANSIENT_VIEW/);
  assert.match(sidebar, /onClick=\{\(\) => \{ void returnToAppHome\(\); \}\}/);
});

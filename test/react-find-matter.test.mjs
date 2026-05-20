import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const mainContentPath = new URL("../react-ui/src/components/layout/MainContent.tsx", import.meta.url);
const homeLandingPath = new URL("../react-ui/src/views/HomeLanding.tsx", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React Find a matter opens a visible matter browser instead of no-op Home", async () => {
  const [app, commandPanel, mainContent, homeLanding, types] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(commandPanelPath, "utf8"),
    readFile(mainContentPath, "utf8"),
    readFile(homeLandingPath, "utf8"),
    readFile(typesPath, "utf8"),
  ]);

  assert.match(types, /'find-matter'/);
  assert.match(app, /const openMatterFinder = useCallback/);
  assert.match(app, /api\.clearActiveMatter\(\)/);
  assert.match(app, /setActiveView\('find-matter'\)/);
  assert.match(app, /await openMatterFinder\(\)/);
  assert.match(commandPanel, /function runExampleCommand\(command: string\)/);
  assert.match(commandPanel, /onCommand\(command\)/);
  assert.match(commandPanel, /'find a matter'/);
  assert.match(mainContent, /showMatterBrowser=\{activeView === 'find-matter'\}/);
  assert.match(homeLanding, /showMatterBrowser/);
  assert.match(homeLanding, /home-matter-browser/);
  assert.match(homeLanding, /Search by matter, client, type, or folder/);
});

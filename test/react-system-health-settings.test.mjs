import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPath = new URL("../react-ui/src/views/SettingsPage.tsx", import.meta.url);
const systemHealthPanelPath = new URL("../react-ui/src/components/settings/SystemHealthPanel.tsx", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React Settings page includes read-only system health surface", async () => {
  const settingsSource = await readFile(settingsPath, "utf8");
  const panelSource = await readFile(systemHealthPanelPath, "utf8");

  assert.match(settingsSource, /api\.getSystemHealth\(\)/);
  assert.match(settingsSource, /canSeeOperatorSurface\(state\.authEnabled, state\.authUser\)/);
  assert.match(settingsSource, /<SystemHealthPanel/);
  assert.match(panelSource, /<h2>System Health<\/h2>/);
  assert.match(panelSource, /Technical health checks/);
  assert.match(panelSource, /systemHealthNeedsAttention/);
});

test("React API client exposes system health response type", async () => {
  const apiSource = await readFile(apiClientPath, "utf8");
  const typesSource = await readFile(typesPath, "utf8");

  assert.match(typesSource, /export interface SystemHealthReport/);
  assert.match(typesSource, /SystemHealthCheck/);
  assert.match(apiSource, /getSystemHealth: \(\) => getJson<SystemHealthReport>\('\/api\/system-health'\)/);
});

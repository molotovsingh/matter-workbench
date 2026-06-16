import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPath = new URL("../react-ui/src/views/SettingsPage.tsx", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React Settings page includes read-only system health surface", async () => {
  const source = await readFile(settingsPath, "utf8");

  assert.match(source, /api\.getSystemHealth\(\)/);
  assert.match(source, /canSeeOperatorSurface\(state\.authEnabled, state\.authUser\)/);
  assert.match(source, /<h2>System Health<\/h2>/);
  assert.match(source, /Technical health checks/);
  assert.match(source, /systemHealthNeedsAttention/);
});

test("React API client exposes system health response type", async () => {
  const apiSource = await readFile(apiClientPath, "utf8");
  const typesSource = await readFile(typesPath, "utf8");

  assert.match(typesSource, /export interface SystemHealthReport/);
  assert.match(typesSource, /SystemHealthCheck/);
  assert.match(apiSource, /getSystemHealth: \(\) => getJson<SystemHealthReport>\('\/api\/system-health'\)/);
});

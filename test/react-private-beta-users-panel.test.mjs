import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPagePath = new URL("../react-ui/src/views/SettingsPage.tsx", import.meta.url);
const betaAccessPanelPath = new URL("../react-ui/src/components/settings/BetaAccessPanel.tsx", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React Settings gates beta tester access panel to superusers", async () => {
  const source = await readFile(settingsPagePath, "utf8");
  const panelSource = await readFile(betaAccessPanelPath, "utf8");

  assert.match(source, /state\.authUser\?\.role === 'superuser'/);
  assert.match(source, /<BetaAccessPanel/);
  assert.match(panelSource, /Beta access/);
  assert.match(source, /api\.getPrivateBetaUsers\(\)/);
  assert.match(source, /api\.createPrivateBetaTester\(/);
  assert.match(source, /api\.resetPrivateBetaTesterPassword\(/);
  assert.match(source, /api\.disablePrivateBetaTester\(/);
  assert.match(source, /api\.enablePrivateBetaTester\(/);
});

test("React API client exposes private beta user-management helpers", async () => {
  const apiSource = await readFile(apiClientPath, "utf8");
  const typeSource = await readFile(typesPath, "utf8");

  assert.match(typeSource, /export interface PrivateBetaUser/);
  assert.match(typeSource, /export interface PrivateBetaUserList/);
  assert.match(typeSource, /export interface PrivateBetaUserResponse/);
  assert.match(apiSource, /getPrivateBetaUsers: \(\) => getJson<PrivateBetaUserList>\('\/api\/private-beta\/users'\)/);
  assert.match(apiSource, /createPrivateBetaTester: \(body: PrivateBetaUserCreateRequest\)/);
  assert.match(apiSource, /resetPrivateBetaTesterPassword: \(username: string\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("React shell checks auth before loading product data", async () => {
  const source = await readFile(new URL("../react-ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /api\.getAuthStatus\(\)/);
  assert.match(source, /setAuthRequiredHandler/);
  assert.match(source, /if \(!authStatus\?\.authenticated\) return undefined;/);
  assert.match(source, /<PrivateBetaLogin/);
  assert.match(source, /api\.login\(\{ username, password \}\)/);
  assert.match(source, /api\.logout\(\)/);
});

test("React auth gate renders after AppShell hooks are declared", async () => {
  const source = await readFile(new URL("../react-ui/src/App.tsx", import.meta.url), "utf8");
  const commandRunnerHook = source.indexOf("const runConfigurableSkillFromCommand = useCallback");
  const authLoadingGate = source.indexOf("if (!authStatus) {");
  assert.notEqual(commandRunnerHook, -1, "command runner hook marker changed unexpectedly");
  assert.notEqual(authLoadingGate, -1, "auth loading gate marker changed unexpectedly");
  assert.ok(commandRunnerHook < authLoadingGate, "auth gate must not return before later AppShell hooks");
});

test("React private beta login fields have explicit accessible labels", async () => {
  const source = await readFile(new URL("../react-ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /<label htmlFor="private-beta-username">/);
  assert.match(source, /id="private-beta-username"/);
  assert.match(source, /<label htmlFor="private-beta-password">/);
  assert.match(source, /id="private-beta-password"/);
});

test("React API client exposes private beta auth helpers", async () => {
  const source = await readFile(new URL("../react-ui/src/api/client.ts", import.meta.url), "utf8");
  assert.match(source, /getAuthStatus: \(\) => getJson/);
  assert.match(source, /login: \(body: \{ username: string; password: string \}\)/);
  assert.match(source, /logout: \(\) => postJson/);
  assert.match(source, /isAuthRequiredError/);
  assert.match(source, /setAuthRequiredHandler/);
  assert.doesNotMatch(source, /this\.authRequired = statusCode === 401/);
});

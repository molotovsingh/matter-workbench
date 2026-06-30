import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reactApiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const appShellRoutesPath = new URL("../routes/app-shell-routes.mjs", import.meta.url);

test("React config fetch bypasses browser and intermediary cache", async () => {
  const source = await readFile(reactApiClientPath, "utf8");

  assert.match(source, /async function getFreshJson<T>\(url: string\)/);
  assert.match(source, /fetch\(withCacheBust\(url\), \{/);
  assert.match(source, /cache: 'no-store'/);
  assert.match(source, /'Cache-Control': 'no-store'/);
  assert.match(source, /Pragma: 'no-cache'/);
  assert.match(source, /function withCacheBust\(url: string\)/);
  assert.match(source, /_mwbFresh=/);
  assert.match(source, /getConfig: \(\) => getFreshJson<AppConfig>\('\/api\/config'\)/);
});

test("server config response is explicitly uncacheable", async () => {
  const source = await readFile(appShellRoutesPath, "utf8");
  const routeStart = source.indexOf('exactRoute("GET", "/api/config"');
  assert.notEqual(routeStart, -1);
  const routeSlice = source.slice(routeStart, routeStart + 900);

  assert.match(routeSlice, /response\.setHeader\("cache-control", "no-store"\)/);
  assert.match(routeSlice, /release: releaseConfig\(env\)/);
});

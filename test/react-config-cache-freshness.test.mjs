import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reactApiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const appShellRoutesPath = new URL("../routes/app-shell-routes.mjs", import.meta.url);

test("React config fetch bypasses browser and intermediary cache", async () => {
  const source = await readFile(reactApiClientPath, "utf8");

  assert.match(source, /type GetJsonOptions = \{\s*bypassCache\?: boolean;\s*\}/);
  assert.match(source, /const CONFIG_CACHE_BUSTER_PARAM = '_mwbFresh'/);
  assert.match(source, /const FRESH_JSON_FETCH_INIT: RequestInit = \{/);
  assert.match(source, /cache: 'no-store'/);
  assert.match(source, /'Cache-Control': 'no-store'/);
  assert.match(source, /Pragma: 'no-cache'/);
  assert.match(source, /async function getJson<T>\(url: string, options: GetJsonOptions = \{\}\)/);
  assert.match(source, /const requestUrl = options\.bypassCache \? withCacheBust\(url\) : url/);
  assert.match(source, /const init = options\.bypassCache \? FRESH_JSON_FETCH_INIT : undefined/);
  assert.match(source, /function withCacheBust\(url: string\)/);
  assert.match(source, /getConfig: \(\) => getJson<AppConfig>\('\/api\/config', \{ bypassCache: true \}\)/);
});

test("server config response is explicitly uncacheable", async () => {
  const source = await readFile(appShellRoutesPath, "utf8");
  const routeStart = source.indexOf('exactRoute("GET", "/api/config"');
  assert.notEqual(routeStart, -1);
  const routeSlice = source.slice(routeStart, routeStart + 900);

  assert.match(routeSlice, /response\.setHeader\("cache-control", "no-store"\)/);
  assert.match(routeSlice, /release: releaseConfig\(env\)/);
});

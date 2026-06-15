import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const titleBarPath = new URL("../react-ui/src/components/layout/TitleBar.tsx", import.meta.url);
const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const cssPath = new URL("../react-ui/src/styles/global.css", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React TitleBar renders workspace mode from config instead of a hardcoded local label", async () => {
  const source = await readFile(titleBarPath, "utf8");

  assert.match(source, /workspaceModeLabel/);
  assert.doesNotMatch(source, /<span className="workspace-mode">Local workspace<\/span>/);
});

test("React AppConfig carries runtime storage mode and display label", async () => {
  const source = await readFile(typesPath, "utf8");
  const appConfigMatch = source.match(/export interface AppConfig \{([\s\S]*?)\n\}/);
  const body = appConfigMatch?.[1] || "";

  assert.match(body, /runtimeStorageMode\?:/);
  assert.match(body, /workspaceModeLabel\?: string/);
  assert.match(body, /release\?:/);
});

test("React TitleBar renders compact release metadata when configured", async () => {
  const titleBar = await readFile(titleBarPath, "utf8");
  const css = await readFile(cssPath, "utf8");

  assert.match(titleBar, /releaseBadgeText/);
  assert.match(titleBar, /className="release-badge"/);
  assert.match(titleBar, /release\?\.commit/);
  assert.match(css, /\.release-badge\s*\{/);
});

test("private beta logout stays inside TitleBar controls instead of floating over workspace mode", async () => {
  const titleBar = await readFile(titleBarPath, "utf8");
  const app = await readFile(appPath, "utf8");
  const css = await readFile(cssPath, "utf8");
  const logoutRule = css.match(/\.private-beta-logout\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(titleBar, /state\.authUser && onLogout/);
  assert.match(titleBar, /className="private-beta-logout"/);
  assert.doesNotMatch(app, /className="private-beta-logout"/);
  assert.doesNotMatch(logoutRule, /position\s*:\s*fixed/);
  assert.doesNotMatch(logoutRule, /right\s*:/);
  assert.doesNotMatch(logoutRule, /top\s*:/);
});

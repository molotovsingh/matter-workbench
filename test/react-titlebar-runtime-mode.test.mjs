import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const titleBarPath = new URL("../react-ui/src/components/layout/TitleBar.tsx", import.meta.url);
const sidebarPath = new URL("../react-ui/src/components/layout/Sidebar.tsx", import.meta.url);
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
  assert.match(body, /maxUploadBytes\?: number/);
  assert.match(body, /copilotWebResearchEnabled\?: boolean/);
  assert.match(body, /release\?:/);
  assert.match(body, /date\?: string/);
});

test("React TitleBar renders compact release metadata when configured", async () => {
  const titleBar = await readFile(titleBarPath, "utf8");
  const css = await readFile(cssPath, "utf8");

  assert.match(titleBar, /releaseBadgeText/);
  assert.match(titleBar, /releaseBadgeDate/);
  assert.match(titleBar, /className="release-badge"/);
  assert.match(titleBar, /release\?\.commit/);
  assert.match(css, /\.release-badge\s*\{/);
});

test("private beta sign-out lives in the sidebar account footer, not the titlebar or floating over workspace mode", async () => {
  const titleBar = await readFile(titleBarPath, "utf8");
  const sidebar = await readFile(sidebarPath, "utf8");
  const app = await readFile(appPath, "utf8");
  const css = await readFile(cssPath, "utf8");
  const footerRule = css.match(/\.sidebar-footer\s*\{([^}]*)\}/)?.[1] || "";

  // Sign out is gated by auth + onLogout and rendered in the pinned sidebar footer.
  assert.match(sidebar, /state\.authUser && onLogout/);
  assert.match(sidebar, /nav-item-signout/);
  assert.match(sidebar, /className="sidebar-footer"/);
  // It no longer lives in the titlebar.
  assert.doesNotMatch(titleBar, /onLogout/);
  assert.doesNotMatch(titleBar, /Sign out/);
  // App wires logout into the sidebar.
  assert.match(app, /<Sidebar[\s\S]*?onLogout=\{[\s\S]*?handleLogout/);
  // The footer is part of the normal sidebar flow, not floated over the workspace.
  assert.doesNotMatch(footerRule, /position\s*:\s*fixed/);
});

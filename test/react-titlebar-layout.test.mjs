import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainContentPath = new URL("../react-ui/src/components/layout/MainContent.tsx", import.meta.url);
const titleBarPath = new URL("../react-ui/src/components/layout/TitleBar.tsx", import.meta.url);
const cssPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("TitleBar lives inside editor pane so assistant rail starts at top", async () => {
  const mainContent = await readFile(mainContentPath, "utf8");
  const css = await readFile(cssPath, "utf8");

  assert.match(mainContent, /<section className="editor-layout"/);
  assert.match(mainContent, /<div className="editor-pane">\s*<TitleBar onLogout=\{onLogout\} \/>/);
  assert.doesNotMatch(mainContent, /<main className="main-panel">\s*<TitleBar/);
  assert.match(css, /grid-template-rows: minmax\(0, 1fr\) 24px/);
  assert.match(css, /\.editor-pane > \.titlebar/);
});

test("TitleBar uses compact workspace and release labels", async () => {
  const titleBar = await readFile(titleBarPath, "utf8");

  assert.match(titleBar, /compactWorkspaceModeLabel/);
  assert.match(titleBar, /return 'DB'/);
  assert.match(titleBar, /return 'Local'/);
  assert.match(titleBar, /commit\.slice\(0, 7\)/);
  assert.doesNotMatch(titleBar, /label, date, shortCommit/);
});

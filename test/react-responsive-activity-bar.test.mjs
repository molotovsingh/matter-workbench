import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const reactCssPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("React compact viewport keeps the single nav rail icon-visible", async () => {
  const css = await readFile(reactCssPath, "utf8");
  const productionCss = css.split("/* ─── Production nav shell transition").at(-1) || "";
  const compactMedia = productionCss.match(/@media \(max-width: 1100px\) \{([\s\S]*?)@media \(max-width: 700px\)/)?.[1] || "";

  assert.match(compactMedia, /\.app-shell,\s*\.app-shell\.home-mode \{ grid-template-columns: 64px/);
  assert.match(compactMedia, /\.sidebar-brand strong,\s*\.sidebar-brand span,\s*\.sidebar-label/);
  assert.match(compactMedia, /\.nav-item span:not\(\.nav-icon\)/);
  assert.match(compactMedia, /\.nav-item \{[^}]*width: 36px/);
  assert.match(compactMedia, /\.nav-icon \{[^}]*flex-basis: 18px/);
});

test("React command panel keeps long copilot answers scrollable above the input", async () => {
  const css = await readFile(reactCssPath, "utf8");
  const productionCss = css.split("/* ─── Production nav shell transition").at(-1) || "";
  const copyRule = productionCss.match(/\.command-panel-copy \{([\s\S]*?)\}/g)?.at(-1) || "";

  assert.match(copyRule, /flex:\s*1 1 auto/);
  assert.match(copyRule, /max-height:\s*min\(46vh,\s*520px\)/);
  assert.match(copyRule, /overflow-y:\s*auto/);
  assert.match(copyRule, /scrollbar-gutter:\s*stable/);
  assert.match(copyRule, /scrollbar-width:\s*thin/);
  assert.match(css, /\.command-panel-copy::-webkit-scrollbar-thumb/);
});

test("React phone viewport keeps only the compact rail and main column", async () => {
  const css = await readFile(reactCssPath, "utf8");
  const productionCss = css.split("/* ─── Production nav shell transition").at(-1) || "";
  const phoneMedia = productionCss.match(/@media \(max-width: 700px\) \{([\s\S]*?)\}\s*$/)?.[1] || "";

  assert.match(phoneMedia, /\.app-shell,\s*\.app-shell\.home-mode \{ grid-template-columns: 48px minmax\(0,1fr\); \}/);
  assert.match(phoneMedia, /\.sidebar \{ display: flex; \}/);
  assert.match(phoneMedia, /\.main-panel \{ grid-column: 2; \}/);
  assert.match(phoneMedia, /\.titlebar \{[^}]*padding: 0 12px/);
  assert.match(phoneMedia, /\.editor-content \{[^}]*padding: 30px 20px/);
});

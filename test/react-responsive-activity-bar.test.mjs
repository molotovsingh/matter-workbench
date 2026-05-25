import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const reactCssPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("React compact viewport keeps the activity rail icon-visible", async () => {
  const css = await readFile(reactCssPath, "utf8");
  const compactMedia = css.match(/@media \(max-width: 1100px\) \{([\s\S]*?)\/\* ─── Skill Idea Session/m)?.[1] || "";

  assert.match(compactMedia, /\.app-shell \{ grid-template-columns: 48px/);
  assert.match(compactMedia, /\.activity-bar \{[^}]*align-items: center/);
  assert.match(compactMedia, /\.activity-label \{ display: none; \}/);
  assert.match(compactMedia, /\.activity-item \{[^}]*width: 36px/);
  assert.match(compactMedia, /\.activity-icon \{[^}]*flex-basis: 18px/);
});

test("React command panel keeps long copilot answers scrollable above the input", async () => {
  const css = await readFile(reactCssPath, "utf8");
  const copyRule = css.match(/\.command-panel-copy \{([\s\S]*?)\}/)?.[1] || "";

  assert.match(copyRule, /flex:\s*1 1 auto/);
  assert.match(copyRule, /max-height:\s*min\(46vh,\s*520px\)/);
  assert.match(copyRule, /overflow-y:\s*auto/);
  assert.match(copyRule, /scrollbar-gutter:\s*stable/);
  assert.match(copyRule, /scrollbar-width:\s*thin/);
  assert.match(css, /\.command-panel-copy::-webkit-scrollbar-thumb/);
});

test("React phone viewport does not reserve the desktop matter sidebar column", async () => {
  const css = await readFile(reactCssPath, "utf8");
  const phoneMedia = css.match(/@media \(max-width: 700px\) \{([\s\S]*?)\/\* ─── Skill Idea Session/m)?.[1] || "";

  assert.match(phoneMedia, /\.app-shell,\s*\.app-shell\.home-mode \{ grid-template-columns: 48px minmax\(0,1fr\); \}/);
  assert.match(phoneMedia, /\.sidebar \{ display: none; \}/);
  assert.match(phoneMedia, /\.main-panel \{ grid-column: 2; \}/);
  assert.match(phoneMedia, /\.titlebar \{[^}]*padding: 0 12px/);
  assert.match(phoneMedia, /\.editor-content \{[^}]*padding: 30px 20px/);
});

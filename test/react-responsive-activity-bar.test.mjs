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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("React global CSS defines beta auth tokens and visible file-tree focus", async () => {
  const css = await readFile(cssPath, "utf8");

  assert.match(css, /--app-bg:/);
  assert.match(css, /--shadow-soft:/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{[^}]*--c-bg:/s);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{[^}]*--c-assistant-bg:/s);
  assert.match(css, /\.section-kicker\s*\{/);
  assert.match(css, /\.tree-file-button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-gold\)/s);
  assert.doesNotMatch(css, /\.tree-file-button:hover,\s*\.tree-file-button:focus\s*\{[^}]*outline:\s*none/s);
});

test("React global CSS gives common interactive controls visible keyboard focus", async () => {
  const css = await readFile(cssPath, "utf8");

  assert.match(css, /button:focus-visible,/);
  assert.match(css, /\[role="button"\]:focus-visible,/);
  assert.match(css, /input:focus-visible,/);
  assert.match(css, /select:focus-visible,/);
  assert.match(css, /textarea:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-gold\)/s);
});

test("React global CSS styles upload and document preview classes used by product views", async () => {
  const css = await readFile(cssPath, "utf8");

  for (const className of [
    "drop-actions",
    "file-list",
    "file-list-summary",
    "file-list-entry",
    "form-hint",
    "tree-section",
    "document-preview",
    "document-preview-header",
    "chronology-summary",
  ]) {
    assert.match(css, new RegExp(`\\.${className}\\s*\\{`), className);
  }
});

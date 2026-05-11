import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import { renderListOfDatesPreviewActions } from "../frontend/workspace-view.js";

test("workspace preview renders List of Dates markdown actions", () => {
  const html = renderListOfDatesPreviewActions("10_Library/List of Dates.md", escapeHtml);

  assert.match(html, /Copy Markdown/);
  assert.match(html, /Download Markdown/);
  assert.ok(html.includes("/api/file-raw?path=10_Library%2FList%20of%20Dates.md"));
});

test("workspace preview does not render markdown actions for other files", () => {
  const html = renderListOfDatesPreviewActions("10_Library/Source Index.json", escapeHtml);

  assert.equal(html, "");
});

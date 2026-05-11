import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  renderListOfDatesPreviewActions,
  renderTreeNode,
} from "../frontend/workspace-view.js";

test("workspace tree renders human-readable lane labels while preserving folder names", () => {
  const html = renderTreeNode({
    name: "Demo Matter",
    kind: "directory",
    path: "",
    children: [
      {
        name: "10_Library",
        kind: "directory",
        path: "10_Library",
        children: [],
      },
      {
        name: "20_Workshop",
        kind: "directory",
        path: "20_Workshop",
        children: [],
      },
    ],
  });

  assert.match(html, /Analysis Library/);
  assert.match(html, /Workshop/);
  assert.match(html, /tree-canonical-name">10_Library/);
  assert.match(html, /tree-canonical-name">20_Workshop/);
});

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

import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  findTreeNodeByPath,
  renderListOfDatesPreviewActions,
  renderTreeNode,
  renderWorkspaceLaneView,
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
  assert.match(html, /data-directory-path="10_Library"/);
});

test("workspace lane lookup and preview render empty and populated lanes", () => {
  const tree = {
    name: "Demo Matter",
    kind: "directory",
    path: "",
    children: [
      {
        name: "10_Library",
        kind: "directory",
        path: "10_Library",
        children: [
          {
            name: "List of Dates.md",
            kind: "file",
            path: "10_Library/List of Dates.md",
            size: 1200,
          },
        ],
      },
      {
        name: "30_Drafts",
        kind: "directory",
        path: "30_Drafts",
        children: [],
      },
    ],
  };

  const library = findTreeNodeByPath(tree, "10_Library");
  assert.equal(library.name, "10_Library");
  assert.equal(findTreeNodeByPath(tree, "40_Dispatch"), null);

  const libraryHtml = renderWorkspaceLaneView(
    {
      path: "10_Library",
      label: "Analysis Library",
      purpose: "source-backed analysis",
    },
    library,
  );
  assert.match(libraryHtml, /Analysis Library/);
  assert.match(libraryHtml, /source-backed analysis/);
  assert.match(libraryHtml, /List of Dates\.md/);
  assert.match(libraryHtml, /1 files/);

  const draftsHtml = renderWorkspaceLaneView(
    {
      path: "30_Drafts",
      label: "Drafts",
      purpose: "draft legal outputs",
    },
    findTreeNodeByPath(tree, "30_Drafts"),
  );
  assert.match(draftsHtml, /Drafts/);
  assert.match(draftsHtml, /This lane is empty/);
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

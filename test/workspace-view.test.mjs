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
        name: "00_Inbox",
        kind: "directory",
        path: "00_Inbox",
        children: [],
      },
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

  assert.match(html, /Case Record/);
  assert.match(html, /Original Documents/);
  assert.match(html, /Source Record/);
  assert.match(html, /Case Analysis/);
  assert.match(html, /Original files and the app&#39;s indexed source record/);
  assert.match(html, /Extracted text, source labels, and citeable references/);
  assert.match(html, /Chronologies, risks, issue notes, party maps, and strategy/);
  assert.match(html, /tree-canonical-name">00_Inbox/);
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
      label: "Source Record",
      purpose: "extracted text, source labels, and citeable references",
    },
    library,
  );
  assert.match(libraryHtml, /Source Record/);
  assert.match(libraryHtml, /extracted text, source labels, and citeable references/);
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

test("workspace tree groups technical files behind lawyer-facing artifact labels", () => {
  const html = renderTreeNode({
    name: "Demo Matter",
    kind: "directory",
    path: "",
    children: [
      {
        name: "00_Inbox",
        kind: "directory",
        path: "00_Inbox",
        children: [{
          name: "Intake 01 - Initial",
          kind: "directory",
          path: "00_Inbox/Intake 01 - Initial",
          children: [
            {
              name: "Originals",
              kind: "directory",
              path: "00_Inbox/Intake 01 - Initial/Originals",
              children: [],
            },
            {
              name: "_extracted",
              kind: "directory",
              path: "00_Inbox/Intake 01 - Initial/_extracted",
              children: [],
            },
            {
              name: "File Register.csv",
              kind: "file",
              path: "00_Inbox/Intake 01 - Initial/File Register.csv",
              size: 1200,
              previewable: true,
              previewKind: "text",
            },
          ],
        }],
      },
      {
        name: "10_Library",
        kind: "directory",
        path: "10_Library",
        children: [
          {
            name: "Source Index.json",
            kind: "file",
            path: "10_Library/Source Index.json",
            size: 900,
            previewable: true,
            previewKind: "text",
          },
          {
            name: "List of Dates.md",
            kind: "file",
            path: "10_Library/List of Dates.md",
            size: 1200,
            previewable: true,
            previewKind: "text",
          },
          {
            name: "List of Dates.json",
            kind: "file",
            path: "10_Library/List of Dates.json",
            size: 2000,
            previewable: true,
            previewKind: "text",
          },
          {
            name: "List of Dates.csv",
            kind: "file",
            path: "10_Library/List of Dates.csv",
            size: 1500,
            previewable: true,
            previewKind: "text",
          },
        ],
      },
      {
        name: "matter.json",
        kind: "file",
        path: "matter.json",
        size: 500,
        previewable: true,
        previewKind: "text",
      },
    ],
  });

  assert.match(html, /Source Index <span class="tree-canonical-name">Source Index\.json/);
  assert.match(html, /List of Dates <span class="tree-canonical-name">List of Dates\.md/);
  assert.match(html, /Technical files[\s\S]*File Register\.csv/);
  assert.match(html, /Technical files[\s\S]*_extracted/);
  assert.match(html, /Technical files[\s\S]*List of Dates\.json/);
  assert.match(html, /Technical files[\s\S]*List of Dates\.csv/);
  assert.match(html, /Technical files[\s\S]*matter\.json/);
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

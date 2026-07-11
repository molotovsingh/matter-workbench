import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  parseListOfDatesMarkdown,
  renderListOfDatesPreviewActions,
  renderListOfDatesMarkdownPreview,
} from "../frontend/listofdates-markdown-preview.js";
import {
  findTreeNodeByPath,
  renderTreeNode,
  renderWorkspaceLaneView,
} from "../frontend/workspace-view.js";

test("workspace tree renders canonical folder names without aliases", () => {
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

  assert.match(html, /tree-icon-folder/);
  assert.match(html, /00_Inbox/);
  assert.match(html, /10_Library/);
  assert.match(html, /20_Workshop/);
  assert.match(html, /Files received from the client, court, or other side/);
  assert.match(html, /Extracted text, source labels, and citeable references/);
  assert.match(html, /Chronologies, risks, issue notes, party maps, and strategy/);
  assert.doesNotMatch(html, /Case Record/);
  assert.doesNotMatch(html, /Source Record/);
  assert.doesNotMatch(html, /tree-lane-group/);
  assert.doesNotMatch(html, /tree-lane-pill/);
  assert.doesNotMatch(html, /tree-canonical-name/);
  assert.match(html, /data-directory-path="10_Library"/);

  const technicalHtml = renderTreeNode({
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
    ],
  }, 0, { showTechnical: true });
  assert.doesNotMatch(technicalHtml, /tree-canonical-name/);
});

test("workspace area lookup and preview render empty and populated areas", () => {
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
            name: "Case Timeline.md",
            kind: "file",
            path: "10_Library/Case Timeline.md",
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
      label: "10_Library",
      purpose: "extracted text, source labels, and citeable references",
    },
    library,
  );
  assert.match(libraryHtml, /10_Library/);
  assert.match(libraryHtml, /extracted text, source labels, and citeable references/);
  assert.match(libraryHtml, /Case Timeline\.md/);
  assert.match(libraryHtml, /1 files/);

  const draftsHtml = renderWorkspaceLaneView(
    {
      path: "30_Drafts",
      label: "30_Drafts",
      purpose: "draft legal outputs",
    },
    findTreeNodeByPath(tree, "30_Drafts"),
  );
  assert.match(draftsHtml, /30_Drafts/);
  assert.match(draftsHtml, /This workspace area is empty/);
});

test("workspace tree hides technical files by default and exposes them when requested", () => {
  const tree = {
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
            name: "Case Timeline.md",
            kind: "file",
            path: "10_Library/Case Timeline.md",
            size: 1200,
            previewable: true,
            previewKind: "text",
          },
          {
            name: "Case Timeline.json",
            kind: "file",
            path: "10_Library/Case Timeline.json",
            size: 2000,
            previewable: true,
            previewKind: "text",
          },
          {
            name: "Case Timeline.csv",
            kind: "file",
            path: "10_Library/Case Timeline.csv",
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
  };
  const html = renderTreeNode(tree);

  assert.match(html, /Source Index\.json/);
  assert.match(html, /Case Timeline\.md/);
  assert.doesNotMatch(html, /Source Labels/);
  assert.doesNotMatch(html, /tree-canonical-name/);
  assert.doesNotMatch(html, /Technical files/);
  assert.doesNotMatch(html, /File Register\.csv/);
  assert.doesNotMatch(html, /_extracted/);
  assert.doesNotMatch(html, /Case Timeline\.json/);
  assert.doesNotMatch(html, /Case Timeline\.csv/);
  assert.doesNotMatch(html, /matter\.json/);

  const technicalHtml = renderTreeNode(tree, 0, { showTechnical: true });

  assert.match(technicalHtml, /Source Index\.json/);
  assert.match(technicalHtml, /Case Timeline\.md/);
  assert.doesNotMatch(technicalHtml, /tree-canonical-name/);
  assert.match(technicalHtml, /Technical files[\s\S]*Technical files are used by the app/);
  assert.match(technicalHtml, /Technical files[\s\S]*File Register\.csv/);
  assert.match(technicalHtml, /Technical files[\s\S]*_extracted/);
  assert.match(technicalHtml, /Technical files[\s\S]*Case Timeline\.json/);
  assert.match(technicalHtml, /Technical files[\s\S]*Case Timeline\.csv/);
  assert.match(technicalHtml, /Technical files[\s\S]*matter\.json/);
});

test("workspace preview renders Case Timeline markdown actions", () => {
  const html = renderListOfDatesPreviewActions("10_Library/Case Timeline.md", escapeHtml);

  assert.match(html, /Copy Markdown/);
  assert.match(html, /Download/);
  assert.ok(html.includes("/api/file-raw?path=10_Library%2FCase%20Timeline.md"));
});

test("workspace preview does not render markdown actions for other files", () => {
  const html = renderListOfDatesPreviewActions("10_Library/Source Index.json", escapeHtml);

  assert.equal(html, "");
});

test("workspace tree marks the active preview file", () => {
  const html = renderTreeNode({
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
            name: "Case Timeline.md",
            kind: "file",
            path: "10_Library/Case Timeline.md",
            size: 1200,
            previewable: true,
            previewKind: "text",
          },
        ],
      },
    ],
  }, 0, { activeFilePath: "10_Library/Case Timeline.md" });

  assert.match(html, /tree-file-button active/);
  assert.match(html, /aria-current="true"/);
});

test("Case Timeline markdown parser preserves source fragments and escaped pipes", () => {
  const parsed = parseListOfDatesMarkdown(`# Case Timeline

Matter: Ayesha Vs Japan Airlines

Generated by create-listofdates-v1-ai. Review before relying on this chronology.

| Date | Event | Legal Relevance | Source |
|---|---|---|---|
| 2026-03-10 | Client was denied boarding after showing rule A\\|B | Key incident | S3, S5 |
| 2026-03-13 | Airline sent official confirmation | Official confirmation | Airline email (FILE-0001 p1.b1)<br>Consulate email (FILE-0002 p2.b1) |
`);

  assert.equal(parsed.title, "Case Timeline");
  assert.equal(parsed.matter, "Ayesha Vs Japan Airlines");
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].event, "Client was denied boarding after showing rule A|B");
  assert.equal(parsed.entries[0].source, "S3, S5");
  assert.equal(parsed.entries[1].source, "Airline email (FILE-0001 p1.b1)\nConsulate email (FILE-0002 p2.b1)");
  assert.equal(parsed.sourceCount, 4);
  assert.equal(parsed.dateRange, "2026-03-10 to 2026-03-13");
});

test("Case Timeline markdown preview renders a scannable chronology", () => {
  const html = renderListOfDatesMarkdownPreview({
    name: "Case Timeline.md",
    path: "10_Library/Case Timeline.md",
    content: `# Case Timeline

Matter: Ayesha Vs Japan Airlines

Generated by create-listofdates-v1-ai. Review before relying on this chronology.

| Date | Event | Legal Relevance | Source |
|---|---|---|---|
| 2026-02-10 | Consulate confirmed the itinerary qualifies | Official confirmation | S4 |
| 2026-03-10 | Client was compelled to buy a replacement ticket | Financial damage | S3, S5 |
`,
  }, escapeHtml);

  assert.match(html, /document-preview listofdates-preview/);
  assert.match(html, /chronology-table/);
  assert.match(html, /chronology-row important/);
  assert.match(html, /chronology-relevance official/);
  assert.match(html, /chronology-relevance attention/);
  assert.match(html, /2 entries/);
  assert.match(html, /3 sources cited/);
  assert.match(html, /2026-02-10 to 2026-03-10/);
  assert.match(html, /Copy Markdown/);
  assert.match(html, /Download/);
  assert.doesNotMatch(html, /json-preview/);
});

test("Case Timeline markdown preview hides raw technical citations", () => {
  const html = renderListOfDatesMarkdownPreview({
    name: "Case Timeline.md",
    path: "10_Library/Case Timeline.md",
    content: `# Case Timeline

Matter: Ayesha Vs Japan Airlines

Generated by create-listofdates-v1-ai. Review before relying on this chronology.

| Date | Event | Legal Relevance | Source |
|---|---|---|---|
| 2026-02-10 | Consulate confirmed the itinerary qualifies | Official confirmation | Airline email (FILE-0001 p1.b1)<br>FILE-0002 p2.b1 |
`,
  }, escapeHtml);

  assert.match(html, /Airline email \(page 1\)/);
  assert.match(html, /Source label unavailable \(page 2\)/);
  assert.doesNotMatch(html, /FILE-\d{4}/);
  assert.doesNotMatch(html, /p\d+\.b\d+/);
});

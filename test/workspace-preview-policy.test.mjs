import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_PREVIEW_LIMITS,
  classifyWorkspacePreview,
  getWorkspaceRawContentType,
} from "../shared/workspace-preview-policy.mjs";

test("workspace preview policy classifies text, email, pdf, image, and unsupported files", () => {
  assert.deepEqual(
    classifyWorkspacePreview({ relativePath: "10_Library/List of Dates.md", sizeBytes: 1024 }),
    { previewable: true, previewKind: "text" },
  );
  assert.deepEqual(
    classifyWorkspacePreview({ relativePath: "00_Inbox/Intake 01/Originals/scan.pdf", sizeBytes: 1024 }),
    { previewable: true, previewKind: "pdf" },
  );
  assert.deepEqual(
    classifyWorkspacePreview({ relativePath: "00_Inbox/Intake 01/Originals/photo.jpg", sizeBytes: 1024 }),
    { previewable: true, previewKind: "image" },
  );
  assert.deepEqual(
    classifyWorkspacePreview({ relativePath: "00_Inbox/Intake 01/Originals/brief.docx", sizeBytes: 1024 }),
    { previewable: false, previewKind: null },
  );
});

test("workspace preview policy treats email as text-previewable up to the raw-file cap", () => {
  const largeEmailSize = WORKSPACE_PREVIEW_LIMITS.maxPreviewBytes + 1;
  assert.equal(largeEmailSize < WORKSPACE_PREVIEW_LIMITS.maxRawBytes, true);

  assert.deepEqual(
    classifyWorkspacePreview({ relativePath: "10_Library/large-service.eml", sizeBytes: largeEmailSize }),
    { previewable: true, previewKind: "text" },
  );
  assert.deepEqual(
    classifyWorkspacePreview({ relativePath: "10_Library/too-large-service.eml", sizeBytes: WORKSPACE_PREVIEW_LIMITS.maxRawBytes + 1 }),
    { previewable: false, previewKind: null },
  );
});

test("workspace preview policy requires a DB payload before marking runtime DB files previewable", () => {
  assert.deepEqual(
    classifyWorkspacePreview({ relativePath: "10_Library/List of Dates.md", sizeBytes: 1024, hasPayload: false }),
    { previewable: false, previewKind: null },
  );
  assert.deepEqual(
    classifyWorkspacePreview({ relativePath: "10_Library/List of Dates.md", sizeBytes: 1024, hasPayload: true }),
    { previewable: true, previewKind: "text" },
  );
});

test("workspace preview policy owns raw response content types", () => {
  assert.equal(getWorkspaceRawContentType("10_Library/Source Index.json"), "application/json; charset=utf-8");
  assert.equal(getWorkspaceRawContentType("10_Library/List of Dates.md"), "text/markdown; charset=utf-8");
  assert.equal(getWorkspaceRawContentType("00_Inbox/Intake 01/Originals/scan.pdf"), "application/pdf");
  assert.equal(getWorkspaceRawContentType("00_Inbox/Intake 01/Originals/photo.webp"), "image/webp");
  assert.equal(getWorkspaceRawContentType("00_Inbox/Intake 01/Originals/unknown.bin"), "application/octet-stream");
});

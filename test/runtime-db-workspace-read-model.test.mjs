import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeWorkspaceTree,
  normalizeRuntimeWorkspaceObjectRow,
  publicRuntimeWorkspaceTree,
} from "../services/runtime-db-workspace-read-model.mjs";

test("runtime DB workspace read model builds a sorted matter-relative tree", () => {
  const { root, fileCount, directoryCount } = buildRuntimeWorkspaceTree({
    matter: { name: "State - Rajesh Mehra" },
    objects: [
      objectRow("State - Rajesh Mehra/10_Library/List of Dates.md", {
        objectRole: "matter_artifact",
        sha256: "lod-sha",
        updatedAt: "2026-06-16T10:00:00.000Z",
        hasPayload: true,
      }),
      objectRow("State - Rajesh Mehra/00_Inbox/Intake 01/Originals/fir.pdf", {
        objectRole: "source_original",
        sha256: "fir-sha",
        hasPayload: true,
      }),
      objectRow("State - Rajesh Mehra/10_Library/Source Index.json", {
        objectRole: "matter_artifact",
        hasPayload: false,
      }),
    ],
  });

  assert.equal(fileCount, 3);
  assert.equal(directoryCount, 4);
  assert.deepEqual(root.children.map((child) => child.name), ["00_Inbox", "10_Library"]);

  const library = root.children.find((node) => node.path === "10_Library");
  assert.deepEqual(library.children.map((child) => child.name), ["List of Dates.md", "Source Index.json"]);
  assert.equal(library.children[0].previewKind, "text");
  assert.equal(library.children[0].sha256, "lod-sha");
  assert.equal(library.children[1].previewable, false);
});

test("runtime DB workspace read model public tree hides internal storage metadata", () => {
  const tree = publicRuntimeWorkspaceTree({
    name: "State - Rajesh Mehra",
    kind: "directory",
    path: "",
    children: [
      {
        name: "List of Dates.md",
        kind: "file",
        path: "10_Library/List of Dates.md",
        size: 25,
        previewable: true,
        previewKind: "text",
        objectRole: "matter_artifact",
        sha256: "secret-internal-hash",
        fileId: "FILE-0001",
      },
    ],
  });

  assert.deepEqual(tree, {
    name: "State - Rajesh Mehra",
    kind: "directory",
    path: "",
    children: [
      {
        name: "List of Dates.md",
        kind: "file",
        path: "10_Library/List of Dates.md",
        size: 25,
        previewable: true,
        previewKind: "text",
      },
    ],
  });
});

test("runtime DB workspace read model normalizes DB row aliases and timestamps", () => {
  assert.deepEqual(
    normalizeRuntimeWorkspaceObjectRow({
      object_key: "State - Rajesh Mehra/10_Library/List of Dates.md",
      object_role: "matter_artifact",
      mime_type: "text/markdown",
      size_bytes: "42",
      sha256: "hash",
      updated_at: "2026-06-16 10:15:00+05:30",
      has_payload: true,
      file_id: "FILE-0007",
      original_name: "lod.md",
      document_sha: "doc-sha",
      document_size_bytes: "41",
      duplicate_of: "FILE-0001",
    }),
    {
      objectKey: "State - Rajesh Mehra/10_Library/List of Dates.md",
      objectRole: "matter_artifact",
      mimeType: "text/markdown",
      sizeBytes: 42,
      sha256: "hash",
      updatedAt: "2026-06-16T04:45:00.000Z",
      hasPayload: true,
      fileId: "FILE-0007",
      originalName: "lod.md",
      documentSha: "doc-sha",
      documentSizeBytes: 41,
      duplicateOf: "FILE-0001",
    },
  );
});

test("runtime DB workspace read model rejects stored paths outside the matter root", () => {
  assert.throws(
    () => buildRuntimeWorkspaceTree({
      matter: { name: "State - Rajesh Mehra" },
      objects: [
        objectRow("State - Rajesh Mehra/../secret.txt", { hasPayload: true }),
      ],
    }),
    (error) => error.statusCode === 409 && /outside the matter root/i.test(error.message),
  );
});

function objectRow(objectKey, overrides = {}) {
  return {
    objectKey,
    objectRole: "other",
    mimeType: "application/octet-stream",
    sizeBytes: 10,
    sha256: "",
    updatedAt: "",
    hasPayload: true,
    fileId: "",
    originalName: "",
    documentSha: "",
    documentSizeBytes: 0,
    duplicateOf: "",
    ...overrides,
  };
}

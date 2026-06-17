import assert from "node:assert/strict";
import test from "node:test";

import {
  fileNumberForFileId,
  runtimeUploadImportItemsFromFileRegisterRows,
  sourceRelativePathForImport,
} from "../services/runtime-db-upload-import-items.mjs";

test("runtime upload import items normalize file register custody rows", () => {
  const items = runtimeUploadImportItemsFromFileRegisterRows([
    {
      file_id: "file-0007",
      source_path: "00_Inbox/Intake 02 - 2026-06-15 Follow Up/Source Files/Evidence/FIR.pdf",
      original_path: "00_Inbox/Intake 02 - 2026-06-15 Follow Up/Originals/Evidence/FIR.pdf",
      working_copy_path: "00_Inbox/Intake 02 - 2026-06-15 Follow Up/By Type/PDFs/FILE-0007__fir.pdf",
      original_name: "ignored-when-source-files-marker-exists.pdf",
      sha256: "abc123",
      duplicate_of: "file-0003",
    },
  ]);

  assert.deepEqual(items, [
    {
      relativePath: "00_Inbox/Intake 02 - 2026-06-15 Follow Up/Source Files/Evidence/FIR.pdf",
      originalPath: "00_Inbox/Intake 02 - 2026-06-15 Follow Up/Originals/Evidence/FIR.pdf",
      workingCopyPath: "00_Inbox/Intake 02 - 2026-06-15 Follow Up/By Type/PDFs/FILE-0007__fir.pdf",
      originalRelativePath: "Evidence/FIR.pdf",
      fileNumber: 7,
      fileId: "FILE-0007",
      sha256: "abc123",
      duplicateOf: "FILE-0003",
    },
  ]);
});

test("runtime upload import items fall back to original name outside Source Files paths", () => {
  const items = runtimeUploadImportItemsFromFileRegisterRows([
    {
      file_id: "FILE-0002",
      source_path: "legacy/uploaded-notice.pdf",
      original_name: "Uploaded Notice.pdf",
    },
  ]);

  assert.equal(items[0].originalRelativePath, "Uploaded Notice.pdf");
  assert.equal(sourceRelativePathForImport("legacy/uploaded-notice.pdf"), "");
});

test("runtime upload import items filter unusable register rows", () => {
  const items = runtimeUploadImportItemsFromFileRegisterRows([
    { file_id: "", source_path: "00_Inbox/Source Files/a.pdf" },
    { file_id: "FILE-ABCD", source_path: "00_Inbox/Source Files/b.pdf" },
    { file_id: "FILE-0000", source_path: "" },
    { file_id: "FILE-0004", source_path: "00_Inbox/Source Files/c.pdf" },
  ]);

  assert.deepEqual(items.map((item) => item.fileId), ["FILE-0004"]);
  assert.equal(fileNumberForFileId("FILE-0042"), 42);
  assert.equal(fileNumberForFileId("FILE-ABCD"), 0);
});

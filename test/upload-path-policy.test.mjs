import assert from "node:assert/strict";
import test from "node:test";

import {
  duplicateUploadPathErrorMessage,
  uploadPathCollisionKey,
  validateUploadRelativePath,
  validateUploadRelativePaths,
} from "../shared/upload-path-policy.mjs";

test("upload path policy normalizes safe browser paths", () => {
  assert.equal(validateUploadRelativePath("folder\\notice.pdf"), "folder/notice.pdf");
  assert.equal(validateUploadRelativePath("folder///notice.pdf"), "folder/notice.pdf");
  assert.equal(validateUploadRelativePath(" Folder / Notice.pdf "), "Folder / Notice.pdf");
});

test("upload path policy rejects unsafe upload paths", () => {
  assert.throws(() => validateUploadRelativePath("/tmp/notice.pdf"), /Absolute paths/);
  assert.throws(() => validateUploadRelativePath("C:\\tmp\\notice.pdf"), /Absolute paths/);
  assert.throws(() => validateUploadRelativePath("folder/../notice.pdf"), /Invalid path segment/);
});

test("upload path policy rejects case-insensitive duplicates", () => {
  assert.throws(
    () => validateUploadRelativePaths(["Notice.pdf", "notice.pdf"]),
    (error) => error.statusCode === 400
      && error.code === "upload.duplicate_paths"
      && /conflicts with/i.test(error.message),
  );
});

test("upload path policy exposes stable duplicate diagnostics", () => {
  assert.equal(uploadPathCollisionKey("Evidence/Notice.pdf"), "evidence/notice.pdf");
  assert.equal(
    duplicateUploadPathErrorMessage("Notice.pdf", "Notice.pdf"),
    'Duplicate uploaded file path "Notice.pdf"',
  );
  assert.equal(
    duplicateUploadPathErrorMessage("notice.pdf", "Notice.pdf"),
    'Duplicate uploaded file path "notice.pdf" conflicts with "Notice.pdf"',
  );
});

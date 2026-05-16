import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseUploadJsonField,
  validateUploadPathList,
  writeUploadedFiles,
} from "../services/upload-file-intake.mjs";

test("parseUploadJsonField parses JSON fields and maps bad JSON to 400", () => {
  assert.deepEqual(parseUploadJsonField({ metadata: "{\"ok\":true}" }, "metadata", {}), { ok: true });
  assert.deepEqual(parseUploadJsonField({}, "metadata", { fallback: true }), { fallback: true });

  assert.throws(
    () => parseUploadJsonField({ metadata: "{" }, "metadata", {}),
    (error) => error.statusCode === 400 && /invalid metadata json/i.test(error.message),
  );
});

test("validateUploadPathList requires one relative path per uploaded file", () => {
  const files = [{ index: 0 }, { index: 1 }];
  assert.deepEqual(
    validateUploadPathList({ paths: JSON.stringify(["a.txt", "nested/b.txt"]) }, files),
    ["a.txt", "nested/b.txt"],
  );

  assert.throws(
    () => validateUploadPathList({ paths: JSON.stringify(["a.txt"]) }, files),
    (error) => error.statusCode === 400 && /paths array must match file count/i.test(error.message),
  );
});

test("writeUploadedFiles copies uploads by file index and rejects unsafe paths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "upload-file-intake-"));
  try {
    const destinationRoot = path.join(tempDir, "matter", "00_Inbox", "Source Files");
    const firstTemp = path.join(tempDir, "upload-00000");
    const secondTemp = path.join(tempDir, "upload-00001");
    await writeFile(firstTemp, "first");
    await writeFile(secondTemp, "second");

    await writeUploadedFiles(
      [
        { index: 1, tempPath: secondTemp },
        { index: 0, tempPath: firstTemp },
      ],
      ["letters/notice.txt", "receipts/payment.txt"],
      destinationRoot,
    );

    assert.equal(await readFile(path.join(destinationRoot, "letters", "notice.txt"), "utf8"), "first");
    assert.equal(await readFile(path.join(destinationRoot, "receipts", "payment.txt"), "utf8"), "second");

    await assert.rejects(
      () => writeUploadedFiles([{ index: 0, tempPath: firstTemp }], ["../escape.txt"], destinationRoot),
      (error) => error.statusCode === 400 && /invalid path segment/i.test(error.message),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

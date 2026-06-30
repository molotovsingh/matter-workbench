import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { readFile, rm } from "node:fs/promises";

import { createMultipartUploadHandler } from "../services/multipart-upload.mjs";

function multipartRequest({ boundary = "mwb-test-boundary" } = {}) {
  const request = new PassThrough();
  request.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };
  return { request, boundary };
}

function multipartBody(boundary, { fieldName = "matterName", fieldValue = "Upload Smoke", filename = "note.txt", content = "hello" } = {}) {
  return Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="${fieldName}"`,
    "",
    fieldValue,
    `--${boundary}`,
    `Content-Disposition: form-data; name="files"; filename="${filename}"`,
    "Content-Type: text/plain",
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n"));
}

test("multipart upload handler parses a completed upload", async () => {
  const { request, boundary } = multipartRequest();
  const handle = createMultipartUploadHandler({ maxUploadBytes: 1024 * 1024, maxUploadFiles: 5 });
  const pending = handle(request);

  request.end(multipartBody(boundary, { content: "hello upload" }));

  const upload = await pending;
  try {
    assert.equal(upload.fields.matterName, "Upload Smoke");
    assert.equal(upload.files.length, 1);
    assert.equal(upload.files[0].filename, "note.txt");
    assert.equal(upload.files[0].bytes, 12);
    assert.equal(Buffer.from(upload.files[0].payloadBytes).toString("utf8"), "hello upload");
    assert.equal(await readFile(upload.files[0].tempPath, "utf8"), "hello upload");
  } finally {
    await rm(upload.tempDir, { recursive: true, force: true });
  }
});

test("multipart upload handler rejects and cleans up interrupted uploads", async () => {
  const { request, boundary } = multipartRequest();
  const handle = createMultipartUploadHandler({ maxUploadBytes: 1024 * 1024, maxUploadFiles: 5 });
  const pending = handle(request);

  request.write(Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="files"; filename="large.txt"`,
    "Content-Type: text/plain",
    "",
    "partial body",
  ].join("\r\n")));
  request.emit("aborted");

  await assert.rejects(pending, (error) => {
    assert.equal(error.statusCode, 499);
    assert.equal(error.code, "upload.interrupted");
    assert.match(error.message, /interrupted/i);
    return true;
  });
});

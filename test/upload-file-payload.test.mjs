import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  coerceUploadFilePayloadBytes,
  readUploadFilePayloadBytes,
} from "../services/upload-file-payload.mjs";

test("upload file payload helper prefers payload bytes over numeric size metadata", async () => {
  const bytes = await readUploadFilePayloadBytes({
    bytes: 1024,
    payloadBytes: Buffer.from("actual payload"),
  });

  assert.equal(bytes.toString("utf8"), "actual payload");
});

test("upload file payload helper copies byte-like payload fields", () => {
  const source = new Uint8Array(Buffer.from("typed payload"));
  const bytes = coerceUploadFilePayloadBytes({ buffer: source });
  source[0] = "X".charCodeAt(0);

  assert.equal(bytes.toString("utf8"), "typed payload");
});

test("upload file payload helper falls back to temp path", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-upload-payload-"));
  const tempPath = path.join(tmp, "payload.txt");
  await writeFile(tempPath, "payload from temp path");

  try {
    const bytes = await readUploadFilePayloadBytes({ bytes: 22, tempPath });

    assert.equal(bytes.toString("utf8"), "payload from temp path");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

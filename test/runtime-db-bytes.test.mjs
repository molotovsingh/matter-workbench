import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { sha256Bytes } from "../services/runtime-db-bytes.mjs";

test("runtime DB byte helpers hash payloads deterministically", () => {
  assert.equal(
    sha256Bytes(Buffer.from("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

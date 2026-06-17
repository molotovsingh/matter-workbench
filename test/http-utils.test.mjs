import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { readRequestJson } from "../routes/http-utils.mjs";

test("readRequestJson parses valid JSON", async () => {
  const result = await readRequestJson(Readable.from(['{"ok":true,"count":2}']));
  assert.deepEqual(result, { ok: true, count: 2 });
});

test("readRequestJson returns an empty object for an empty body", async () => {
  const result = await readRequestJson(Readable.from([]));
  assert.deepEqual(result, {});
});

test("readRequestJson throws 413 with a stable code when JSON body exceeds the limit", async () => {
  await assert.rejects(
    () => readRequestJson(Readable.from(['{"payload":"', "x".repeat(12), '"}']), { maxBodyBytes: 20 }),
    (error) => {
      assert.equal(error.statusCode, 413);
      assert.equal(error.code, "http.json_body_too_large");
      assert.match(error.message, /too large/i);
      return true;
    },
  );
});

test("readRequestJson throws 400 with a stable code for invalid JSON", async () => {
  await assert.rejects(
    () => readRequestJson(Readable.from(['{"ok": true'])),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "http.invalid_json_body");
      assert.match(error.message, /invalid json/i);
      return true;
    },
  );
});

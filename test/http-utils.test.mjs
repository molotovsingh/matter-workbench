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

test("readRequestJson throws 413 when JSON body exceeds the limit", async () => {
  await assert.rejects(
    () => readRequestJson(Readable.from(['{"payload":"', "x".repeat(12), '"}']), { maxBodyBytes: 20 }),
    (error) => {
      assert.equal(error.statusCode, 413);
      assert.match(error.message, /too large/i);
      return true;
    },
  );
});

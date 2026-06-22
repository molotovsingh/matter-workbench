import assert from "node:assert/strict";
import test from "node:test";

import { readRuntimeDbPayloadText } from "../services/runtime-db-payload-read-model.mjs";

test("runtime DB payload text reader returns UTF-8 text", () => {
  const text = readRuntimeDbPayloadText({
    matter: { name: "Matter A" },
    relativePath: "matter.json",
    readPayloadRow: ({ matter, relativePath }) => ({
      bytes: Buffer.from(`${matter.name}:${relativePath}`),
    }),
    warnings: [],
  });

  assert.equal(text, "Matter A:matter.json");
});

test("runtime DB payload text reader skips missing and unavailable optional payloads", () => {
  const warnings = [];
  const missing = readRuntimeDbPayloadText({
    matter: { name: "Matter A" },
    relativePath: "missing.json",
    readPayloadRow: () => {
      const error = new Error("not found");
      error.statusCode = 404;
      throw error;
    },
    warnings,
  });
  const unavailable = readRuntimeDbPayloadText({
    matter: { name: "Matter A" },
    relativePath: "unavailable.json",
    readPayloadRow: () => {
      const error = new Error("payload row has no bytes");
      error.statusCode = 409;
      throw error;
    },
    warnings,
  });

  assert.equal(missing, null);
  assert.equal(unavailable, null);
  assert.deepEqual(warnings, [
    "Skipped DB payload unavailable.json: payload is not available in DB custody",
  ]);
});

test("runtime DB payload text reader records unexpected optional read failures", () => {
  const warnings = [];
  const result = readRuntimeDbPayloadText({
    matter: { name: "Matter A" },
    relativePath: "bad.json",
    readPayloadRow: () => {
      throw new Error("decode failed");
    },
    warnings,
  });

  assert.equal(result, null);
  assert.deepEqual(warnings, ["Skipped DB payload bad.json: decode failed"]);
});

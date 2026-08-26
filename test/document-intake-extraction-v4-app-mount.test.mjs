import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createV4IntakeMount } from "../services/document-intake-extraction/integration/app-mount.mjs";

const FAKE_KEYS = {
  GEMINI_API_KEY: "gemini-test-key",
  MISTRAL_API_KEY: "mistral-test-key",
  OPENAI_API_KEY: "openai-test-key",
};

function fakeResponse() {
  const state = { statusCode: 0, body: "", headers: {} };
  return {
    state,
    setHeader(name, value) { state.headers[name] = value; },
    writeHead(statusCode, headers) { state.statusCode = statusCode; Object.assign(state.headers, headers || {}); },
    end(body) { state.body = String(body || ""); },
    get statusCode() { return state.statusCode; },
    set statusCode(value) { state.statusCode = value; },
  };
}

// V4-ISO-001: the mount is the single sanctioned integration point and must
// stay disabled by default.
test("app mount refuses to build without the flag and requires a database when enabled", async () => {
  assert.equal(await createV4IntakeMount({ env: { ...FAKE_KEYS } }), null);
  assert.equal(await createV4IntakeMount({ env: { ...FAKE_KEYS, MWB_V4_INTAKE: "0" } }), null);
  await assert.rejects(
    () => createV4IntakeMount({ env: { ...FAKE_KEYS, MWB_V4_INTAKE: "1" } }),
    /MWB_V4_DB_URL/,
  );
});

test("app mount serves the V4 API under its prefix and plays the bucket for presigned staging PUTs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-mount-"));
  const mount = await createV4IntakeMount({
    env: {
      ...FAKE_KEYS,
      MWB_V4_INTAKE: "1",
      MWB_V4_STORE_ROOT: path.join(root, "store"),
      MWB_V4_SCRATCH_ROOT: path.join(root, "scratch"),
      MWB_V4_TENANT_ID: "tenant-test",
    },
    pool: { connect: async () => { throw new Error("database must not be touched by these requests"); } },
  });
  try {
    assert.equal(mount.prefix, "/api/v4");
    assert.equal(mount.tenantId, "tenant-test");

    const unrelated = await mount.handleRequest({
      request: { method: "GET", url: "/api/matters", headers: {} },
      requestUrl: new URL("http://localhost/api/matters"),
      response: fakeResponse(),
    });
    assert.equal(unrelated, false, "non-V4 paths pass through to the legacy API");

    // A V4 API request routes into the real handler: a create-intake call
    // without an Idempotency-Key is rejected by the handler's own contract
    // before any database work.
    const body = Buffer.from(JSON.stringify({ matterId: "matter-1", files: [] }));
    const apiResponse = fakeResponse();
    const handled = await mount.handleRequest({
      request: {
        method: "POST",
        url: "/api/v4/v1/intakes",
        headers: {},
        async *[Symbol.asyncIterator]() { yield body; },
      },
      requestUrl: new URL("http://localhost/api/v4/v1/intakes"),
      response: apiResponse,
    });
    assert.equal(handled, true);
    assert.equal(apiResponse.state.statusCode, 400);
    assert.match(apiResponse.state.body, /idempotency_key_required/);

    // The store endpoint accepts an emulated presigned PUT and persists the
    // staged bytes with a version marker.
    const putResponse = fakeResponse();
    const staged = Buffer.from("%PDF-1.4 staged bytes");
    const putHandled = await mount.handleRequest({
      request: {
        method: "PUT",
        url: "/api/v4-store/document-intake-extraction/v1/staging/intake-1/file-1/abcd",
        headers: {},
        async *[Symbol.asyncIterator]() { yield staged; },
      },
      requestUrl: new URL("http://localhost/api/v4-store/document-intake-extraction/v1/staging/intake-1/file-1/abcd"),
      response: putResponse,
    });
    assert.equal(putHandled, true);
    assert.equal(putResponse.state.statusCode, 200);
    const written = await readFile(path.join(root, "store", "mwb-v4-app", "document-intake-extraction/v1/staging/intake-1/file-1/abcd"));
    assert.deepEqual(written, staged);
  } finally {
    await mount.stop();
    await rm(root, { recursive: true, force: true });
  }
});

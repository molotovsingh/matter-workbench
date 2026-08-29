import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createExtractionResultDeliver, createV4IntakeMount } from "../services/document-intake-extraction/integration/app-mount.mjs";
import { classifyV4InitializationError, createWorkbenchServer } from "../server.mjs";

const FAKE_KEYS = {
  GEMINI_API_KEY: "gemini-test-key",
  MISTRAL_API_KEY: "mistral-test-key",
  OPENAI_API_KEY: "openai-test-key",
};

test("V4 startup failures have stable non-secret classifications", () => {
  assert.equal(classifyV4InitializationError(Object.assign(new Error("connect ECONNREFUSED postgres://u:secret@db/v4"), { code: "ECONNREFUSED" })), "v4.database_unavailable");
  assert.equal(classifyV4InitializationError(Object.assign(new Error("migration checksum mismatch"), { code: "v4_db.migration_checksum_mismatch" })), "v4.migration_invalid");
  assert.equal(classifyV4InitializationError(Object.assign(new Error("permission denied for table intakes"), { code: "42501" })), "v4.privileges_missing");
  assert.equal(classifyV4InitializationError(new Error("unknown secret=never-return-this")), "v4.initialization_failed");
});

test("flagged-on initialization failure leaves host live and owns only degraded status", async () => {
  const app = await createWorkbenchServer({
    appDir: process.cwd(), host: "127.0.0.1", port: 0,
    env: { ...FAKE_KEYS, MWB_V4_INTAKE: "1" },
    v4IntakeMountFactory: async () => { throw Object.assign(new Error("postgres://runtime:raw-password@127.0.0.1/matter_workbench_v4"), { code: "ECONNREFUSED" }); },
  });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const status = await fetch(`${base}/api/v4/status`);
    assert.equal(status.status, 503);
    assert.equal(status.headers.get("cache-control"), "no-store");
    const body = await status.json();
    assert.deepEqual(body, { ok: false, enabled: true, started: false, code: "v4.database_unavailable" });
    assert.doesNotMatch(JSON.stringify(body), /raw-password|postgres|matter_workbench/);
    assert.equal((await fetch(`${base}/api/v4/v1/intakes`)).status, 404, "non-status V4 routes remain unowned");
    assert.equal((await fetch(`${base}/api/config`)).status, 200, "legacy host route remains healthy");
  } finally { await new Promise((resolve) => app.server.close(resolve)); }
});

test("failed mount is stopped once and never retried in the same process", async () => {
  let starts = 0; let stops = 0;
  const app = await createWorkbenchServer({
    appDir: process.cwd(), host: "127.0.0.1", port: 0,
    env: { ...FAKE_KEYS, MWB_V4_INTAKE: "1" },
    v4IntakeMountFactory: async () => ({ handleRequest: async () => false, start: async () => { starts += 1; throw Object.assign(new Error("permission denied"), { code: "42501" }); }, stop: async () => { stops += 1; } }),
  });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    for (let i = 0; i < 20 && stops === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await fetch(`${base}/api/v4/status`)).status, 503);
    assert.equal(starts, 1); assert.equal(stops, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(starts, 1, "no timer or request remounts V4");
  } finally { await new Promise((resolve) => app.server.close(resolve)); }
});

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

// A pool that answers the upload-authorization lookup for one known token
// digest and throws for anything else — so intake work still fails fast while
// the staging endpoint's real authorization check can be exercised.
function authorizationPool({ tenantId, tokenDigest, intakeId, fileId, expectedBytes, stagedKey }) {
  const row = {
    tenant_id: tenantId,
    intake_id: intakeId,
    file_id: fileId,
    expected_bytes: String(expectedBytes),
    status: "awaiting_upload",
    upload_token_digest: tokenDigest,
    staged_object_key: stagedKey,
    upload_authorization_expires_at: "2999-01-01T00:00:00.000Z",
    upload_authorization_json: null,
    source_sha256: null,
    custody_receipt_json: null,
    committed_at: null,
  };
  return {
    async connect() {
      return {
        async query(sql, params) {
          if (/^begin$|set_config|^commit$|^rollback$/i.test(String(sql).trim())) return { rows: [] };
          if (/from document_intake_extraction\.intake_files/i.test(String(sql)) && /upload_token_digest/i.test(String(sql))) {
            return { rows: params && params[1] === tokenDigest ? [row] : [] };
          }
          throw new Error(`unexpected query in authorizationPool: ${String(sql).slice(0, 60)}`);
        },
        release() {},
      };
    },
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

// With MWB_V4_S3_* configured the mount runs custody against the real bucket:
// the status route says so, and the emulated staging endpoint refuses writes
// because every legitimate presigned URL points at the bucket itself.
test("app mount switches to real S3 object storage when configured", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-mount-s3-"));
  const mount = await createV4IntakeMount({
    env: {
      ...FAKE_KEYS,
      MWB_V4_INTAKE: "1",
      MWB_V4_SCRATCH_ROOT: path.join(root, "scratch"),
      MWB_V4_S3_ENDPOINT: "https://sfo3.digitaloceanspaces.com",
      MWB_V4_S3_REGION: "sfo3",
      MWB_V4_S3_BUCKET: "custody-test",
      MWB_V4_S3_ACCESS_KEY_ID: "key",
      MWB_V4_S3_SECRET_ACCESS_KEY: "secret",
    },
    pool: { connect: async () => { throw new Error("unused"); } },
  });
  try {
    const status = fakeResponse();
    await mount.handleRequest({
      request: { method: "GET", url: "/api/v4/status", headers: {} },
      requestUrl: new URL("http://localhost/api/v4/status"),
      response: status,
    });
    const body = JSON.parse(status.state.body);
    assert.equal(body.objectStore, "s3");
    assert.equal(body.dataRegion, "sfo3");

    const stagingPut = fakeResponse();
    await mount.handleRequest({
      request: { method: "PUT", url: "/api/v4-store/document-intake-extraction/v1/staging/i/f/" + "a".repeat(16), headers: {} },
      requestUrl: new URL("http://localhost/api/v4-store/document-intake-extraction/v1/staging/i/f/" + "a".repeat(16)),
      response: stagingPut,
    });
    assert.equal(stagingPut.state.statusCode, 403);
    assert.match(stagingPut.state.body, /key_not_writable/);
  } finally {
    await mount.stop();
    await rm(root, { recursive: true, force: true });
  }
});

// The outbox bridge: one ready event becomes one resultConsumer call carrying
// plain JSON (folder name via clientRequestId, slug fallback, documents);
// other event types acknowledge without side effects.
test("extraction result deliver maps ready events onto the result consumer and ignores the rest", async () => {
  const calls = [];
  const service = {
    async getResult({ tenantId, resultId }) {
      assert.equal(tenantId, "private-beta");
      assert.equal(resultId, "result-1");
      return {
        resultId,
        intakeId: "intake-1",
        matterId: "Iyer-v-State",
        status: "ready",
        documents: [{ sourceSha256: "a".repeat(64), pages: [] }],
      };
    },
    async getIntake({ intakeId }) {
      assert.equal(intakeId, "intake-1");
      return { intakeId, clientRequestId: "Iyer v State" };
    },
  };
  const deliver = createExtractionResultDeliver({ service, resultConsumer: async (input) => calls.push(input) });
  await deliver({ type: "outbox.something_else", payload: {} });
  assert.equal(calls.length, 0, "non-ready events are acknowledged without side effects");
  await deliver({
    type: "extraction.result.ready",
    payload: { tenantId: "private-beta", intakeId: "intake-1", resultId: "result-1" },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].matterFolderName, "Iyer v State");
  assert.equal(calls[0].matterIdSlug, "Iyer-v-State");
  assert.equal(calls[0].resultId, "result-1");
  assert.equal(calls[0].resultStatus, "ready");
  assert.equal(calls[0].documents.length, 1);
});

// Empty-but-set env vars are configuration-template artifacts; clamping them
// to the minimum would silently collapse throughput and range size.
test("app mount falls back to defaults for empty numeric env vars", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-mount-env-"));
  const mount = await createV4IntakeMount({
    env: {
      ...FAKE_KEYS,
      MWB_V4_INTAKE: "1",
      MWB_V4_STORE_ROOT: path.join(root, "store"),
      MWB_V4_SCRATCH_ROOT: path.join(root, "scratch"),
      MWB_V4_LANES: "",
      MWB_V4_RANGE_PAGES: "   ",
      MWB_V4_REPAIR_LANES: "6",
    },
    pool: { connect: async () => { throw new Error("unused"); } },
  });
  try {
    assert.equal(mount.config.lanes, 24);
    assert.equal(mount.config.rangePages, 8);
    assert.equal(mount.config.repairLanes, 6, "explicit values still apply");
  } finally {
    await mount.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("app mount caps its database pool independently of worker settings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-pool-budget-"));
  const created = [];
  const fakePool = { connect: async () => { throw new Error("unused"); }, end: async () => {} };
  const mount = await createV4IntakeMount({
    env: {
      ...FAKE_KEYS,
      MWB_V4_INTAKE: "1",
      MWB_V4_DB_URL: "postgresql://runtime:secret@localhost/matter_workbench_v4",
      MWB_V4_DB_POOL_MAX: "16",
      MWB_V4_LANES: "128",
      MWB_V4_REPAIR_LANES: "32",
      MWB_V4_STORE_ROOT: path.join(root, "store"),
      MWB_V4_SCRATCH_ROOT: path.join(root, "scratch"),
    },
    poolFactory(options) { created.push(options); return fakePool; },
  });
  try {
    assert.equal(created[0].max, 16, "worker settings must not raise the connection budget");
    assert.equal(mount.config.poolMaximum, 16);
    assert.equal(mount.config.lanes, 128, "test precondition: worker setting was not clamped to the pool budget");
  } finally {
    await mount.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("app mount serves the V4 API under its prefix and plays the bucket for presigned staging PUTs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-mount-"));
  const uploadToken = "upload-token-under-test";
  const tokenDigest = createHash("sha256").update(uploadToken).digest("hex");
  const digest = tokenDigest.slice(0, 16);
  const stagingKey = `document-intake-extraction/v1/staging/intake-1/file-1/${digest}`;
  const staged = Buffer.from("%PDF-1.4 staged bytes");
  const mount = await createV4IntakeMount({
    env: {
      ...FAKE_KEYS,
      MWB_V4_INTAKE: "1",
      MWB_V4_STORE_ROOT: path.join(root, "store"),
      MWB_V4_SCRATCH_ROOT: path.join(root, "scratch"),
      MWB_V4_TENANT_ID: "tenant-test",
    },
    pool: authorizationPool({
      tenantId: "tenant-test",
      tokenDigest,
      intakeId: "intake-1",
      fileId: "file-1",
      expectedBytes: staged.length,
      stagedKey: stagingKey,
    }),
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

    // The mount-owned status route is how the UI discovers V4: it advertises
    // the upload token header and limits, and reports started=false until the
    // worker fleet is actually running.
    const status = fakeResponse();
    const statusHandled = await mount.handleRequest({
      request: { method: "GET", url: "/api/v4/status", headers: {} },
      requestUrl: new URL("http://localhost/api/v4/status"),
      response: status,
    });
    assert.equal(statusHandled, true);
    assert.equal(status.state.statusCode, 200);
    const statusBody = JSON.parse(status.state.body);
    assert.equal(statusBody.enabled, true);
    assert.equal(statusBody.started, false, "start() has not run in this test");
    assert.equal(statusBody.uploadTokenHeader, "x-mwb-upload-token");
    assert.equal(statusBody.storePrefix, "/api/v4-store");
    assert.ok(statusBody.limits.maximumFileBytes > 0);

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

    // The store endpoint accepts an emulated presigned PUT only from a caller
    // holding the upload token that minted the key AND matching an outstanding
    // authorization, then persists the staged bytes with a version marker.
    const stagingPut = (headers, key = stagingKey) => ({
      request: {
        method: "PUT",
        url: `/api/v4-store/${key}`,
        headers,
        async *[Symbol.asyncIterator]() { yield staged; },
      },
      requestUrl: new URL(`http://localhost/api/v4-store/${key}`),
      response: fakeResponse(),
    });

    const authorized = stagingPut({ "x-mwb-upload-token": uploadToken });
    assert.equal(await mount.handleRequest(authorized), true);
    assert.equal(authorized.response.state.statusCode, 200);
    const written = await readFile(path.join(root, "store", "mwb-v4-app", stagingKey));
    assert.deepEqual(written, staged);

    // A missing or mismatched token, and any key outside the staging
    // namespace, must be refused — the content-addressed blob namespace in
    // particular is what custody promotion trusts.
    const noToken = stagingPut({});
    assert.equal(await mount.handleRequest(noToken), true);
    assert.equal(noToken.response.state.statusCode, 403);
    const wrongToken = stagingPut({ "x-mwb-upload-token": "not-the-token" });
    assert.equal(await mount.handleRequest(wrongToken), true);
    assert.equal(wrongToken.response.state.statusCode, 403);
    assert.match(wrongToken.response.state.body, /upload_token_invalid/);
    const blobKey = "document-intake-extraction/v1/blobs/sha256/ab/" + "a".repeat(64);
    const blobWrite = stagingPut({ "x-mwb-upload-token": uploadToken }, blobKey);
    assert.equal(await mount.handleRequest(blobWrite), true);
    assert.equal(blobWrite.response.state.statusCode, 403);
    assert.match(blobWrite.response.state.body, /key_not_writable/);
    await assert.rejects(() => readFile(path.join(root, "store", "mwb-v4-app", blobKey)));

    // A self-consistent key+token with NO outstanding authorization is refused:
    // the digest is not enough, the endpoint consults the authorization store.
    const forgedToken = "self-minted-token";
    const forgedKey = `document-intake-extraction/v1/staging/intake-x/file-x/${createHash("sha256").update(forgedToken).digest("hex").slice(0, 16)}`;
    const forged = stagingPut({ "x-mwb-upload-token": forgedToken }, forgedKey);
    assert.equal(await mount.handleRequest(forged), true);
    assert.equal(forged.response.state.statusCode, 403);
    assert.match(forged.response.state.body, /upload_not_authorized/);
    await assert.rejects(() => readFile(path.join(root, "store", "mwb-v4-app", forgedKey)));

    // Oversized uploads are rejected while streaming instead of buffered.
    const capped = await createV4IntakeMount({
      env: {
        ...FAKE_KEYS,
        MWB_V4_INTAKE: "1",
        MWB_V4_STORE_ROOT: path.join(root, "store-capped"),
        MWB_V4_SCRATCH_ROOT: path.join(root, "scratch"),
        MWB_V4_MAX_UPLOAD_BYTES: "4",
      },
      pool: authorizationPool({
        tenantId: "private-beta",
        tokenDigest,
        intakeId: "intake-1",
        fileId: "file-1",
        expectedBytes: 1_000_000,
        stagedKey: stagingKey,
      }),
    });
    try {
      const oversize = stagingPut({ "x-mwb-upload-token": uploadToken });
      assert.equal(await capped.handleRequest(oversize), true);
      assert.equal(oversize.response.state.statusCode, 413);
      assert.match(oversize.response.state.body, /too_large/);
    } finally {
      await capped.stop();
    }
  } finally {
    await mount.stop();
    await rm(root, { recursive: true, force: true });
  }
});

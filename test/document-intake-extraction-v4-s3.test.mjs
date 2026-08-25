import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  MemoryUploadAuthorizationStore,
  S3CompatibleObjectStore,
} from "../services/document-intake-extraction/adapters/s3-compatible-object-store.mjs";

// V4-OBJECT-001
test("V4-OBJECT-001 authorizes direct regional uploads, streams server hashing, promotes immutable blobs, and suppresses duplicate storage", async () => {
  const clock = () => new Date("2026-08-24T12:00:00.000Z");
  const objects = new Map();
  const calls = [];
  let tokenSequence = 0;
  const client = fakeS3Client(objects, calls);
  const presigner = {
    async presignPut(input) {
      calls.push({ method: "presignPut", ...input });
      return { url: `https://objects.example.invalid/${encodeURIComponent(input.key)}`, requiredHeaders: { "x-signed-upload": "1" } };
    },
  };
  const store = new S3CompatibleObjectStore({
    bucket: "private-legal-documents",
    keyPrefix: "v4",
    region: "ap-southeast-2",
    client,
    presigner,
    authorizationStore: new MemoryUploadAuthorizationStore(),
    clock,
    tokenFactory: () => `token-${String(++tokenSequence).padStart(58, "x")}`,
  });
  assert.deepEqual(await store.checkHealth(), { available: true, dataRegion: "ap-southeast-2" });
  const payload = Buffer.from("immutable legal PDF bytes");
  const first = await store.createUploadAuthorization({
    tenantId: "tenant-1",
    intakeId: "intake-1",
    fileId: "file-1",
    expectedBytes: payload.length,
    expiresAt: new Date("2026-08-24T12:15:00.000Z"),
  });
  assert.equal(first.dataRegion, "ap-southeast-2");
  assert.equal(first.requiredHeaders["x-amz-server-side-encryption"], "AES256");
  assert.equal(first.requiredHeaders["x-signed-upload"], "1");
  assert.doesNotMatch(first.stagedObjectKey, new RegExp(first.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "raw tokens must not enter object keys");
  objects.set(first.stagedObjectKey, { body: payload, metadata: {}, versionId: "staged-v1" });
  const committed = await store.commitAuthorizedUpload({ token: first.token, tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-1" });
  const digest = sha256(payload);
  assert.equal(committed.sha256, digest);
  assert.equal(committed.objectReused, false);
  assert.equal(committed.dataRegion, "ap-southeast-2");
  assert.equal(objects.has(first.stagedObjectKey), false);
  assert.equal(objects.get(committed.blobReference.objectKey).metadata.sha256, digest);
  assert.ok(calls.some((call) => call.method === "getObject" && call.key === first.stagedObjectKey && call.versionId === "staged-v1"));
  assert.ok(calls.some((call) => call.method === "copyObject" && call.sourceVersionId === "staged-v1" && call.destinationIfNoneMatch === "*"));
  assert.equal((await store.readBlob(committed.blobReference)).toString(), payload.toString());

  const second = await store.createUploadAuthorization({
    tenantId: "tenant-1",
    intakeId: "intake-1",
    fileId: "file-2",
    expectedBytes: payload.length,
    expiresAt: new Date("2026-08-24T12:15:00.000Z"),
  });
  objects.set(second.stagedObjectKey, { body: payload, metadata: {}, versionId: "staged-v2" });
  const duplicate = await store.commitAuthorizedUpload({ token: second.token, tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-2" });
  assert.equal(duplicate.sha256, digest);
  assert.equal(duplicate.objectReused, true);
  assert.equal(calls.filter((call) => call.method === "copyObject").length, 1, "the duplicate must not be copied again");
  const replay = await store.commitAuthorizedUpload({ token: second.token, tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-2" });
  assert.equal(replay.idempotent, true);
});

test("custody checkpoint remains durable when staging cleanup fails after immutable promotion", async () => {
  const objects = new Map();
  const calls = [];
  const client = fakeS3Client(objects, calls);
  client.deleteObject = async ({ key }) => {
    calls.push({ method: "deleteObject", key });
    throw new Error("transient staging lifecycle failure");
  };
  const store = new S3CompatibleObjectStore({
    bucket: "private",
    keyPrefix: "v4",
    region: "ap-southeast-2",
    client,
    presigner: { presignPut: async ({ key }) => ({ url: `https://upload.invalid/${key}`, requiredHeaders: {} }) },
    authorizationStore: new MemoryUploadAuthorizationStore(),
    clock: () => new Date("2026-08-24T12:00:00.000Z"),
    tokenFactory: () => "token-with-at-least-thirty-two-characters-123456",
  });
  const payload = Buffer.from("durably promoted PDF");
  const authorization = await store.createUploadAuthorization({
    tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-1", expectedBytes: payload.length,
    expiresAt: new Date("2026-08-24T12:05:00.000Z"),
  });
  objects.set(authorization.stagedObjectKey, { body: payload, metadata: {}, versionId: "staged-cleanup-v1" });
  const committed = await store.commitAuthorizedUpload({
    token: authorization.token, tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-1",
  });
  assert.equal(committed.sha256, sha256(payload));
  assert.equal(objects.has(authorization.stagedObjectKey), true, "failed cleanup may leave a lifecycle-managed staged object");
  const replay = await store.commitAuthorizedUpload({
    token: authorization.token, tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-1",
  });
  assert.equal(replay.idempotent, true);
});

test("S3 custody fails closed on wrong scope, size drift, corrupt existing blob metadata, and unbounded in-memory reads", async () => {
  const objects = new Map();
  let tokenSequence = 0;
  const store = new S3CompatibleObjectStore({
    bucket: "private",
    keyPrefix: "v4",
    region: "eu-central-1",
    client: fakeS3Client(objects, []),
    presigner: { presignPut: async ({ key }) => ({ url: `https://upload.invalid/${key}`, requiredHeaders: {} }) },
    authorizationStore: new MemoryUploadAuthorizationStore(),
    clock: () => new Date("2026-08-24T12:00:00.000Z"),
    tokenFactory: () => `secret-${String(++tokenSequence).padStart(58, "x")}`,
    maximumBufferedBlobBytes: 4,
  });
  const payload = Buffer.from("five!");
  const authorization = await store.createUploadAuthorization({
    tenantId: "tenant-1",
    intakeId: "intake-1",
    fileId: "file-1",
    expectedBytes: payload.length,
    expiresAt: new Date("2026-08-24T12:05:00.000Z"),
  });
  objects.set(authorization.stagedObjectKey, { body: payload.subarray(0, 4), metadata: {}, versionId: "staged-size-v1" });
  await assert.rejects(() => store.commitAuthorizedUpload({
    token: authorization.token, tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-1",
  }), { code: "object.size_mismatch" });
  await assert.rejects(() => store.commitAuthorizedUpload({
    token: authorization.token, tenantId: "tenant-1", intakeId: "other-intake", fileId: "file-1",
  }), { code: "object.authorization_scope_mismatch" });

  objects.set(authorization.stagedObjectKey, { body: payload, metadata: {}, versionId: "staged-size-v2" });
  const digest = sha256(payload);
  const blobKey = `v4/blobs/sha256/${digest.slice(0, 2)}/${digest}`;
  objects.set(blobKey, { body: payload, metadata: { sha256: "f".repeat(64) } });
  await assert.rejects(() => store.commitAuthorizedUpload({
    token: authorization.token, tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-1",
  }), { code: "object.blob_integrity_failure" });
  objects.delete(blobKey);
  const committed = await store.commitAuthorizedUpload({ token: authorization.token, tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-1" });
  await assert.rejects(() => store.readBlob(committed.blobReference), { code: "object.buffer_limit_exceeded" });
  const opened = await store.openBlobStream(committed.blobReference);
  assert.equal(opened.contentLength, payload.length);

  const unversioned = await store.createUploadAuthorization({
    tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-2", expectedBytes: payload.length,
    expiresAt: new Date("2026-08-24T12:05:00.000Z"),
  });
  objects.set(unversioned.stagedObjectKey, { body: payload, metadata: {} });
  await assert.rejects(() => store.commitAuthorizedUpload({
    token: unversioned.token, tenantId: "tenant-1", intakeId: "intake-1", fileId: "file-2",
  }), { code: "object.staging_version_missing" });
});

function fakeS3Client(objects, calls) {
  return {
    async headBucket(input) { calls.push({ method: "headBucket", ...input }); return {}; },
    async headObject({ key }) {
      calls.push({ method: "headObject", key });
      const object = objects.get(key);
      if (!object) {
        const error = new Error("not found");
        error.code = "NoSuchKey";
        error.statusCode = 404;
        throw error;
      }
      return { contentLength: object.body.length, metadata: { ...object.metadata }, versionId: object.versionId || "" };
    },
    async getObject({ key, versionId }) {
      calls.push({ method: "getObject", key, versionId });
      const object = objects.get(key);
      if (!object) throw Object.assign(new Error("not found"), { code: "NoSuchKey", statusCode: 404 });
      if (versionId && object.versionId !== versionId) throw Object.assign(new Error("version not found"), { code: "NoSuchVersion", statusCode: 404 });
      return { body: chunked(object.body) };
    },
    async copyObject(input) {
      calls.push({ method: "copyObject", ...input });
      const source = objects.get(input.sourceKey);
      if (!source) throw Object.assign(new Error("not found"), { code: "NoSuchKey", statusCode: 404 });
      if (input.sourceVersionId && source.versionId !== input.sourceVersionId) throw Object.assign(new Error("version not found"), { code: "NoSuchVersion", statusCode: 404 });
      objects.set(input.destinationKey, { body: Buffer.from(source.body), metadata: { ...input.metadata }, versionId: "committed-v1" });
    },
    async deleteObject({ key }) {
      calls.push({ method: "deleteObject", key });
      objects.delete(key);
    },
  };
}

async function* chunked(bytes) {
  const midpoint = Math.max(1, Math.floor(bytes.length / 2));
  yield bytes.subarray(0, midpoint);
  yield bytes.subarray(midpoint);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

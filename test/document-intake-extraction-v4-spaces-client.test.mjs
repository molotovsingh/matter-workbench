import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_PAYLOAD_SHA256, presignUrl, signRequestHeaders } from "../services/document-intake-extraction/adapters/sigv4.mjs";
import { createSpacesS3Client } from "../services/document-intake-extraction/adapters/spaces-s3-client.mjs";

// The official AWS SigV4 documentation examples ("Authenticating Requests"),
// which pin the whole canonicalization + signing chain to Amazon's own
// published arithmetic.
const DOC_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const DOC_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const DOC_DATE = new Date("2013-05-24T00:00:00.000Z");

test("SigV4 header signing reproduces the AWS documentation example signature", () => {
  const headers = signRequestHeaders({
    method: "GET",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    headers: { range: "bytes=0-9" },
    payloadSha256: EMPTY_PAYLOAD_SHA256,
    accessKeyId: DOC_ACCESS_KEY,
    secretAccessKey: DOC_SECRET_KEY,
    region: "us-east-1",
    now: DOC_DATE,
  });
  assert.equal(headers["x-amz-date"], "20130524T000000Z");
  assert.equal(
    headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, "
    + "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, "
    + "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

test("SigV4 presigning reproduces the AWS documentation example signature", () => {
  const url = presignUrl({
    method: "GET",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    expiresSeconds: 86_400,
    accessKeyId: DOC_ACCESS_KEY,
    secretAccessKey: DOC_SECRET_KEY,
    region: "us-east-1",
    now: DOC_DATE,
  });
  const query = new URL(url).searchParams;
  assert.equal(query.get("X-Amz-Credential"), "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request");
  assert.equal(query.get("X-Amz-SignedHeaders"), "host");
  assert.equal(query.get("X-Amz-Signature"), "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
});

function fakeFetch(plan) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const step = plan.shift();
    if (!step) throw new Error("unexpected request");
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      headers: new Map(Object.entries(step.headers || {})),
      body: step.body ?? null,
      text: async () => step.text ?? "",
    };
  };
  return { impl, calls };
}

test("spaces client maps S3 semantics onto the custody store contract", async () => {
  const { impl, calls } = fakeFetch([
    { status: 200, headers: { "content-length": "42", "x-amz-version-id": "v-1", "x-amz-meta-sha256": "ab".repeat(32) } },
    { status: 404 },
    { status: 200, text: "<CopyObjectResult><ETag>x</ETag></CopyObjectResult>" },
    { status: 200, text: "<Error><Code>InternalError</Code><Message>copy blew up late</Message></Error>" },
  ]);
  const spaces = createSpacesS3Client({
    endpoint: "https://sfo3.digitaloceanspaces.com",
    region: "sfo3",
    accessKeyId: "key",
    secretAccessKey: "secret",
    fetchImpl: impl,
    clock: () => DOC_DATE,
  });

  const head = await spaces.client.headObject({ bucket: "bkt", key: "a b/c.pdf", versionId: "v-1" });
  assert.deepEqual(head, { contentLength: 42, versionId: "v-1", metadata: { sha256: "ab".repeat(32) } });
  assert.match(calls[0].url, /^https:\/\/bkt\.sfo3\.digitaloceanspaces\.com\/a%20b\/c\.pdf\?versionId=v-1$/);
  assert.ok(calls[0].init.headers.authorization.startsWith("AWS4-HMAC-SHA256 Credential=key/20130524/sfo3/s3/aws4_request"));

  await assert.rejects(() => spaces.client.headObject({ bucket: "bkt", key: "missing" }), (error) => error.code === "NoSuchKey" && error.statusCode === 404);

  await spaces.client.copyObject({
    sourceBucket: "bkt", sourceKey: "staging/x", sourceVersionId: "sv-9",
    destinationBucket: "bkt", destinationKey: "blobs/sha256/ab/abc",
    metadata: { sha256: "abc" }, metadataDirective: "REPLACE",
  });
  assert.equal(calls[2].init.headers["x-amz-copy-source"], "/bkt/staging/x?versionId=sv-9");
  assert.equal(calls[2].init.headers["x-amz-metadata-directive"], "REPLACE");
  assert.equal(calls[2].init.headers["x-amz-meta-sha256"], "abc");

  // The 200-with-embedded-error CopyObject trap must surface as a failure.
  await assert.rejects(
    () => spaces.client.copyObject({ sourceBucket: "bkt", sourceKey: "s", destinationBucket: "bkt", destinationKey: "d" }),
    (error) => error.code === "InternalError" && /blew up late/.test(error.message),
  );
});

test("spaces presigner binds the byte size and required headers into the URL", async () => {
  const spaces = createSpacesS3Client({
    endpoint: "https://sfo3.digitaloceanspaces.com",
    region: "sfo3",
    accessKeyId: "key",
    secretAccessKey: "secret",
    clock: () => DOC_DATE,
  });
  const signed = await spaces.presigner.presignPut({
    bucket: "bkt",
    key: "document-intake-extraction/v1/staging/i-1/f-1/abcd",
    expiresAt: new Date(DOC_DATE.getTime() + 15 * 60 * 1000),
    expectedBytes: 1234,
    requiredHeaders: { "content-type": "application/pdf" },
  });
  const url = new URL(signed.url);
  assert.equal(url.host, "bkt.sfo3.digitaloceanspaces.com");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;content-type;host");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
});

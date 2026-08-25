import { createHash, randomBytes } from "node:crypto";

import { CONTRACT_VERSIONS, assertSha256 } from "../../../packages/extraction-contracts/index.mjs";

const AUTHORIZATION_SCHEMA = "document-intake-extraction.s3-upload-authorization-record/v1";

export class S3CompatibleObjectStore {
  constructor({
    bucket,
    keyPrefix = "document-intake-extraction/v1",
    region,
    presigner,
    client,
    authorizationStore,
    clock = () => new Date(),
    tokenFactory = () => randomBytes(32).toString("base64url"),
    serverSideEncryption = "AES256",
    requireVersionedStaging = true,
    maximumBufferedBlobBytes = 64 * 1024 * 1024,
  } = {}) {
    if (!bucket) throw new Error("S3-compatible object store requires a bucket");
    if (!region) throw new Error("S3-compatible object store requires an explicit data region");
    if (!presigner?.presignPut) throw new Error("S3-compatible object store requires a PUT presigner");
    for (const method of ["headObject", "getObject", "copyObject", "deleteObject"]) {
      if (typeof client?.[method] !== "function") throw new Error(`S3-compatible client requires ${method}`);
    }
    if (!authorizationStore?.create || !authorizationStore?.readByTokenDigest || !authorizationStore?.updateByTokenDigest) {
      throw new Error("S3-compatible object store requires a durable authorization store");
    }
    this.bucket = String(bucket);
    this.keyPrefix = normalizePrefix(keyPrefix);
    this.region = String(region);
    this.presigner = presigner;
    this.client = client;
    this.authorizationStore = authorizationStore;
    this.clock = clock;
    this.tokenFactory = tokenFactory;
    this.serverSideEncryption = String(serverSideEncryption || "AES256");
    this.requireVersionedStaging = requireVersionedStaging !== false;
    this.maximumBufferedBlobBytes = positiveInteger(maximumBufferedBlobBytes, "maximumBufferedBlobBytes");
  }

  async initialize() {}

  async checkHealth() {
    if (typeof this.client.headBucket !== "function") {
      throw objectError("object-store health check is not configured", "object.health_check_unavailable");
    }
    await this.client.headBucket({ bucket: this.bucket, region: this.region });
    return { available: true, dataRegion: this.region };
  }

  async createUploadAuthorization({ tenantId, intakeId, fileId, expectedBytes, expiresAt, mimeType = "application/pdf" } = {}) {
    const normalizedTenantId = safeId(tenantId, "tenantId");
    const normalizedIntakeId = safeId(intakeId, "intakeId");
    const normalizedFileId = safeId(fileId, "fileId");
    const bytes = positiveInteger(expectedBytes, "expectedBytes");
    const expiration = new Date(expiresAt);
    if (!Number.isFinite(expiration.getTime()) || expiration <= this.clock()) throw objectError("upload authorization expiration must be in the future", "object.authorization_expiration_invalid");
    const token = String(this.tokenFactory() || "");
    if (token.length < 32) throw objectError("upload token factory returned insufficient entropy", "object.authorization_token_weak");
    const tokenDigest = sha256Text(token);
    const stagedObjectKey = this.key(`staging/${normalizedIntakeId}/${normalizedFileId}/${tokenDigest.slice(0, 16)}`);
    const requiredHeaders = {
      "content-type": String(mimeType || "application/pdf").slice(0, 200),
      "x-amz-server-side-encryption": this.serverSideEncryption,
    };
    const signed = await this.presigner.presignPut({
      bucket: this.bucket,
      key: stagedObjectKey,
      expiresAt: expiration,
      expectedBytes: bytes,
      requiredHeaders,
    });
    if (!signed?.url) throw objectError("object-store presigner did not return a URL", "object.presign_failed");
    const now = this.clock().toISOString();
    await this.authorizationStore.create({
      schemaVersion: AUTHORIZATION_SCHEMA,
      tokenDigest,
      tenantId: normalizedTenantId,
      intakeId: normalizedIntakeId,
      fileId: normalizedFileId,
      expectedBytes: bytes,
      stagedObjectKey,
      dataRegion: this.region,
      status: "authorized",
      expiresAt: expiration.toISOString(),
      createdAt: now,
      updatedAt: now,
    });
    return {
      schemaVersion: CONTRACT_VERSIONS.uploadAuthorization,
      token,
      method: "PUT",
      url: signed.url,
      expiresAt: expiration.toISOString(),
      requiredHeaders: { ...requiredHeaders, ...(signed.requiredHeaders || {}) },
      stagedObjectKey,
      dataRegion: this.region,
    };
  }

  async commitAuthorizedUpload({ token, tenantId, intakeId, fileId } = {}) {
    const normalizedTenantId = safeId(tenantId, "tenantId");
    const tokenDigest = sha256Text(requiredToken(token));
    const record = await this.authorizationStore.readByTokenDigest(tokenDigest, { tenantId: normalizedTenantId });
    if (!record) throw objectError("upload authorization not found", "object.authorization_not_found");
    if (record.schemaVersion !== AUTHORIZATION_SCHEMA) throw objectError("unsupported upload authorization record", "object.authorization_invalid");
    if (record.tenantId !== normalizedTenantId || record.intakeId !== intakeId || record.fileId !== fileId) {
      throw objectError("upload authorization does not belong to this intake file", "object.authorization_scope_mismatch");
    }
    if (record.status === "committed") return receipt(record, true);
    if (!["authorized", "uploaded"].includes(record.status)) throw objectError("upload authorization cannot be committed", "object.authorization_state_invalid");
    if (this.clock() > new Date(record.expiresAt)) throw objectError("upload authorization expired", "object.authorization_expired");

    const head = await this.headRequired(record.stagedObjectKey, "object.upload_incomplete");
    const headBytes = normalizeContentLength(head.contentLength);
    const sourceVersionId = String(head.versionId || "").trim();
    if (this.requireVersionedStaging && !sourceVersionId) {
      throw objectError("versioned staging custody is required", "object.staging_version_missing");
    }
    if (headBytes !== record.expectedBytes) {
      throw objectError(`uploaded ${headBytes} bytes; expected ${record.expectedBytes}`, "object.size_mismatch");
    }
    const streamed = await this.streamAndHash(record.stagedObjectKey, record.expectedBytes, sourceVersionId);
    const blobObjectKey = this.key(`blobs/sha256/${streamed.sha256.slice(0, 2)}/${streamed.sha256}`);
    const existing = await this.headOptional(blobObjectKey);
    let objectReused = false;
    if (existing) {
      await verifyCommittedBlob(existing, { expectedBytes: streamed.bytes, expectedSha256: streamed.sha256 });
      objectReused = true;
    } else {
      await this.client.copyObject({
        sourceBucket: this.bucket,
        sourceKey: record.stagedObjectKey,
        sourceVersionId,
        destinationBucket: this.bucket,
        destinationKey: blobObjectKey,
        metadata: {
          sha256: streamed.sha256,
          custody: "verified",
          source_bytes: String(streamed.bytes),
        },
        metadataDirective: "REPLACE",
        serverSideEncryption: this.serverSideEncryption,
        destinationIfNoneMatch: "*",
      });
      const committed = await this.headRequired(blobObjectKey, "object.blob_promotion_failed");
      await verifyCommittedBlob(committed, { expectedBytes: streamed.bytes, expectedSha256: streamed.sha256 });
    }
    const committedAt = this.clock().toISOString();
    const committed = await this.authorizationStore.updateByTokenDigest(tokenDigest, {
      tenantId: normalizedTenantId,
      expectedStatuses: ["authorized", "uploaded"],
      patch: {
        status: "committed",
        sha256: streamed.sha256,
        bytes: streamed.bytes,
        blobObjectKey,
        objectReused,
        sourceVersionId,
        committedAt,
        updatedAt: committedAt,
      },
    });
    if (!committed) {
      const concurrent = await this.authorizationStore.readByTokenDigest(tokenDigest, { tenantId: normalizedTenantId });
      if (concurrent?.status === "committed") {
        await this.deleteStagingBestEffort(record.stagedObjectKey);
        return receipt(concurrent, true);
      }
      throw objectError("upload authorization changed during custody commit", "object.authorization_conflict");
    }
    await this.deleteStagingBestEffort(record.stagedObjectKey);
    return receipt(committed, false);
  }

  async readBlob(blobReference = {}) {
    const opened = await this.openBlobStream(blobReference);
    if (opened.contentLength > this.maximumBufferedBlobBytes) {
      throw objectError(
        `blob exceeds the ${this.maximumBufferedBlobBytes}-byte in-memory read limit; use openBlobStream with bounded worker scratch`,
        "object.buffer_limit_exceeded",
      );
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of asAsyncIterable(opened.body)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > this.maximumBufferedBlobBytes) throw objectError("blob exceeded its bounded read limit", "object.buffer_limit_exceeded");
      chunks.push(buffer);
    }
    if (bytes !== opened.contentLength) throw objectError("blob changed while being read", "object.size_mismatch");
    return Buffer.concat(chunks, bytes);
  }

  async openBlobStream(blobReference = {}) {
    const sha256 = assertSha256(blobReference.sha256, "blobReference.sha256");
    const expectedKey = this.key(`blobs/sha256/${sha256.slice(0, 2)}/${sha256}`);
    if (blobReference.objectKey && blobReference.objectKey !== expectedKey) {
      throw objectError("blob reference key does not match digest", "object.blob_reference_invalid");
    }
    const head = await this.headRequired(expectedKey, "object.blob_not_found");
    await verifyCommittedBlob(head, { expectedBytes: normalizeContentLength(head.contentLength), expectedSha256: sha256 });
    const response = await this.client.getObject({ bucket: this.bucket, key: expectedKey });
    return { body: response.body, contentLength: normalizeContentLength(head.contentLength), sha256, objectKey: expectedKey };
  }

  async streamAndHash(key, expectedBytes, versionId = "") {
    const response = await this.client.getObject({ bucket: this.bucket, key, versionId: versionId || undefined });
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of asAsyncIterable(response?.body)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > expectedBytes) throw objectError("uploaded object grew during custody verification", "object.size_mismatch");
      hash.update(buffer);
    }
    if (bytes !== expectedBytes) throw objectError(`verified ${bytes} bytes; expected ${expectedBytes}`, "object.size_mismatch");
    return { bytes, sha256: hash.digest("hex") };
  }

  async deleteStagingBestEffort(key) {
    try {
      await this.client.deleteObject({ bucket: this.bucket, key });
      return true;
    } catch {
      return false;
    }
  }

  async headOptional(key) {
    try {
      return await this.client.headObject({ bucket: this.bucket, key });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async headRequired(key, missingCode) {
    const head = await this.headOptional(key);
    if (!head) throw objectError("object not found", missingCode);
    return head;
  }

  key(suffix) {
    return `${this.keyPrefix}/${String(suffix).replace(/^\/+/, "")}`;
  }
}

export class MemoryUploadAuthorizationStore {
  constructor() {
    this.records = new Map();
  }

  async create(record) {
    if (this.records.has(record.tokenDigest)) throw objectError("upload authorization already exists", "object.authorization_conflict");
    this.records.set(record.tokenDigest, structuredClone(record));
    return structuredClone(record);
  }

  async readByTokenDigest(tokenDigest) {
    const record = this.records.get(tokenDigest);
    return record ? structuredClone(record) : null;
  }

  async updateByTokenDigest(tokenDigest, { expectedStatuses = [], patch = {} } = {}) {
    const record = this.records.get(tokenDigest);
    if (!record || (expectedStatuses.length && !expectedStatuses.includes(record.status))) return null;
    const updated = { ...record, ...structuredClone(patch) };
    this.records.set(tokenDigest, updated);
    return structuredClone(updated);
  }
}

async function verifyCommittedBlob(head, { expectedBytes, expectedSha256 }) {
  if (normalizeContentLength(head.contentLength) !== expectedBytes) throw objectError("content-addressed blob size mismatch", "object.blob_integrity_failure");
  const metadataSha = String(head.metadata?.sha256 || "").toLowerCase();
  if (metadataSha !== expectedSha256) throw objectError("content-addressed blob digest metadata mismatch", "object.blob_integrity_failure");
}

async function* asAsyncIterable(body) {
  if (!body) throw objectError("object store returned no response body", "object.body_missing");
  if (typeof body[Symbol.asyncIterator] === "function") {
    yield* body;
    return;
  }
  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock?.();
    }
  } else if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    yield body;
  } else {
    throw objectError("object-store response body is not streamable", "object.body_invalid");
  }
}

function receipt(record, idempotent) {
  return {
    schemaVersion: CONTRACT_VERSIONS.custodyReceipt,
    intakeId: record.intakeId,
    fileId: record.fileId,
    sha256: record.sha256,
    bytes: record.bytes,
    blobReference: { sha256: record.sha256, objectKey: record.blobObjectKey },
    objectReused: Boolean(record.objectReused),
    idempotent: Boolean(idempotent),
    committedAt: record.committedAt,
    dataRegion: record.dataRegion || "",
  };
}

function normalizeContentLength(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw objectError("object store returned an invalid content length", "object.head_invalid");
  return number;
}

function normalizePrefix(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").includes("..")) throw objectError("invalid object-store key prefix", "object.prefix_invalid");
  return normalized;
}

function safeId(value, field) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(normalized)) throw objectError(`${field} is invalid`, "object.identifier_invalid");
  return normalized;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw objectError(`${field} must be a positive integer`, "object.integer_invalid");
  return number;
}

function requiredToken(value) {
  const token = String(value || "");
  if (token.length < 32 || token.length > 512 || /[\u0000-\u001f\u007f]/.test(token)) throw objectError("upload token is invalid", "object.authorization_invalid");
  return token;
}

function sha256Text(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function isNotFound(error) {
  return error?.statusCode === 404 || error?.$metadata?.httpStatusCode === 404 || ["NoSuchKey", "NotFound", "ENOENT"].includes(error?.code || error?.name);
}

function objectError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

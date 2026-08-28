import { constants as fsConstants, createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CONTRACT_VERSIONS, assertSha256 } from "../../../packages/extraction-contracts/index.mjs";

const AUTHORIZATION_SCHEMA = "document-intake-extraction.filesystem-upload-authorization/v1";

export class FilesystemObjectStore {
  constructor({ root, clock = () => new Date(), idFactory = () => randomUUID() } = {}) {
    if (!root) throw new Error("filesystem object-store root is required");
    this.root = path.resolve(root);
    this.clock = clock;
    this.idFactory = idFactory;
    this.authorizationRoot = path.join(this.root, "authorizations");
    this.stagingRoot = path.join(this.root, "staging");
    this.blobRoot = path.join(this.root, "blobs", "sha256");
  }

  async initialize() {
    await Promise.all([
      mkdir(this.authorizationRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.stagingRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.blobRoot, { recursive: true, mode: 0o700 }),
    ]);
  }

  async createUploadAuthorization({ intakeId, fileId, expectedBytes, expiresAt } = {}) {
    await this.initialize();
    const token = safeId(this.idFactory(), "upload token");
    const stagedObjectKey = `staging/${safeId(intakeId, "intakeId")}/${safeId(fileId, "fileId")}`;
    const stagedPath = this.resolveObjectKey(stagedObjectKey);
    const metadata = {
      schemaVersion: AUTHORIZATION_SCHEMA,
      token,
      intakeId: safeId(intakeId, "intakeId"),
      fileId: safeId(fileId, "fileId"),
      expectedBytes: positiveInteger(expectedBytes, "expectedBytes"),
      expiresAt: new Date(expiresAt).toISOString(),
      stagedObjectKey,
      status: "authorized",
      createdAt: this.clock().toISOString(),
    };
    await atomicWriteJson(this.authorizationPath(token), metadata);
    return {
      schemaVersion: CONTRACT_VERSIONS.uploadAuthorization,
      token,
      method: "PUT",
      url: pathToFileURL(stagedPath).href,
      expiresAt: metadata.expiresAt,
      requiredHeaders: { "content-length": String(metadata.expectedBytes) },
      stagedObjectKey,
    };
  }

  // Reference-only direct-upload client. Production uses an object-store presigned PUT instead.
  async putAuthorizedUpload({ token, bytes } = {}) {
    const metadata = await this.readAuthorization(token);
    if (metadata.status === "committed") throw objectError("upload authorization is already committed", "object.authorization_committed");
    if (this.clock().getTime() > new Date(metadata.expiresAt).getTime()) {
      throw objectError("upload authorization expired", "object.authorization_expired");
    }
    const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (payload.length !== metadata.expectedBytes) {
      throw objectError(`uploaded ${payload.length} bytes; expected ${metadata.expectedBytes}`, "object.size_mismatch");
    }
    const stagedPath = this.resolveObjectKey(metadata.stagedObjectKey);
    await mkdir(path.dirname(stagedPath), { recursive: true, mode: 0o700 });
    try {
      const handle = await open(stagedPath, "wx", 0o600);
      try {
        await handle.writeFile(payload);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readFile(stagedPath);
      if (!existing.equals(payload)) throw objectError("staged upload already contains different bytes", "object.staged_conflict");
    }
    metadata.status = "uploaded";
    metadata.uploadedAt = this.clock().toISOString();
    await atomicWriteJson(this.authorizationPath(metadata.token), metadata);
    return { token: metadata.token, bytes: payload.length, stagedObjectKey: metadata.stagedObjectKey };
  }

  async commitAuthorizedUpload({ token, intakeId, fileId } = {}) {
    const metadata = await this.readAuthorization(token);
    if (metadata.intakeId !== intakeId || metadata.fileId !== fileId) {
      throw objectError("upload authorization does not belong to this intake file", "object.authorization_scope_mismatch");
    }
    if (metadata.status === "committed") {
      return this.committedReceipt(metadata, true);
    }
    if (metadata.status !== "uploaded") throw objectError("authorized upload has not completed", "object.upload_incomplete");
    const stagedPath = this.resolveObjectKey(metadata.stagedObjectKey);
    const details = await stat(stagedPath);
    if (details.size !== metadata.expectedBytes) throw objectError("staged object size changed before commit", "object.size_mismatch");
    const sha256 = await sha256File(stagedPath);
    const blobObjectKey = blobKey(sha256);
    const blobPath = this.resolveObjectKey(blobObjectKey);
    await mkdir(path.dirname(blobPath), { recursive: true, mode: 0o700 });
    let reused = false;
    try {
      await copyFile(stagedPath, blobPath, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await stat(blobPath);
      if (existing.size !== details.size || await sha256File(blobPath) !== sha256) {
        throw objectError("content-addressed blob collision or corruption", "object.blob_integrity_failure");
      }
      reused = true;
    }
    await rm(stagedPath, { force: true });
    metadata.status = "committed";
    metadata.committedAt = this.clock().toISOString();
    metadata.sha256 = sha256;
    metadata.blobObjectKey = blobObjectKey;
    metadata.bytes = details.size;
    metadata.reused = reused;
    await atomicWriteJson(this.authorizationPath(metadata.token), metadata);
    return this.committedReceipt(metadata, reused);
  }

  async readBlob(blobReference) {
    return readFile(this.resolveBlobReference(blobReference));
  }

  resolveBlobReference(blobReference = {}) {
    const sha256 = assertSha256(blobReference.sha256, "blobReference.sha256");
    const expectedKey = blobKey(sha256);
    if (blobReference.objectKey && blobReference.objectKey !== expectedKey) {
      throw objectError("blob reference key does not match its digest", "object.blob_reference_invalid");
    }
    return this.resolveObjectKey(expectedKey);
  }

  committedReceipt(metadata, idempotent) {
    return {
      schemaVersion: CONTRACT_VERSIONS.custodyReceipt,
      intakeId: metadata.intakeId,
      fileId: metadata.fileId,
      sha256: metadata.sha256,
      bytes: metadata.bytes,
      blobReference: { sha256: metadata.sha256, objectKey: metadata.blobObjectKey },
      objectReused: Boolean(metadata.reused),
      idempotent: Boolean(idempotent),
      committedAt: metadata.committedAt,
    };
  }

  async readAuthorization(token) {
    await this.initialize();
    try {
      const metadata = JSON.parse(await readFile(this.authorizationPath(safeId(token, "token")), "utf8"));
      if (metadata?.schemaVersion !== AUTHORIZATION_SCHEMA) throw new Error("unsupported authorization schema");
      return metadata;
    } catch (error) {
      if (error?.code === "ENOENT") throw objectError("upload authorization not found", "object.authorization_not_found");
      throw error;
    }
  }

  authorizationPath(token) {
    return path.join(this.authorizationRoot, `${safeId(token, "token")}.json`);
  }

  resolveObjectKey(objectKey) {
    const normalized = String(objectKey || "").replaceAll("\\", "/");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw objectError("invalid object key", "object.key_invalid");
    }
    const resolved = path.resolve(this.root, normalized);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) throw objectError("object key escaped root", "object.key_invalid");
    return resolved;
  }
}

function blobKey(sha256) {
  return `blobs/sha256/${sha256.slice(0, 2)}/${sha256}`;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function atomicWriteJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

function safeId(value, field) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(normalized)) throw objectError(`${field} is invalid`, "object.identifier_invalid");
  return normalized;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw objectError(`${field} must be positive`, "object.integer_invalid");
  return number;
}

function objectError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

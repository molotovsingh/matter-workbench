import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, readdir, rename, rm, stat, statfs, utimes } from "node:fs/promises";
import path from "node:path";

import { assertSha256 } from "../../packages/extraction-contracts/index.mjs";

export class WorkerScratchSpace {
  constructor({
    root,
    maximumTaskBytes = 2 * 1024 * 1024 * 1024,
    minimumFreeBytes = 512 * 1024 * 1024,
    statfsImpl = statfs,
    clock = () => new Date(),
    // Content-addressed local blob cache, shared across every worker that
    // materializes source documents. A document is split into pages ÷ range
    // size work units, and each one previously re-downloaded the WHOLE source
    // from object storage: measured at 32x byte amplification on a real
    // corpus (2.4 GB fetched for 75 MB of PDFs). Blobs are immutable and
    // named by their own digest, so caching them locally is safe by
    // construction. Pass null to disable.
    blobCache = null,
  } = {}) {
    if (!root) throw new Error("worker scratch root is required");
    this.root = path.resolve(root);
    this.maximumTaskBytes = positiveInteger(maximumTaskBytes, "maximumTaskBytes");
    this.minimumFreeBytes = nonNegativeInteger(minimumFreeBytes, "minimumFreeBytes");
    this.statfsImpl = statfsImpl;
    this.clock = clock;
    this.blobCache = blobCache;
  }

  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async withTaskScratch({ taskId, expectedBytes = 0 } = {}, operation) {
    if (typeof operation !== "function") throw new Error("scratch operation is required");
    const allocation = await this.allocate({ taskId, expectedBytes });
    try {
      return await operation(allocation);
    } finally {
      await allocation.cleanup();
    }
  }

  async allocate({ taskId, expectedBytes = 0 } = {}) {
    await this.initialize();
    const safeTaskId = safeId(taskId, "taskId");
    const expected = nonNegativeInteger(expectedBytes, "expectedBytes");
    if (expected > this.maximumTaskBytes) throw scratchError("task exceeds configured scratch limit", "scratch.task_limit_exceeded");
    await this.assertCapacity(expected);
    const allocationId = `${safeTaskId}-${randomUUID()}`;
    const directory = this.resolve(allocationId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    let cleaned = false;
    return Object.freeze({
      allocationId,
      directory,
      createdAt: this.clock().toISOString(),
      maximumBytes: this.maximumTaskBytes,
      pathFor: (name) => safeChildPath(directory, name),
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        await rm(directory, { recursive: true, force: true });
      },
    });
  }

  async materializeBlob({ allocation, objectStore, blobReference, fileName = "source.pdf" } = {}) {
    if (!allocation?.directory || typeof allocation.pathFor !== "function") throw new Error("scratch allocation is required");
    if (!objectStore?.openBlobStream) throw new Error("objectStore.openBlobStream is required for bounded scratch materialization");
    const expectedSha256 = assertSha256(blobReference?.sha256, "blobReference.sha256");
    // Read the bytes from the local cache when this blob has already been
    // fetched and verified; otherwise from object storage. Everything below —
    // size ceiling, streaming hash, digest check, atomic rename — is identical
    // either way, so a cache hit is never a weaker custody guarantee than a
    // fresh download: the digest is recomputed from the bytes actually used.
    const cached = this.blobCache ? await this.blobCache.open(expectedSha256) : null;
    const opened = cached || await objectStore.openBlobStream(blobReference);
    // Everything between opening the source and the consuming loop can throw
    // (size ceilings, disk capacity, mkdir, exclusive create). The source is an
    // open handle by then — a local file descriptor for a cache hit, a socket
    // for a download — so any early exit must release it explicitly or the
    // descriptor survives until process exit. That matters most under disk
    // pressure, where the same throw repeats for every work unit.
    let target;
    let temporary;
    let handle;
    try {
      const contentLength = positiveInteger(opened.contentLength, "blob contentLength");
      if (contentLength > allocation.maximumBytes || contentLength > this.maximumTaskBytes) {
        throw scratchError("blob exceeds configured scratch limit", "scratch.task_limit_exceeded");
      }
      await this.assertScratchCapacity(contentLength);
      target = allocation.pathFor(fileName);
      temporary = allocation.pathFor(`${fileName}.${randomUUID()}.partial`);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      handle = await open(temporary, "wx", 0o600);
    } catch (error) {
      releaseStream(opened.body);
      throw error;
    }
    const contentLength = positiveInteger(opened.contentLength, "blob contentLength");
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of asAsyncIterable(opened.body)) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > contentLength || bytes > allocation.maximumBytes) {
          throw scratchError("blob exceeded its declared or allocated size", "scratch.size_mismatch");
        }
        hash.update(buffer);
        await handle.writeFile(buffer);
      }
      if (bytes !== contentLength) throw scratchError(`materialized ${bytes} bytes; expected ${contentLength}`, "scratch.size_mismatch");
      const sha256 = hash.digest("hex");
      if (sha256 !== expectedSha256) throw scratchError("materialized blob digest did not match custody reference", "scratch.sha256_mismatch");
      await handle.sync();
      await handle.close();
      await rename(temporary, target);
      const details = await stat(target);
      // Publish only what the network produced; a cache hit is already cached.
      if (this.blobCache && !cached) await this.blobCache.publish(sha256, target);
      return { filePath: target, bytes: details.size, sha256, fromCache: Boolean(cached) };
    } catch (error) {
      try {
        await handle.close();
      } catch {}
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async removeStaleAllocations({ olderThanMs = 24 * 60 * 60 * 1000 } = {}) {
    const threshold = this.clock().getTime() - positiveInteger(olderThanMs, "olderThanMs");
    await this.initialize();
    const entries = await readdir(this.root, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const target = this.resolve(entry.name);
      const details = await stat(target);
      if (details.mtimeMs >= threshold) continue;
      await rm(target, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  /**
   * Disk capacity for real work, with the cache treated as reclaimable rather
   * than sacred. The cache lives on the same filesystem the scratch space must
   * keep free, and its byte limit is independent of actual disk pressure — so
   * without this, a full cache can starve the very work units it exists to
   * speed up, and every one of them fails with capacity_exhausted while
   * gigabytes of purely optional data sit on disk.
   */
  async assertScratchCapacity(requestedBytes) {
    try {
      return await this.assertCapacity(requestedBytes);
    } catch (error) {
      if (error?.code !== "scratch.capacity_exhausted" || !this.blobCache?.reclaim) throw error;
      const freed = await this.blobCache.reclaim(requestedBytes + this.minimumFreeBytes);
      if (!freed) throw error;
      return this.assertCapacity(requestedBytes);
    }
  }

  async assertCapacity(requestedBytes) {
    const details = await this.statfsImpl(this.root);
    const availableBytes = Number(details.bavail) * Number(details.bsize);
    if (!Number.isFinite(availableBytes)) throw scratchError("scratch filesystem capacity could not be measured", "scratch.capacity_unknown");
    if (availableBytes - requestedBytes < this.minimumFreeBytes) {
      throw scratchError("scratch filesystem does not have sufficient reserved capacity", "scratch.capacity_exhausted");
    }
    return availableBytes;
  }

  resolve(relative) {
    const target = path.resolve(this.root, relative);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw scratchError("scratch path escaped its root", "scratch.path_invalid");
    return target;
  }
}

async function* asAsyncIterable(body) {
  if (!body) throw scratchError("blob stream body is missing", "scratch.body_missing");
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
    return;
  }
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    yield body;
    return;
  }
  throw scratchError("blob stream body is invalid", "scratch.body_invalid");
}

function safeChildPath(directory, name) {
  const normalized = String(name || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw scratchError("scratch child path is invalid", "scratch.path_invalid");
  }
  const target = path.resolve(directory, normalized);
  if (!target.startsWith(`${directory}${path.sep}`)) throw scratchError("scratch child path escaped allocation", "scratch.path_invalid");
  return target;
}

function safeId(value, field) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(normalized)) throw scratchError(`${field} is invalid`, "scratch.identifier_invalid");
  return normalized;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw scratchError(`${field} must be a positive integer`, "scratch.integer_invalid");
  return number;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw scratchError(`${field} must be a non-negative integer`, "scratch.integer_invalid");
  return number;
}

// Release a source handle that will never be consumed: a local read stream or
// a response body. Best-effort by design — this runs on an error path.
function releaseStream(body) {
  try {
    if (typeof body?.destroy === "function") body.destroy();
    else if (typeof body?.cancel === "function") body.cancel().catch(() => {});
    else if (typeof body?.return === "function") body.return();
  } catch { /* the caller is already failing; disposal must not mask it */ }
}

function scratchError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

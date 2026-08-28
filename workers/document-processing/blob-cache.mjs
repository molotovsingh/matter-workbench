import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Local content-addressed cache for source blobs.
//
// A document is fanned out into (pages ÷ range size) work units, and every one
// of them materializes the WHOLE source PDF to run poppler against a page
// range. Against a local-disk object store that was nearly free; against real
// object storage it is 32x byte amplification (measured: 2.4 GB fetched for a
// 75 MB corpus) and it dominates post-custody latency.
//
// Caching is safe here by construction rather than by policy: blob keys ARE
// their own sha256, so an entry can never go stale — the same key always means
// the same bytes. Callers still hash whatever they read, so a corrupted or
// truncated cache file fails custody verification exactly like a corrupted
// download would; the cache can lose data or serve garbage without ever being
// able to launder it into the record.
export function createBlobCache({
  root,
  maximumBytes = 8 * 1024 * 1024 * 1024,
  clock = () => new Date(),
} = {}) {
  if (!root) throw new Error("blob cache requires a root");
  const cacheRoot = path.resolve(root);
  // The key is the whole path: validate it here rather than trusting every
  // caller, so a malformed digest can never address a file outside the cache.
  const entryPath = (sha256) => {
    const digest = String(sha256 || "");
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      const error = new Error("blob cache keys must be lowercase sha256 digests");
      error.code = "blob_cache.key_invalid";
      throw error;
    }
    return path.join(cacheRoot, digest.slice(0, 2), digest);
  };
  const limit = Number(maximumBytes) > 0 ? Number(maximumBytes) : 0;
  // Single-flight publish: many lanes finish the same first download at once.
  const publishing = new Map();
  let reclaiming = null;

  return Object.freeze({
    root: cacheRoot,

    /**
     * Returns an openBlobStream-shaped handle when the blob is cached, else
     * null. Any error (missing, unreadable, racing eviction) is a plain miss.
     */
    async open(sha256) {
      let file;
      try {
        file = entryPath(sha256);
        const details = await stat(file);
        if (!details.isFile() || details.size === 0) return null;
        // Touch for recency-ordered eviction; failure to touch is harmless.
        await utimes(file, clock(), clock()).catch(() => {});
        return { body: createReadStream(file), contentLength: details.size, sha256, cached: true };
      } catch {
        return null;
      }
    },

    /** Copy an already-verified file into the cache, atomically. */
    async publish(sha256, verifiedPath) {
      try { entryPath(sha256); } catch { return; }
      if (publishing.has(sha256)) return publishing.get(sha256);
      const task = (async () => {
        const file = entryPath(sha256);
        const temporary = `${file}.${process.pid}.${randomUUID()}.partial`;
        try {
          await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
          await copyFile(verifiedPath, temporary);
          await rename(temporary, file);
          await evictIfOverLimit();
        } catch {
          // The cache is an optimization: a publish failure must never fail
          // the work unit that already has its verified bytes.
          await rm(temporary, { force: true }).catch(() => {});
        }
      })().finally(() => publishing.delete(sha256));
      publishing.set(sha256, task);
      return task;
    },

    /**
     * Give disk back to real work. The cache shares a filesystem with the
     * scratch space, and its size limit knows nothing about actual disk
     * pressure — so when a work unit cannot reserve space, the cache must
     * yield rather than let purely optional data starve the pipeline.
     *
     * Single-flight, because disk pressure is a fleet-wide event: every lane
     * hits it in the same instant, and independent sweeps would each free their
     * own shortage — one shortage costing the cache N times over, evicting
     * precisely the entries those lanes are about to ask for. Joiners get the
     * bytes this sweep freed; whether that is enough is the caller's re-check
     * against the filesystem, not a promise made here.
     * Returns the bytes actually freed.
     */
    async reclaim(bytesNeeded = 0) {
      if (reclaiming) return reclaiming;
      reclaiming = sweep(bytesNeeded).finally(() => { reclaiming = null; });
      return reclaiming;
    },

    async usage() {
      const entries = await listEntries();
      return { entries: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) };
    },

    async clear() {
      await rm(cacheRoot, { recursive: true, force: true });
    },
  });

  async function listEntries() {
    const entries = [];
    let shards = [];
    try {
      shards = await readdir(cacheRoot, { withFileTypes: true });
    } catch {
      return entries;
    }
    for (const shard of shards) {
      if (!shard.isDirectory()) continue;
      const shardPath = path.join(cacheRoot, shard.name);
      let files = [];
      try {
        files = await readdir(shardPath);
      } catch {
        continue;
      }
      for (const name of files) {
        if (name.includes(".partial")) continue;
        try {
          const details = await stat(path.join(shardPath, name));
          if (details.isFile()) entries.push({ file: path.join(shardPath, name), bytes: details.size, usedAtMs: details.mtimeMs });
        } catch { /* raced eviction */ }
      }
    }
    return entries;
  }

  async function sweep(bytesNeeded) {
    const wanted = Number(bytesNeeded) > 0 ? Number(bytesNeeded) : Infinity;
    const entries = await listEntries();
    entries.sort((a, b) => a.usedAtMs - b.usedAtMs);
    let freed = 0;
    for (const entry of entries) {
      if (freed >= wanted) break;
      try {
        await rm(entry.file, { force: true });
        freed += entry.bytes;
      } catch { /* another worker got there first */ }
    }
    return freed;
  }

  // Least-recently-used trim. Bounded and best-effort: the cache holding a
  // little over its limit briefly is cheaper than blocking work units on
  // bookkeeping.
  async function evictIfOverLimit() {
    if (!limit) return;
    const entries = await listEntries();
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    if (total <= limit) return;
    entries.sort((a, b) => a.usedAtMs - b.usedAtMs);
    for (const entry of entries) {
      if (total <= limit) break;
      try {
        await rm(entry.file, { force: true });
        total -= entry.bytes;
      } catch { /* another worker got there first */ }
    }
  }
}

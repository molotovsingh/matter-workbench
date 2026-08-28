import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBlobCache } from "../workers/document-processing/blob-cache.mjs";
import { WorkerScratchSpace } from "../workers/document-processing/worker-scratch-space.mjs";

// V4-SCRATCH-001
test("V4-SCRATCH-001 streams verified blobs into bounded private scratch and deletes every task allocation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-scratch-"));
  let currentMs = Date.UTC(2026, 7, 24, 12, 0, 0);
  const scratch = new WorkerScratchSpace({
    root,
    maximumTaskBytes: 1024,
    minimumFreeBytes: 100,
    statfsImpl: async () => ({ bavail: 10_000, bsize: 1 }),
    clock: () => new Date(currentMs),
  });
  const payload = Buffer.from("large legal document would stream here");
  const digest = sha256(payload);
  const objectStore = {
    async openBlobStream(reference) {
      assert.equal(reference.sha256, digest);
      return { contentLength: payload.length, body: chunks(payload) };
    },
  };
  try {
    const result = await scratch.withTaskScratch({ taskId: "page-task-1", expectedBytes: payload.length }, async (allocation) => {
      assert.equal((await readdir(root)).length, 1);
      const materialized = await scratch.materializeBlob({
        allocation,
        objectStore,
        blobReference: { sha256: digest },
        fileName: "source/document.pdf",
      });
      assert.equal(materialized.bytes, payload.length);
      assert.equal(materialized.sha256, digest);
      assert.ok(materialized.filePath.startsWith(`${allocation.directory}${path.sep}`));
      return materialized.sha256;
    });
    assert.equal(result, digest);
    assert.deepEqual(await readdir(root), [], "successful task scratch must be removed");

    await assert.rejects(() => scratch.withTaskScratch({ taskId: "page-task-2" }, async (allocation) => {
      await mkdir(allocation.pathFor("temporary"));
      throw new Error("simulated provider failure");
    }), /simulated provider failure/);
    assert.deepEqual(await readdir(root), [], "failed task scratch must also be removed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scratch fails closed on capacity, traversal, digest mismatch, and cleans stale abandoned allocations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-scratch-guard-"));
  let available = 120;
  let now = Date.UTC(2026, 7, 24, 12, 0, 0);
  const scratch = new WorkerScratchSpace({
    root,
    maximumTaskBytes: 100,
    minimumFreeBytes: 50,
    statfsImpl: async () => ({ bavail: available, bsize: 1 }),
    clock: () => new Date(now),
  });
  try {
    await assert.rejects(() => scratch.allocate({ taskId: "too-large", expectedBytes: 101 }), { code: "scratch.task_limit_exceeded" });
    available = 60;
    await assert.rejects(() => scratch.allocate({ taskId: "no-space", expectedBytes: 20 }), { code: "scratch.capacity_exhausted" });
    available = 1_000;
    const allocation = await scratch.allocate({ taskId: "guarded", expectedBytes: 10 });
    assert.throws(() => allocation.pathFor("../escape"), { code: "scratch.path_invalid" });
    const payload = Buffer.from("ten bytes!");
    await assert.rejects(() => scratch.materializeBlob({
      allocation,
      objectStore: { openBlobStream: async () => ({ contentLength: payload.length, body: payload }) },
      blobReference: { sha256: "0".repeat(64) },
    }), { code: "scratch.sha256_mismatch" });
    assert.deepEqual((await readdir(allocation.directory)).filter((name) => name.endsWith(".partial")), []);
    await allocation.cleanup();

    const stale = await scratch.allocate({ taskId: "abandoned", expectedBytes: 1 });
    const old = new Date(now - 2 * 60 * 60 * 1000);
    await utimes(stale.directory, old, old);
    now += 1;
    assert.equal(await scratch.removeStaleAllocations({ olderThanMs: 60 * 60 * 1000 }), 1);
    await assert.rejects(() => access(stale.directory), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function* chunks(payload) {
  yield payload.subarray(0, 4);
  yield payload.subarray(4);
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

// A document fans out into (pages ÷ range size) work units that each
// materialize the WHOLE source. Against real object storage that measured 32x
// byte amplification on a live corpus, so blobs are cached locally by digest.
// The cache must serve identical verified bytes, never weaken verification,
// and never fail a work unit when the cache itself misbehaves.
test("blob cache serves repeat materializations without refetching, and stays a pure optimization", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-blobcache-"));
  try {
    const payload = Buffer.from("%PDF-1.4 cached source document bytes");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    let fetches = 0;
    const objectStore = {
      async openBlobStream() {
        fetches += 1;
        return { body: (async function* () { yield payload; })(), contentLength: payload.length, sha256 };
      },
    };
    const blobCache = createBlobCache({ root: path.join(root, "cache") });
    const scratch = new WorkerScratchSpace({ root: path.join(root, "scratch"), blobCache });

    const first = await scratch.withTaskScratch({ taskId: "range-1" }, (allocation) =>
      scratch.materializeBlob({ allocation, objectStore, blobReference: { sha256 } }));
    assert.equal(fetches, 1);
    assert.equal(first.fromCache, false);
    assert.equal(first.sha256, sha256);

    // Every subsequent work unit for the same document reads locally.
    for (let unit = 0; unit < 5; unit += 1) {
      const repeat = await scratch.withTaskScratch({ taskId: `range-${unit + 2}` }, (allocation) =>
        scratch.materializeBlob({ allocation, objectStore, blobReference: { sha256 } }));
      assert.equal(repeat.fromCache, true);
      assert.equal(repeat.sha256, sha256, "cache hits are digest-verified like downloads");
      assert.equal(repeat.bytes, payload.length);
    }
    assert.equal(fetches, 1, "six work units, one fetch");
    assert.equal((await blobCache.usage()).entries, 1);

    // A corrupted cache entry must fail custody verification, not launder bad
    // bytes into the record — the digest is recomputed from what was read.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(root, "cache", sha256.slice(0, 2), sha256), Buffer.from("tampered"));
    await assert.rejects(
      () => scratch.withTaskScratch({ taskId: "range-tampered" }, (allocation) =>
        scratch.materializeBlob({ allocation, objectStore, blobReference: { sha256 } })),
      (error) => error.code === "scratch.size_mismatch" || error.code === "scratch.sha256_mismatch",
    );

    // An unusable cache degrades to plain fetching rather than failing work.
    await blobCache.clear();
    const afterClear = await scratch.withTaskScratch({ taskId: "range-after-clear" }, (allocation) =>
      scratch.materializeBlob({ allocation, objectStore, blobReference: { sha256 } }));
    assert.equal(afterClear.fromCache, false);
    assert.equal(afterClear.sha256, sha256);
    assert.equal(fetches, 2, "a cleared cache refetches exactly once more");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("blob cache evicts least-recently-used entries once over its size limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-blobevict-"));
  try {
    const blobCache = createBlobCache({ root: path.join(root, "cache"), maximumBytes: 120 });
    const scratch = new WorkerScratchSpace({ root: path.join(root, "scratch"), blobCache });
    const digests = [];
    for (let index = 0; index < 4; index += 1) {
      const payload = Buffer.alloc(50, 97 + index);
      const sha256 = createHash("sha256").update(payload).digest("hex");
      digests.push(sha256);
      await scratch.withTaskScratch({ taskId: `fill-${index}` }, (allocation) =>
        scratch.materializeBlob({
          allocation,
          objectStore: { async openBlobStream() { return { body: (async function* () { yield payload; })(), contentLength: payload.length, sha256 }; } },
          blobReference: { sha256 },
        }));
    }
    const usage = await blobCache.usage();
    assert.ok(usage.bytes <= 120, `cache stayed within its limit (${usage.bytes} bytes)`);
    assert.ok(usage.entries >= 1 && usage.entries <= 2, "oldest entries were evicted first");
    assert.equal(await blobCache.open(digests[digests.length - 1]) !== null, true, "the newest entry survives");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Between opening the source and consuming it, materializeBlob can throw on
// size ceilings, disk capacity, mkdir or exclusive create — and by then the
// source is an open handle (a local fd for a cache hit, a socket for a
// download). Leaking it on every failure exhausts descriptors, and the
// failure that repeats most is disk pressure, which is caused by the cache.
test("materializeBlob releases the source handle when it fails before consuming it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-fd-"));
  try {
    const payload = Buffer.from("%PDF-1.4 oversized for this allocation");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    let destroyed = 0;
    const trackedBody = () => {
      const iterator = (async function* () { yield payload; })();
      return { ...iterator, [Symbol.asyncIterator]: () => iterator, destroy() { destroyed += 1; } };
    };
    const objectStore = {
      async openBlobStream() { return { body: trackedBody(), contentLength: payload.length, sha256 }; },
    };

    // Fails the scratch ceiling, after the source is already open.
    const tiny = new WorkerScratchSpace({ root: path.join(root, "tiny"), maximumTaskBytes: 4 });
    await assert.rejects(
      () => tiny.withTaskScratch({ taskId: "too-big" }, (allocation) =>
        tiny.materializeBlob({ allocation, objectStore, blobReference: { sha256 } })),
      (error) => error.code === "scratch.task_limit_exceeded",
    );
    assert.equal(destroyed, 1, "the unconsumed source was released, not leaked");

    // Fails the disk-capacity reservation, the failure disk pressure repeats.
    const starved = new WorkerScratchSpace({
      root: path.join(root, "starved"),
      // Enough free space for the allocation itself, not for the blob — so the
      // failure lands inside materializeBlob, after the source is open.
      statfsImpl: async () => ({ bavail: 5, bsize: 1 }),
      minimumFreeBytes: 0,
    });
    await assert.rejects(
      () => starved.withTaskScratch({ taskId: "no-disk" }, (allocation) =>
        starved.materializeBlob({ allocation, objectStore, blobReference: { sha256 } })),
      (error) => error.code === "scratch.capacity_exhausted",
    );
    assert.equal(destroyed, 2, "capacity failures release the source too");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// The cache lives on the filesystem the scratch space must keep free, and its
// byte limit knows nothing about real disk pressure. Without reclaim, a full
// cache starves the very work units it exists to accelerate.
test("a full blob cache yields disk back instead of starving work units", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-reclaim-"));
  try {
    const blobCache = createBlobCache({ root: path.join(root, "cache") });
    const staleDigests = [];
    // Seed the cache with entries the pipeline no longer needs.
    for (let index = 0; index < 3; index += 1) {
      const stale = Buffer.alloc(64, 65 + index);
      const staleSha = createHash("sha256").update(stale).digest("hex");
      staleDigests.push(staleSha);
      const seeding = new WorkerScratchSpace({ root: path.join(root, "seed"), blobCache });
      await seeding.withTaskScratch({ taskId: `seed-${index}` }, (allocation) =>
        seeding.materializeBlob({
          allocation,
          objectStore: { async openBlobStream() { return { body: (async function* () { yield stale; })(), contentLength: stale.length, sha256: staleSha }; } },
          blobReference: { sha256: staleSha },
        }));
    }
    assert.equal((await blobCache.usage()).entries, 3);

    // Disk is exhausted until the cache gives space back.
    let freeBytes = 0;
    const scratch = new WorkerScratchSpace({
      root: path.join(root, "work"),
      blobCache,
      minimumFreeBytes: 0,
      statfsImpl: async () => ({ bavail: freeBytes, bsize: 1 }),
    });
    const payload = Buffer.from("%PDF-1.4 the work that must not be starved");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const objectStore = {
      async openBlobStream() { return { body: (async function* () { yield payload; })(), contentLength: payload.length, sha256 }; },
    };
    // Reclaiming frees the seeded entries, which the fake statfs then reflects.
    const originalReclaim = blobCache.reclaim;
    let reclaimCalls = 0;
    const reclaiming = async (bytes) => {
      reclaimCalls += 1;
      const freed = await originalReclaim(bytes);
      freeBytes += freed;
      return freed;
    };
    scratch.blobCache = { ...blobCache, reclaim: reclaiming, open: blobCache.open, publish: blobCache.publish };

    const materialized = await scratch.withTaskScratch({ taskId: "starved-work" }, (allocation) =>
      scratch.materializeBlob({ allocation, objectStore, blobReference: { sha256 } }));
    assert.equal(materialized.sha256, sha256, "work proceeds after the cache yields disk");
    assert.equal(reclaimCalls, 1, "the capacity failure asked the cache to yield");
    assert.equal(await blobCache.open(staleDigests[0]), null, "the least-recently-used entry was surrendered");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

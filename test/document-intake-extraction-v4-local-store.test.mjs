import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalDiskS3, localObjectMetaPath } from "../services/document-intake-extraction/integration/local-composition.mjs";

// Two files with identical bytes committed concurrently both promote the same
// content-addressed key through copyObject. The local client must make that
// promotion atomic: a reader can never observe a partially copied blob, a
// blob that exists always has its metadata sidecar, concurrent copies all
// converge, and no temp litter survives.
test("local disk copyObject is atomic and convergent under concurrent promotion of one content-addressed key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-local-store-"));
  const bucket = "bucket";
  try {
    const localS3 = createLocalDiskS3({ root });
    // Large enough that a non-atomic copy is observable mid-write.
    const payload = Buffer.alloc(8 * 1024 * 1024, 7);
    const sourcePath = path.join(root, bucket, "staging", "source");
    await localS3.client.headBucket({ bucket });
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, payload);

    const destinationKey = "blobs/sha256/ab/abcdef";
    const destinationPath = path.join(root, bucket, destinationKey);
    const copies = Array.from({ length: 4 }, () => localS3.client.copyObject({
      sourceBucket: bucket,
      sourceKey: "staging/source",
      destinationBucket: bucket,
      destinationKey,
      metadata: { sha256: "abcdef" },
    }));
    // While the copies run, any observation of the destination must be the
    // complete object with its sidecar — never a partial.
    let copiesDone = false;
    const allCopies = Promise.all(copies).then(() => { copiesDone = true; });
    while (!copiesDone) {
      try {
        const seen = await stat(destinationPath);
        assert.equal(seen.size, payload.length, "a visible blob must always be complete");
        const meta = JSON.parse(await readFile(localObjectMetaPath(destinationPath), "utf8").catch(() => "null"));
        assert.ok(meta?.metadata?.sha256, "a visible blob must always carry its metadata sidecar");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    await allCopies;

    const head = await localS3.client.headObject({ bucket, key: destinationKey });
    assert.equal(head.contentLength, payload.length);
    assert.equal(head.metadata.sha256, "abcdef");
    const litter = (await readdir(path.dirname(destinationPath))).filter((name) => name.includes(".partial"));
    assert.deepEqual(litter, [], "no temp files survive concurrent promotion");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

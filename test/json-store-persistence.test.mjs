import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createJsonStorePersistence,
  writeJsonFileAtomic,
} from "../services/json-store-persistence.mjs";

test("writeJsonFileAtomic writes through a temporary file and leaves final JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "matter-workbench-json-store-"));
  try {
    const storePath = path.join(dir, "store.json");

    await writeJsonFileAtomic(storePath, '{"ok":true}\n');

    assert.equal(await readFile(storePath, "utf8"), '{"ok":true}\n');
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createJsonStorePersistence serializes store mutations", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "matter-workbench-json-store-"));
  try {
    const storePath = path.join(dir, "store.json");
    const persistence = createJsonStorePersistence({
      storePath,
      serialize: (store) => `${JSON.stringify(store)}\n`,
    });
    const order = [];
    let releaseFirst;
    const firstCanFinish = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const first = persistence.withStoreMutation(async () => {
      order.push("first:start");
      await firstCanFinish;
      order.push("first:end");
    });
    const second = persistence.withStoreMutation(async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.resolve();
    assert.deepEqual(order, ["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function createJsonStorePersistence({ storePath, serialize }) {
  if (!storePath) throw new Error("storePath is required");
  if (typeof serialize !== "function") throw new Error("serialize is required");

  let mutationQueue = Promise.resolve();

  async function writeStoreFile(store) {
    await writeJsonFileAtomic(storePath, serialize(store));
  }

  function withStoreMutation(operation) {
    const run = mutationQueue.then(() => operation());
    mutationQueue = run.catch(() => {});
    return run;
  }

  return {
    withStoreMutation,
    writeStoreFile,
  };
}

export async function writeJsonFileAtomic(filePath, contents) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(tempPath, contents, { flag: "wx" });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function formatJsonStore(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

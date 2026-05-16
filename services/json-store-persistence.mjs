import { writeFileAtomic } from "../shared/atomic-file.mjs";

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
  await writeFileAtomic(filePath, contents);
}

export function formatJsonStore(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

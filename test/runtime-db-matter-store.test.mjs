import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMatterStore } from "../services/matter-store.mjs";

function configService(mattersHome) {
  return {
    getMattersHome: () => mattersHome,
  };
}

async function createMatterFolder(mattersHome, folderName) {
  const root = path.join(mattersHome, folderName);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "matter.json"), JSON.stringify({
    matter_name: folderName,
    client_name: "Client",
  }, null, 2));
  return root;
}

test("runtime DB matter index owns matter list when enabled", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-store-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(path.join(mattersHome, "Filesystem Only Matter"), { recursive: true });

  const runtimeMatterIndex = {
    enabled: true,
    listMatterFolders: async () => [
      { name: "DB Matter B" },
      { name: "DB Matter A" },
    ],
    findMatterFolder: async () => null,
  };
  const store = createMatterStore({
    configService: configService(mattersHome),
    runtimeMatterIndex,
  });

  assert.deepEqual(await store.listMattersHomeChildren(), [
    { name: "DB Matter B" },
    { name: "DB Matter A" },
  ]);
});

test("runtime DB matter index resolves and switches active matter through DB folder mapping", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-switch-"));
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = await createMatterFolder(mattersHome, "DB Folder");

  const runtimeMatterIndex = {
    enabled: true,
    listMatterFolders: async () => [{ name: "DB Folder", matterName: "Legal Caption" }],
    findMatterFolder: async (name) => (
      name === "Legal Caption" || name === "DB Folder"
        ? { name: "DB Folder", matterName: "Legal Caption" }
        : null
    ),
  };
  const store = createMatterStore({
    configService: configService(mattersHome),
    runtimeMatterIndex,
  });

  const resolved = await store.resolveExistingMatter("Legal Caption");
  assert.equal(resolved.name, "DB Folder");
  assert.equal(resolved.matterPath, matterRoot);

  await store.switchMatter("Legal Caption");
  assert.equal(store.getMatterRoot(), matterRoot);
  assert.equal(store.activeMatterNameWithinHome(), "DB Folder");
});

test("runtime DB matter index fails closed when local storage folder is missing", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-missing-storage-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });

  const runtimeMatterIndex = {
    enabled: true,
    listMatterFolders: async () => [{ name: "Missing Local Folder" }],
    findMatterFolder: async () => ({ name: "Missing Local Folder", matterName: "Legal Caption" }),
  };
  const store = createMatterStore({
    configService: configService(mattersHome),
    runtimeMatterIndex,
  });

  await assert.rejects(
    () => store.resolveExistingMatter("Legal Caption"),
    /Matter storage folder is missing/,
  );
});

test("runtime DB postgres storage mode resolves missing local folder as virtual active matter", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-virtual-storage-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });

  const runtimeMatterIndex = {
    enabled: true,
    storageMode: "postgres",
    listMatterFolders: async () => [{ name: "Missing Local Folder", matterName: "Legal Caption" }],
    findMatterFolder: async () => ({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Missing Local Folder",
      matterName: "Legal Caption",
      clientName: "Client",
    }),
  };
  const store = createMatterStore({
    configService: configService(mattersHome),
    runtimeMatterIndex,
  });

  const resolved = await store.resolveExistingMatter("Legal Caption");
  assert.equal(resolved.name, "Missing Local Folder");
  assert.equal(resolved.matterPath, "postgres:Missing Local Folder");
  assert.equal(resolved.runtimeStorageMode, "postgres");

  await store.switchMatter("Legal Caption");
  assert.equal(store.getMatterRoot(), "postgres:Missing Local Folder");
  assert.equal(store.activeMatterNameWithinHome(), "Missing Local Folder");
  assert.deepEqual(store.getActiveMatterRecord(), {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Missing Local Folder",
    matterName: "Legal Caption",
    clientName: "Client",
    runtimeStorageMode: "postgres",
    matterPath: "postgres:Missing Local Folder",
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMatterStore } from "../services/matter-store.mjs";
import { createRuntimeDbMatterIndex } from "../services/runtime-db-matter-index.mjs";
import { runWithRequestContext, runtimeDbUserFromRequestContext } from "../services/request-context.mjs";

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

test("runtime DB postgres storage mode resolves lawyer captions with slashes through the index", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-slash-caption-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const legalCaption = "National Insurance Co. Ltd v M/s Sarkar Fertilizers";
  const storageName = "National Insurance Co. Ltd v M - s Sarkar Fertilizers";

  const runtimeMatterIndex = {
    enabled: true,
    storageMode: "postgres",
    listMatterFolders: async () => [{ name: storageName, matterName: legalCaption }],
    findMatterFolder: async (name) => {
      assert.equal(name, legalCaption);
      return {
        id: "22222222-2222-4222-8222-222222222222",
        name: storageName,
        matterName: legalCaption,
        clientName: "M/s Sarkar Fertilizers",
      };
    },
  };
  const store = createMatterStore({
    configService: configService(mattersHome),
    runtimeMatterIndex,
  });

  const resolved = await store.resolveExistingMatter(legalCaption);
  assert.equal(resolved.name, storageName);
  assert.equal(resolved.matterName, legalCaption);
  assert.equal(resolved.matterPath, `postgres:${storageName}`);
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

test("runtime DB matter index filters rows by current private beta user", async () => {
  const calls = [];
  const runtimeMatterIndex = createRuntimeDbMatterIndex({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_RUNTIME_DB_STORAGE: "postgres",
      MWB_RUNTIME_DATABASE_URL: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
      MWB_RUNTIME_DB_TENANT_ID: "82dc5ad0-fb23-5c08-a06c-73232cd0281f",
    },
    spawn: (command, args, options = {}) => {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: "[]\n", stderr: "" };
    },
  });

  let viewer;
  await runWithRequestContext({
    authenticated: true,
    user: { username: "shivangi@lawzeus.com", role: "tester" },
  }, () => {
    viewer = runtimeDbUserFromRequestContext();
    return runtimeMatterIndex.listMatterFolders();
  });

  assert.match(calls[0].input, /matter_memberships/i);
  assert.match(calls[0].input, /m\.created_by_user_id\s*=/i);
  assert.match(calls[0].input, new RegExp(viewer.id, "i"));
  assert.doesNotMatch(calls[0].input, /m\.created_by_user_id is null/i);
  assert.doesNotMatch(calls[0].input, /secret/);
});

test("runtime DB matter index exposes legacy unowned matters only to superuser", async () => {
  const calls = [];
  const runtimeMatterIndex = createRuntimeDbMatterIndex({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DB_RUNTIME_CUTOVER_APPROVED: "yes",
      MWB_RUNTIME_DB_STORAGE: "postgres",
      MWB_RUNTIME_DATABASE_URL: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
      MWB_RUNTIME_DB_TENANT_ID: "82dc5ad0-fb23-5c08-a06c-73232cd0281f",
    },
    spawn: (command, args, options = {}) => {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: "[]\n", stderr: "" };
    },
  });

  await runWithRequestContext({
    authenticated: true,
    user: { username: "aks", role: "superuser" },
  }, () => runtimeMatterIndex.listMatterFolders());

  assert.match(calls[0].input, /m\.created_by_user_id is null/i);
});

test("filesystem matter store keeps active matter state separate by authenticated user", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-filesystem-scoped-active-"));
  const mattersHome = path.join(tmp, "matters");
  await createMatterFolder(mattersHome, "A Matter");
  await createMatterFolder(mattersHome, "B Matter");

  const store = createMatterStore({
    configService: configService(mattersHome),
  });

  await runWithRequestContext({
    authenticated: true,
    user: { username: "shivangi@lawzeus.com", role: "tester" },
  }, async () => {
    await store.switchMatter("A Matter");
    assert.equal(store.activeMatterNameWithinHome(), "A Matter");
  });

  await runWithRequestContext({
    authenticated: true,
    user: { username: "aks@lawzeus.com", role: "superuser" },
  }, async () => {
    assert.equal(store.activeMatterNameWithinHome(), null);
    await store.switchMatter("B Matter");
    assert.equal(store.activeMatterNameWithinHome(), "B Matter");
  });

  await runWithRequestContext({
    authenticated: true,
    user: { username: "shivangi@lawzeus.com", role: "tester" },
  }, () => {
    assert.equal(store.activeMatterNameWithinHome(), "A Matter");
  });
});

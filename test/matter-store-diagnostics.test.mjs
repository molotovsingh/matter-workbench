import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMatterStore } from "../services/matter-store.mjs";

test("matter store exposes stable local selection and resolution codes", async () => {
  const unconfigured = createMatterStore({ configService: configService("") });
  assert.throws(
    () => unconfigured.ensureMattersHome(),
    (error) => error.statusCode === 409 && error.code === "matter_store.matters_home_not_configured",
  );
  assert.throws(
    () => unconfigured.ensureMatterRoot(),
    (error) => error.statusCode === 409 && error.code === "matter_store.matter_root_not_configured",
  );

  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-matter-store-codes-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const store = createMatterStore({ configService: configService(mattersHome) });

  assert.throws(
    () => store.ensureMatterRoot(),
    (error) => error.statusCode === 409 && error.code === "matter_store.no_active_matter",
  );
  await assertRejectsWithCode(
    () => store.resolveExistingMatter("Missing Matter"),
    404,
    "matter_store.not_found",
  );

  await writeFile(path.join(mattersHome, "Not A Directory"), "not a directory\n");
  await assertRejectsWithCode(
    () => store.resolveExistingMatter("Not A Directory"),
    400,
    "matter_store.not_directory",
  );
});

test("matter store exposes stable runtime DB storage-folder codes", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-matter-store-codes-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });

  const missingRuntimeRow = createMatterStore({
    configService: configService(mattersHome),
    runtimeMatterIndex: {
      enabled: true,
      findMatterFolder: async () => null,
    },
  });
  await assertRejectsWithCode(
    () => missingRuntimeRow.resolveExistingMatter("Missing Matter"),
    404,
    "matter_store.not_found",
  );

  const missingStorage = createMatterStore({
    configService: configService(mattersHome),
    runtimeMatterIndex: {
      enabled: true,
      findMatterFolder: async () => ({ name: "Missing Local Folder" }),
    },
  });
  await assertRejectsWithCode(
    () => missingStorage.resolveExistingMatter("Missing Local Folder"),
    409,
    "matter_store.runtime_storage_folder_missing",
  );

  await writeFile(path.join(mattersHome, "File Matter"), "not a directory\n");
  const fileStorage = createMatterStore({
    configService: configService(mattersHome),
    runtimeMatterIndex: {
      enabled: true,
      findMatterFolder: async () => ({ name: "File Matter" }),
    },
  });
  await assertRejectsWithCode(
    () => fileStorage.resolveExistingMatter("File Matter"),
    409,
    "matter_store.runtime_storage_path_not_directory",
  );
});

function configService(mattersHome) {
  return { getMattersHome: () => mattersHome };
}

async function assertRejectsWithCode(fn, statusCode, code) {
  await assert.rejects(
    fn,
    (error) => error.statusCode === statusCode && error.code === code,
  );
}

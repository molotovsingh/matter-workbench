import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dbEnvPath = new URL("../scripts/db-env.mjs", import.meta.url);

test("database script env loader reads local .env without overriding shell values", async () => {
  const { loadDatabaseScriptEnv } = await import(dbEnvPath.href);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-db-env-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(appDir, ".env"), [
    "MWB_PSQL_BIN=/custom/bin/psql",
    "",
  ].join("\n"));
  await writeFile(path.join(appDir, ".env.shadow"), [
    "MWB_DATABASE_URL=postgres://mwb_user:shadow@127.0.0.1/matter_workbench_shadow",
    "MWB_PSQL_BIN=/shadow/bin/psql",
    "",
  ].join("\n"));

  const targetEnv = { MWB_DATABASE_URL: "postgres://mwb_user:shell@db.example/matter_workbench_shadow" };
  const loaded = await loadDatabaseScriptEnv({ appDir, targetEnv });

  assert.equal(targetEnv.MWB_DATABASE_URL, "postgres://mwb_user:shell@db.example/matter_workbench_shadow");
  assert.equal(targetEnv.MWB_PSQL_BIN, "/custom/bin/psql");
  assert.deepEqual(
    loaded.loadedKeys.sort(),
    ["MWB_DATABASE_URL", "MWB_PSQL_BIN"].sort(),
  );
  assert.deepEqual(
    loaded.loadedPaths.map((loadedPath) => path.basename(loadedPath)).sort(),
    [".env", ".env.shadow"].sort(),
  );
});

test("database script env loader can read ignored .env.shadow for shadow-only credentials", async () => {
  const { loadDatabaseScriptEnv } = await import(dbEnvPath.href);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-db-env-shadow-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(appDir, ".env.shadow"), [
    "MWB_DATABASE_URL=postgres://mwb_user:shadow@127.0.0.1/matter_workbench_shadow",
    "",
  ].join("\n"));

  const targetEnv = {};
  const loaded = await loadDatabaseScriptEnv({ appDir, targetEnv });

  assert.equal(targetEnv.MWB_DATABASE_URL, "postgres://mwb_user:shadow@127.0.0.1/matter_workbench_shadow");
  assert.deepEqual(loaded.loadedKeys, ["MWB_DATABASE_URL"]);
  assert.deepEqual(loaded.loadedPaths.map((loadedPath) => path.basename(loadedPath)), [".env.shadow"]);
});

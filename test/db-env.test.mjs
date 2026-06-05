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
    "MWB_DATABASE_URL=postgres://mwb_user:local@127.0.0.1/matter_workbench_shadow",
    "MWB_PSQL_BIN=/custom/bin/psql",
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
});

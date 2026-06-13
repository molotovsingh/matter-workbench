import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const mothershipEnvPath = new URL("../scripts/mothership-env.mjs", import.meta.url);

test("mothership env loader reads the standard VM mothership env file", async () => {
  const { loadMothershipScriptEnv } = await import(mothershipEnvPath.href);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-mothership-env-"));
  const appDir = path.join(tmp, "app");
  const configDir = path.join(tmp, ".config", "matter-workbench");
  await mkdir(appDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "mothership.env"), [
    "MOTHERSHIP_DATABASE_URL=postgres://mothership:secret@127.0.0.1/mother",
    "MOTHERSHIP_HOST=127.0.0.1",
    "",
  ].join("\n"));

  const targetEnv = {};
  const loaded = await loadMothershipScriptEnv({ appDir, targetEnv, homeDir: tmp });

  assert.equal(targetEnv.MOTHERSHIP_DATABASE_URL, "postgres://mothership:secret@127.0.0.1/mother");
  assert.equal(targetEnv.MOTHERSHIP_HOST, "127.0.0.1");
  assert.deepEqual(
    loaded.loadedPaths.map((loadedPath) => path.basename(loadedPath)),
    ["mothership.env"],
  );
});

test("mothership env loader keeps explicit shell env authoritative", async () => {
  const { loadMothershipScriptEnv } = await import(mothershipEnvPath.href);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-mothership-env-explicit-"));
  const appDir = path.join(tmp, "app");
  const configDir = path.join(tmp, ".config", "matter-workbench");
  await mkdir(appDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "mothership.env"), [
    "MOTHERSHIP_DATABASE_URL=postgres://mothership:file-secret@127.0.0.1/mother",
    "MOTHERSHIP_PORT=4192",
    "",
  ].join("\n"));

  const targetEnv = {
    MOTHERSHIP_DATABASE_URL: "postgres://mothership:shell-secret@db.example/mother",
  };
  const loaded = await loadMothershipScriptEnv({ appDir, targetEnv, homeDir: tmp });

  assert.equal(targetEnv.MOTHERSHIP_DATABASE_URL, "postgres://mothership:shell-secret@db.example/mother");
  assert.equal(targetEnv.MOTHERSHIP_PORT, "4192");
  assert.ok(loaded.loadedKeys.includes("MOTHERSHIP_DATABASE_URL"));
});

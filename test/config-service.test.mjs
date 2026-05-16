import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createConfigService } from "../services/config-service.mjs";

test("config service defaults matters home to the user root", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-workbench-config-"));
  try {
    const service = createConfigService({ appDir: tmp, env: {} });

    assert.equal(service.defaultMattersHome, path.join(os.homedir(), "matters-matter-workbench"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("config service saves matters home atomically", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-workbench-config-"));
  try {
    const service = createConfigService({ appDir: tmp, env: {} });
    const mattersHome = path.join(tmp, "matters");

    const result = await service.setMattersHome(mattersHome);

    assert.deepEqual(result, { mattersHome, homeChanged: true });
    assert.deepEqual(JSON.parse(await readFile(service.configPath, "utf8")), { mattersHome });
    assert.deepEqual((await readdir(tmp)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("config service expands tilde paths from env, saved config, and updates", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-workbench-config-"));
  try {
    const envService = createConfigService({ appDir: tmp, env: { MATTERS_HOME: "~/matters-from-env" } });
    await envService.load();
    assert.equal(envService.getMattersHome(), path.join(os.homedir(), "matters-from-env"));

    const configService = createConfigService({ appDir: tmp, env: {} });
    await writeFile(configService.configPath, `${JSON.stringify({ mattersHome: "~/matters-from-config" })}\n`);
    await configService.load();
    assert.equal(configService.getMattersHome(), path.join(os.homedir(), "matters-from-config"));

    const updated = await configService.setMattersHome("~/matters-from-update");
    assert.equal(updated.mattersHome, path.join(os.homedir(), "matters-from-update"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

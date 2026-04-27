import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

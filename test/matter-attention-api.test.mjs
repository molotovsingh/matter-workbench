import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkbenchServer } from "../server.mjs";

test("matter attention API exposes the active matter attention summary", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-attention-api-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Attention API Matter");
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), "{}\n");
  await writeFile(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "File Register.csv"), "file_id\nFILE-0001\n");

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    matterRoot,
    host: "127.0.0.1",
    port: 0,
    commandInteractionLogPath: path.join(appDir, ".local", "command-interactions.jsonl"),
    configurableSkillRunsPath: path.join(appDir, "configurable-skill-runs.json"),
  });

  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    const response = await fetch(`${baseUrl}/api/matter-attention`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.schema_version, "matter-attention/v1");
    assert.equal(body.matterName, "Attention API Matter");
    assert.equal(typeof body.summary.total, "number");
    assert.ok(Array.isArray(body.items));
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

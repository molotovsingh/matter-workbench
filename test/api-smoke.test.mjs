import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runMatterInit } from "../matter-init-engine.mjs";
import { createWorkbenchServer } from "../server.mjs";

async function postJson(baseUrl, pathName, body = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

test("server API smoke test keeps public routes stable", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-api-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Smoke Matter");
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files", "note.txt"), "Smoke text");
  await runMatterInit({
    matterRoot,
    dryRun: false,
    metadata: {
      clientName: "Smoke",
      matterName: "Smoke Matter",
      oppositeParty: "Opposite",
      matterType: "Test",
      jurisdiction: "Local",
      briefDescription: "",
    },
  });

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    const config = await getJson(baseUrl, "/api/config");
    assert.equal(config.mattersHome, mattersHome);
    const matters = await getJson(baseUrl, "/api/matters");
    assert.deepEqual(matters.matters, [{ name: "Smoke Matter" }]);
    const switched = await postJson(baseUrl, "/api/switch-matter", { name: "Smoke Matter" });
    assert.equal(switched.folderName, "Smoke Matter");
    const workspace = await getJson(baseUrl, "/api/workspace");
    assert.equal(workspace.metadata.matterName, "Smoke Matter");
    const extract = await postJson(baseUrl, "/api/extract", { dryRun: false });
    assert.equal(extract.counts.extracted, 1);
    const doctor = await postJson(baseUrl, "/api/doctor/scan");
    assert.deepEqual(doctor.issues, []);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

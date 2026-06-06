import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkbenchServer } from "../server.mjs";

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

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

test("runtime DB matter index drives /api/matters and switch while workspace reads local storage", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-"));
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "DB Listed Matter");
  await mkdir(path.join(matterRoot, "00_Inbox"), { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({
    matter_name: "DB Listed Matter",
    client_name: "Runtime Client",
  }, null, 2));

  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      listMatterFolders: async () => [
        { name: "DB Listed Matter", matterName: "Legal Caption" },
      ],
      findMatterFolder: async (name) => (
        name === "DB Listed Matter" || name === "Legal Caption"
          ? { name: "DB Listed Matter", matterName: "Legal Caption" }
          : null
      ),
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const matters = await getJson(baseUrl, "/api/matters");
    assert.deepEqual(matters.matters, [
      { name: "DB Listed Matter", matterName: "Legal Caption" },
    ]);

    const workspace = await postJson(baseUrl, "/api/switch-matter", { name: "Legal Caption" });
    assert.equal(workspace.metadata.matterName, "DB Listed Matter");
    assert.equal(workspace.metadata.clientName, "Runtime Client");

    const config = await getJson(baseUrl, "/api/config");
    assert.equal(config.activeMatterName, "DB Listed Matter");
  } finally {
    app.server.close();
  }
});

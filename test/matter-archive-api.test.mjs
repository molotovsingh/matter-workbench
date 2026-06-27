import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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

test("matter archive is non-destructive and reversible", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-archive-api-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Returning Client Matter");
  await mkdir(matterRoot, { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({ matter_name: "Returning Client Matter" }), "utf8");
  await writeFile(path.join(matterRoot, "source-note.txt"), "Client file remains on disk.", "utf8");

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
    assert.deepEqual(await getJson(baseUrl, "/api/matters"), {
      enabled: true,
      mattersHome,
      active: null,
      matters: [{ name: "Returning Client Matter" }],
    });

    await postJson(baseUrl, "/api/switch-matter", { name: "Returning Client Matter" });
    const archived = await postJson(baseUrl, "/api/matters/archive", { name: "Returning Client Matter" });
    assert.equal(archived.active, null);
    assert.equal(archived.matter.name, "Returning Client Matter");
    assert.equal(archived.matter.status, "archived");
    assert.match(archived.message, /not deleted/i);
    assert.equal(await readFile(path.join(matterRoot, "source-note.txt"), "utf8"), "Client file remains on disk.");

    const activeOnly = await getJson(baseUrl, "/api/matters");
    assert.deepEqual(activeOnly.matters, []);

    const withArchived = await getJson(baseUrl, "/api/matters?includeArchived=1");
    assert.equal(withArchived.matters.length, 1);
    assert.equal(withArchived.matters[0].name, "Returning Client Matter");
    assert.equal(withArchived.matters[0].status, "archived");
    assert.match(withArchived.matters[0].archivedAt, /^\d{4}-\d{2}-\d{2}T/);

    const switchArchivedResponse = await fetch(`${baseUrl}/api/switch-matter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Returning Client Matter" }),
    });
    const switchArchivedPayload = await switchArchivedResponse.json();
    assert.equal(switchArchivedResponse.status, 409);
    assert.equal(switchArchivedPayload.code, "matter_store.archived");

    const reopened = await postJson(baseUrl, "/api/matters/reopen", { name: "Returning Client Matter" });
    assert.equal(reopened.matter.name, "Returning Client Matter");
    assert.equal(reopened.matter.status, undefined);
    assert.match(reopened.message, /preserved/i);

    const activeAgain = await getJson(baseUrl, "/api/matters");
    assert.deepEqual(activeAgain.matters, [{ name: "Returning Client Matter" }]);
    await postJson(baseUrl, "/api/switch-matter", { name: "Returning Client Matter" });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

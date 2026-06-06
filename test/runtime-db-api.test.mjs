import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

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

test("runtime DB postgres storage mode serves workspace and files without local matter folder", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-api-storage-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const rawBytes = Buffer.from("%PDF-1.7");
  const calls = [];

  const runtimeMatter = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "DB Listed Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
  };
  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [runtimeMatter],
      findMatterFolder: async (name) => (
        name === "DB Listed Matter" || name === "Legal Caption"
          ? runtimeMatter
          : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readWorkspace(matter) {
        calls.push(["workspace", matter.name]);
        return {
          folderName: matter.name,
          inputLabel: `postgres:${matter.name}`,
          metadata: {
            matterName: matter.matterName,
            clientName: matter.clientName,
            oppositeParty: "",
            matterType: "",
            jurisdiction: "",
          },
          fileCount: 1,
          directoryCount: 1,
          tree: {
            name: matter.name,
            kind: "directory",
            path: "",
            children: [{
              name: "List of Dates.md",
              kind: "file",
              path: "10_Library/List of Dates.md",
              size: 15,
              previewable: true,
              previewKind: "text",
            }],
          },
        };
      },
      async readFilePreview(relativePath, matter) {
        calls.push(["preview", matter.name, relativePath]);
        return {
          path: relativePath,
          name: "List of Dates.md",
          ext: "md",
          content: "# List of Dates",
        };
      },
      async readMatterStatus(matter) {
        calls.push(["status", matter.name]);
        return {
          matterRoot: `postgres:${matter.name}`,
          matterName: matter.name,
          stages: [],
        };
      },
      async readPrepareMatterPlan(matter) {
        calls.push(["prepare", matter.name]);
        return {
          schema_version: "prepare-matter-plan/v1",
          matter: { name: matter.matterName, folderName: matter.name },
          metadata: { missing: [], complete: true },
          stages: [],
          downstream: {},
          nextStep: { state: "complete", label: "Core preparation is current", message: "Review advisory.", stage: "", slash: "" },
          warnings: [],
        };
      },
      async readMatterAttention(matter) {
        calls.push(["attention", matter.name]);
        return {
          schema_version: "matter-attention/v1",
          generated_at: "2026-06-06T00:00:00.000Z",
          matterName: matter.matterName,
          matterRoot: `postgres:${matter.name}`,
          summary: { total: 0, blocker: 0, warning: 0, info: 0, state: "clear" },
          items: [],
        };
      },
      async getRawFile(relativePath, matter) {
        calls.push(["raw", matter.name, relativePath]);
        return {
          contentType: "application/pdf",
          fileSize: rawBytes.length,
          safeFilename: "agreement.pdf",
          stream: Readable.from(rawBytes),
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

    const workspace = await postJson(baseUrl, "/api/switch-matter", { name: "Legal Caption" });
    assert.equal(workspace.inputLabel, "postgres:DB Listed Matter");
    assert.equal(workspace.metadata.clientName, "Runtime Client");

    const currentWorkspace = await getJson(baseUrl, "/api/workspace");
    assert.equal(currentWorkspace.inputLabel, "postgres:DB Listed Matter");

    const preview = await getJson(baseUrl, "/api/file?path=10_Library/List%20of%20Dates.md");
    assert.equal(preview.content, "# List of Dates");

    const status = await getJson(baseUrl, "/api/matter-status");
    assert.equal(status.matterRoot, "postgres:DB Listed Matter");

    const prepare = await getJson(baseUrl, "/api/prepare-matter");
    assert.equal(prepare.schema_version, "prepare-matter-plan/v1");

    const attention = await getJson(baseUrl, "/api/matter-attention");
    assert.equal(attention.schema_version, "matter-attention/v1");

    const raw = await fetch(`${baseUrl}/api/file-raw?path=00_Inbox/Intake%2001/Originals/agreement.pdf`);
    assert.equal(raw.ok, true);
    assert.equal(raw.headers.get("content-type"), "application/pdf");
    assert.equal(await raw.text(), "%PDF-1.7");

    const extract = await fetch(`${baseUrl}/api/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterName: "Legal Caption" }),
    });
    const extractBody = await extract.json();
    assert.equal(extract.status, 409);
    assert.match(extractBody.error, /DB storage mode/i);

    assert.deepEqual(calls, [
      ["workspace", "DB Listed Matter"],
      ["workspace", "DB Listed Matter"],
      ["preview", "DB Listed Matter", "10_Library/List of Dates.md"],
      ["status", "DB Listed Matter"],
      ["prepare", "DB Listed Matter"],
      ["attention", "DB Listed Matter"],
      ["raw", "DB Listed Matter", "00_Inbox/Intake 01/Originals/agreement.pdf"],
    ]);
  } finally {
    app.server.close();
  }
});

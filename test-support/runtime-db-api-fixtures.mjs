import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkbenchServer } from "../server.mjs";

export function runtimeDbMatter(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "DB Listed Matter",
    matterName: "Legal Caption",
    clientName: "Runtime Client",
    ...overrides,
  };
}

export async function runtimeDbTestPaths(slug = "runtime-db-api") {
  const tmp = await mkdtemp(path.join(os.tmpdir(), `mwb-${slug}-`));
  const paths = {
    tmp,
    appDir: path.join(tmp, "app"),
    mattersHome: path.join(tmp, "matters"),
    materializedRoot: path.join(tmp, "materialized"),
  };
  await mkdir(paths.appDir, { recursive: true });
  await mkdir(paths.mattersHome, { recursive: true });
  await mkdir(paths.materializedRoot, { recursive: true });
  return paths;
}

export async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

export async function postJson(baseUrl, pathName, body = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

export async function startRuntimeDbTestServer({
  appDir,
  mattersHome,
  env = {},
  matter = runtimeDbMatter(),
  runtimeMatterIndex = {},
  runtimeDbStorageService = { enabled: true },
  ...options
} = {}) {
  const app = await createWorkbenchServer({
    appDir,
    env: mattersHome === undefined
      ? { MWB_RUNTIME_DB_PROCESSING_WORKER: "0", ...env }
      : { MWB_RUNTIME_DB_PROCESSING_WORKER: "0", MATTERS_HOME: mattersHome, ...env },
    host: "127.0.0.1",
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [matter],
      findMatterFolder: async (name) => (
        name === matter.name || name === matter.matterName ? matter : null
      ),
      ...runtimeMatterIndex,
    },
    runtimeDbStorageService,
    ...options,
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

  return {
    app,
    baseUrl,
    matter,
    close: () => new Promise((resolve, reject) => {
      app.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
  };
}

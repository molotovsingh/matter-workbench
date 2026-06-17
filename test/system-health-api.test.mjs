import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";
import { hashPrivateBetaPassword } from "../services/private-beta-auth-service.mjs";

const routesPath = new URL("../routes/app-shell-routes.mjs", import.meta.url);
const serverPath = new URL("../server.mjs", import.meta.url);

async function startTestServer(options = {}) {
  const app = await createWorkbenchServer({ host: "127.0.0.1", port: 0, ...options });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve())),
  };
}

test("GET /api/system-health returns the read-only health report", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-system-health-api-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  await mkdir(appDir, { recursive: true });
  await mkdir(mattersHome, { recursive: true });
  let calls = 0;
  const server = await startTestServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    systemHealthService: {
      readSystemHealth: async () => {
        calls += 1;
        return {
          schema_version: "system-health/v1",
          generatedAt: "2026-06-16T12:00:00.000Z",
          status: "ok",
          summary: { ok: 1, warning: 0, error: 0, checks: 1, blockingIssues: 0 },
          runtime: { storageMode: "filesystem" },
          checks: [{ id: "runtime.server_process", category: "runtime", label: "Server process", status: "ok", message: "Ready" }],
          recommendations: [],
        };
      },
    },
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/system-health`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.schema_version, "system-health/v1");
    assert.equal(payload.status, "ok");
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});

test("GET /api/system-health returns 403 for authenticated non-operator beta users", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-system-health-api-auth-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const usersFile = path.join(tmp, "users.json");
  await mkdir(appDir, { recursive: true });
  await mkdir(mattersHome, { recursive: true });
  await writeFile(
    usersFile,
    `${JSON.stringify({
      schemaVersion: "private-beta-users/v1",
      users: [
        {
          username: "tester-one",
          role: "tester",
          passwordHash: hashPrivateBetaPassword("secret", { salt: "system-health-auth", iterations: 1_000 }),
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  let calls = 0;
  const server = await startTestServer({
    appDir,
    env: {
      MATTERS_HOME: mattersHome,
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERNAME: "",
      MWB_PRIVATE_BETA_PASSWORD: "",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
    runtimeMatterIndex: {
      enabled: true,
      listMatterFolders: async () => [],
      findMatterFolder: async () => null,
    },
    systemHealthService: {
      readSystemHealth: async () => {
        calls += 1;
        return { schema_version: "system-health/v1", status: "ok", checks: [] };
      },
    },
  });
  try {
    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "tester-one", password: "secret" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];

    const response = await fetch(`${server.baseUrl}/api/system-health`, { headers: { cookie } });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "System health requires an operator account." });
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test("app shell wires read-only system health route behind operator visibility", async () => {
  const source = await readFile(routesPath, "utf8");

  assert.match(source, /systemHealthService/);
  assert.match(source, /exactRoute\("GET", "\/api\/system-health"/);
  assert.match(source, /isPrivateBetaSuperuserOrLocal\(\)/);
  assert.match(source, /systemHealthService\.readSystemHealth\(\)/);
  assert.doesNotMatch(source, /systemHealthService\.(write|save|update|run|mutate|create)/);
});

test("server constructs system health service with existing diagnostics dependencies", async () => {
  const source = await readFile(serverPath, "utf8");

  assert.match(source, /createSystemHealthService/);
  assert.match(source, /aiSettingsService/);
  assert.match(source, /commandInteractionLogService/);
  assert.match(source, /jobStatusService/);
  assert.match(source, /privateBetaObservabilityService/);
  assert.match(source, /runtimeDbStorageService/);
});

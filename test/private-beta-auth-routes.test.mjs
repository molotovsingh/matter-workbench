import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";
import { hashPrivateBetaPassword } from "../services/private-beta-auth-service.mjs";

test("private beta auth blocks product APIs and allows login/logout/status", async () => {
  const app = await createTestApp();
  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const unauthenticatedConfig = await fetch(`${baseUrl}/api/config`);
    assert.equal(unauthenticatedConfig.status, 401);
    assert.deepEqual(await unauthenticatedConfig.json(), {
      error: "Login required",
      authRequired: true,
    });

    const status = await fetch(`${baseUrl}/api/auth/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
      enabled: true,
      authenticated: false,
      user: null,
    });

    const failedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "wrong" }),
    });
    assert.equal(failedLogin.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "secret" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /mwb_private_beta_session=/);

    const authenticatedConfig = await fetch(`${baseUrl}/api/config`, {
      headers: { cookie: cookie.split(";")[0] },
    });
    assert.equal(authenticatedConfig.status, 200);
    const config = await authenticatedConfig.json();
    assert.equal(config.mattersHome, app.mattersHome);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: cookie.split(";")[0] },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test("private beta auth disabled preserves existing public local dev behavior", async () => {
  const app = await createTestApp({ env: { MWB_PRIVATE_BETA_AUTH: "off" } });
  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const config = await fetch(`${baseUrl}/api/config`);
    assert.equal(config.status, 200);

    const status = await fetch(`${baseUrl}/api/auth/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
      enabled: false,
      authenticated: true,
      user: null,
    });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test("private beta auth route accepts configured tester account file", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-auth-route-users-"));
  const usersFile = path.join(tmp, "users.json");
  await writeFile(
    usersFile,
    `${JSON.stringify({
      schemaVersion: "private-beta-users/v1",
      users: [
        {
          username: "tester-one",
          role: "tester",
          passwordHash: hashPrivateBetaPassword("secret", { salt: "route-users", iterations: 1_000 }),
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  const app = await createTestApp({
    env: {
      MWB_PRIVATE_BETA_USERNAME: "",
      MWB_PRIVATE_BETA_PASSWORD: "",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
  });
  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "tester-one", password: "secret" }),
    });
    assert.equal(login.status, 200);
    const payload = await login.json();
    assert.deepEqual(payload.user, { username: "tester-one", role: "tester" });
    assert.doesNotMatch(JSON.stringify(payload), /password|hash|secret/i);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

async function createTestApp({ env = {} } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-auth-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  await mkdir(path.join(appDir, "react-dist"), { recursive: true });
  await mkdir(mattersHome, { recursive: true });
  await writeFile(path.join(appDir, "react-dist", "index.html"), "<div id=\"root\"></div><script src=\"/react/assets/app.js\"></script>");
  const app = await createWorkbenchServer({
    appDir,
    env: {
      MATTERS_HOME: mattersHome,
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERNAME: "operator",
      MWB_PRIVATE_BETA_PASSWORD: "secret",
      ...env,
    },
    host: "127.0.0.1",
    port: 0,
  });
  return { ...app, mattersHome };
}

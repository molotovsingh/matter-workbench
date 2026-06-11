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

test("private beta auth route sees tester account file changes without server restart", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-auth-route-reload-"));
  const usersFile = path.join(tmp, "users.json");
  await writePrivateBetaUsersFile(usersFile, [
    {
      username: "tester-one",
      role: "tester",
      passwordHash: hashPrivateBetaPassword("old-secret", { salt: "route-old", iterations: 1_000 }),
    },
  ]);
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
    const beforeUpdate = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "tester-two", password: "new-secret" }),
    });
    assert.equal(beforeUpdate.status, 401);

    await writePrivateBetaUsersFile(usersFile, [
      {
        username: "tester-one",
        role: "tester",
        disabled: true,
        passwordHash: hashPrivateBetaPassword("old-secret", { salt: "route-old", iterations: 1_000 }),
      },
      {
        username: "tester-two",
        role: "tester",
        passwordHash: hashPrivateBetaPassword("new-secret", { salt: "route-new", iterations: 1_000 }),
      },
    ]);

    const oldUser = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "tester-one", password: "old-secret" }),
    });
    assert.equal(oldUser.status, 401);

    const newUser = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "tester-two", password: "new-secret" }),
    });
    assert.equal(newUser.status, 200);
    const payload = await newUser.json();
    assert.deepEqual(payload.user, { username: "tester-two", role: "tester" });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test("private beta user management APIs are restricted to superuser sessions", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-user-management-routes-"));
  const usersFile = path.join(tmp, "users.json");
  await writePrivateBetaUsersFile(usersFile, [
    {
      username: "aksingh",
      displayName: "AK Singh",
      role: "superuser",
      passwordHash: hashPrivateBetaPassword("super-secret", { salt: "route-superuser", iterations: 1_000 }),
    },
    {
      username: "tester-one",
      role: "tester",
      passwordHash: hashPrivateBetaPassword("tester-secret", { salt: "route-tester", iterations: 1_000 }),
    },
  ]);
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
    const testerCookie = await loginCookie(baseUrl, "tester-one", "tester-secret");
    const testerList = await fetch(`${baseUrl}/api/private-beta/users`, {
      headers: { cookie: testerCookie },
    });
    assert.equal(testerList.status, 403);

    const superCookie = await loginCookie(baseUrl, "aksingh", "super-secret");
    const list = await fetch(`${baseUrl}/api/private-beta/users`, {
      headers: { cookie: superCookie },
    });
    assert.equal(list.status, 200);
    const listed = await list.json();
    assert.equal(listed.schema_version, "private-beta-users-list/v1");
    assert.equal(listed.users.length, 2);
    assert.equal(listed.users.some((user) => user.username === "aksingh" && user.role === "superuser"), true);
    assert.doesNotMatch(JSON.stringify(listed), /passwordHash|super-secret|tester-secret/);

    const create = await fetch(`${baseUrl}/api/private-beta/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: superCookie },
      body: JSON.stringify({ username: "shivangi@lawzeus.com", displayName: "Shivangi" }),
    });
    assert.equal(create.status, 200);
    const created = await create.json();
    assert.equal(created.schema_version, "private-beta-user-response/v1");
    assert.equal(created.user.username, "shivangi@lawzeus.com");
    assert.equal(created.user.role, "tester");
    assert.equal(typeof created.temporaryPassword, "string");
    assert.ok(created.temporaryPassword.length >= 16);
    assert.doesNotMatch(JSON.stringify(created), /passwordHash/);

    const disable = await fetch(`${baseUrl}/api/private-beta/users/${encodeURIComponent("shivangi@lawzeus.com")}/disable`, {
      method: "POST",
      headers: { cookie: superCookie },
    });
    assert.equal(disable.status, 200);
    assert.equal((await disable.json()).user.disabled, true);

    const disabledLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "shivangi@lawzeus.com", password: created.temporaryPassword }),
    });
    assert.equal(disabledLogin.status, 401);

    const enable = await fetch(`${baseUrl}/api/private-beta/users/${encodeURIComponent("shivangi@lawzeus.com")}/enable`, {
      method: "POST",
      headers: { cookie: superCookie },
    });
    assert.equal(enable.status, 200);
    assert.equal((await enable.json()).user.disabled, false);

    const reset = await fetch(`${baseUrl}/api/private-beta/users/${encodeURIComponent("shivangi@lawzeus.com")}/reset-password`, {
      method: "POST",
      headers: { cookie: superCookie },
    });
    assert.equal(reset.status, 200);
    const resetPayload = await reset.json();
    assert.equal(resetPayload.user.username, "shivangi@lawzeus.com");
    assert.notEqual(resetPayload.temporaryPassword, created.temporaryPassword);
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

async function loginCookie(baseUrl, username, password) {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200);
  return login.headers.get("set-cookie").split(";")[0];
}

async function writePrivateBetaUsersFile(usersFile, users) {
  await writeFile(
    usersFile,
    `${JSON.stringify({ schemaVersion: "private-beta-users/v1", users }, null, 2)}\n`,
    "utf8",
  );
}

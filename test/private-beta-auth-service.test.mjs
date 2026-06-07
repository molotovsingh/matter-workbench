import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPrivateBetaAuthService,
  hashPrivateBetaPassword,
  parseCookies,
} from "../services/private-beta-auth-service.mjs";

test("private beta auth is disabled unless explicitly required", () => {
  const service = createPrivateBetaAuthService({ env: {} });
  assert.equal(service.enabled, false);
  assert.equal(service.requireAuth(), false);
  assert.deepEqual(service.status({ headers: {} }), {
    enabled: false,
    authenticated: true,
    user: null,
  });
});

test("private beta auth fails closed when required without credentials", () => {
  assert.throws(
    () => createPrivateBetaAuthService({ env: { MWB_PRIVATE_BETA_AUTH: "required" } }),
    /MWB_PRIVATE_BETA_USERNAME and MWB_PRIVATE_BETA_PASSWORD/,
  );
});

test("private beta auth logs in, validates cookie session, and logs out", () => {
  const service = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERNAME: "operator",
      MWB_PRIVATE_BETA_PASSWORD: "secret",
    },
    tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef"),
    now: () => 1_000,
  });

  const failed = service.login({ username: "operator", password: "wrong" });
  assert.equal(failed.ok, false);
  assert.equal(failed.statusCode, 401);
  assert.equal(failed.setCookie, "");

  const login = service.login({ username: "operator", password: "secret" });
  assert.equal(login.ok, true);
  assert.match(login.setCookie, /mwb_private_beta_session=/);
  assert.match(login.setCookie, /HttpOnly/);
  assert.match(login.setCookie, /SameSite=Strict/);
  assert.doesNotMatch(login.setCookie, /;\s*Secure\b/);

  const request = { headers: { cookie: login.setCookie.split(";")[0] } };
  assert.equal(service.isAuthenticated(request), true);
  assert.deepEqual(service.status(request), {
    enabled: true,
    authenticated: true,
    user: { username: "operator" },
  });

  const logout = service.logout(request);
  assert.match(logout.setCookie, /Max-Age=0/);
  assert.equal(service.isAuthenticated(request), false);
});

test("private beta auth supports operator-managed tester account files", async () => {
  const usersFile = await writeUsersFile([
    {
      username: "aks",
      displayName: "Aks",
      role: "operator",
      passwordHash: hashPrivateBetaPassword("aks-secret", { salt: "salt-aks", iterations: 1_000 }),
    },
    {
      username: "tester-one",
      role: "tester",
      passwordHash: hashPrivateBetaPassword("tester-secret", { salt: "salt-tester", iterations: 1_000 }),
    },
  ]);
  const service = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
    tokenBytes: () => Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    now: () => 1_000,
  });

  const legacyFallback = service.login({ username: "operator", password: "secret" });
  assert.equal(legacyFallback.statusCode, 401);

  const login = service.login({ username: "tester-one", password: "tester-secret" });
  assert.equal(login.statusCode, 200);
  assert.deepEqual(login.payload.user, { username: "tester-one", role: "tester" });
  assert.doesNotMatch(JSON.stringify(login.payload), /password|hash|tester-secret/i);

  const request = { headers: { cookie: login.setCookie.split(";")[0] } };
  assert.deepEqual(service.status(request), {
    enabled: true,
    authenticated: true,
    user: { username: "tester-one", role: "tester" },
  });
});

test("private beta auth reloads operator-managed tester account files on login", async () => {
  const usersFile = await writeUsersFile([
    {
      username: "tester-one",
      role: "tester",
      passwordHash: hashPrivateBetaPassword("old-secret", { salt: "salt-old", iterations: 1_000 }),
    },
  ]);
  const service = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
    tokenBytes: () => Buffer.from("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    now: () => 1_000,
  });

  assert.equal(service.login({ username: "tester-two", password: "new-secret" }).statusCode, 401);

  await writeUsersFileAt(usersFile, [
    {
      username: "tester-one",
      role: "tester",
      disabled: true,
      passwordHash: hashPrivateBetaPassword("old-secret", { salt: "salt-old", iterations: 1_000 }),
    },
    {
      username: "tester-two",
      displayName: "Tester Two",
      role: "tester",
      passwordHash: hashPrivateBetaPassword("new-secret", { salt: "salt-new", iterations: 1_000 }),
    },
  ]);

  const oldUser = service.login({ username: "tester-one", password: "old-secret" });
  assert.equal(oldUser.statusCode, 401);

  const newUser = service.login({ username: "tester-two", password: "new-secret" });
  assert.equal(newUser.statusCode, 200);
  assert.deepEqual(newUser.payload.user, {
    username: "tester-two",
    role: "tester",
    displayName: "Tester Two",
  });
});

test("private beta auth fails closed without throwing when a reloaded account file is malformed", async () => {
  const usersFile = await writeUsersFile([
    {
      username: "tester-one",
      role: "tester",
      passwordHash: hashPrivateBetaPassword("secret", { salt: "salt-reload-bad", iterations: 1_000 }),
    },
  ]);
  const service = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
  });

  await writeFile(usersFile, "{not-json", "utf8");

  const login = service.login({ username: "tester-one", password: "secret" });
  assert.equal(login.ok, false);
  assert.equal(login.statusCode, 503);
  assert.equal(login.setCookie, "");
  assert.match(login.payload.error, /Private beta account file/i);
  assert.doesNotMatch(JSON.stringify(login.payload), /secret|passwordHash/i);
});

test("private beta auth invalidates existing sessions when a file-backed account is disabled", async () => {
  const usersFile = await writeUsersFile([
    {
      username: "tester-one",
      role: "tester",
      passwordHash: hashPrivateBetaPassword("secret", { salt: "salt-disable-session", iterations: 1_000 }),
    },
  ]);
  const service = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
    tokenBytes: () => Buffer.from("cccccccccccccccccccccccccccccccc"),
    now: () => 1_000,
  });
  const login = service.login({ username: "tester-one", password: "secret" });
  assert.equal(login.statusCode, 200);
  const request = { headers: { cookie: login.setCookie.split(";")[0] } };
  assert.equal(service.isAuthenticated(request), true);

  await writeUsersFileAt(usersFile, [
    {
      username: "tester-one",
      role: "tester",
      disabled: true,
      passwordHash: hashPrivateBetaPassword("secret", { salt: "salt-disable-session", iterations: 1_000 }),
    },
  ]);

  assert.equal(service.isAuthenticated(request), false);
  assert.deepEqual(service.status(request), {
    enabled: true,
    authenticated: false,
    user: null,
  });
});

test("private beta auth rejects disabled file-backed tester accounts", async () => {
  const usersFile = await writeUsersFile([
    {
      username: "paused-tester",
      role: "tester",
      disabled: true,
      passwordHash: hashPrivateBetaPassword("tester-secret", { salt: "salt-disabled", iterations: 1_000 }),
    },
  ]);
  const service = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
  });

  const login = service.login({ username: "paused-tester", password: "tester-secret" });
  assert.equal(login.statusCode, 401);
  assert.equal(login.setCookie, "");
});

test("private beta auth fails closed for malformed configured tester account file", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-users-bad-"));
  const usersFile = path.join(tmp, "users.json");
  await writeFile(usersFile, "{not-json", "utf8");

  assert.throws(
    () => createPrivateBetaAuthService({
      env: {
        MWB_PRIVATE_BETA_AUTH: "required",
        MWB_PRIVATE_BETA_USERS_FILE: usersFile,
      },
    }),
    /MWB_PRIVATE_BETA_USERS_FILE/,
  );
});

test("private beta auth marks cookies secure only when configured for https deployment", () => {
  const insecure = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERNAME: "operator",
      MWB_PRIVATE_BETA_PASSWORD: "secret",
      MWB_PRIVATE_BETA_COOKIE_SECURE: "false",
    },
    tokenBytes: () => Buffer.from("11111111111111111111111111111111"),
  });
  assert.doesNotMatch(
    insecure.login({ username: "operator", password: "secret" }).setCookie,
    /;\s*Secure\b/,
  );

  const explicitSecure = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERNAME: "operator",
      MWB_PRIVATE_BETA_PASSWORD: "secret",
      MWB_PRIVATE_BETA_COOKIE_SECURE: "true",
    },
    tokenBytes: () => Buffer.from("22222222222222222222222222222222"),
  });
  assert.match(
    explicitSecure.login({ username: "operator", password: "secret" }).setCookie,
    /;\s*Secure\b/,
  );

  const httpsPublicUrl = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERNAME: "operator",
      MWB_PRIVATE_BETA_PASSWORD: "secret",
      MWB_PRIVATE_BETA_PUBLIC_URL: "https://private.example.test",
    },
    tokenBytes: () => Buffer.from("33333333333333333333333333333333"),
  });
  assert.match(
    httpsPublicUrl.login({ username: "operator", password: "secret" }).setCookie,
    /;\s*Secure\b/,
  );
});

test("private beta auth throttles repeated failed login attempts per client", () => {
  let currentNow = 1_000;
  const service = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERNAME: "operator",
      MWB_PRIVATE_BETA_PASSWORD: "secret",
      MWB_PRIVATE_BETA_LOGIN_MAX_ATTEMPTS: "2",
      MWB_PRIVATE_BETA_LOGIN_WINDOW_SECONDS: "5",
    },
    tokenBytes: () => Buffer.from("44444444444444444444444444444444"),
    now: () => currentNow,
  });

  assert.equal(service.login({ username: "operator", password: "bad" }, { clientKey: "198.51.100.7" }).statusCode, 401);
  assert.equal(service.login({ username: "operator", password: "bad" }, { clientKey: "198.51.100.7" }).statusCode, 401);
  const throttled = service.login({ username: "operator", password: "secret" }, { clientKey: "198.51.100.7" });
  assert.equal(throttled.statusCode, 429);
  assert.match(throttled.payload.error, /Too many login attempts/);

  const otherClient = service.login({ username: "operator", password: "secret" }, { clientKey: "203.0.113.2" });
  assert.equal(otherClient.statusCode, 200);

  currentNow = 7_000;
  const afterWindow = service.login({ username: "operator", password: "secret" }, { clientKey: "198.51.100.7" });
  assert.equal(afterWindow.statusCode, 200);
});

test("private beta auth expires old sessions", () => {
  let currentNow = 1_000;
  const service = createPrivateBetaAuthService({
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERNAME: "operator",
      MWB_PRIVATE_BETA_PASSWORD: "secret",
      MWB_PRIVATE_BETA_SESSION_TTL_SECONDS: "5",
    },
    tokenBytes: () => Buffer.from("fedcba9876543210fedcba9876543210"),
    now: () => currentNow,
  });

  const login = service.login({ username: "operator", password: "secret" });
  const request = { headers: { cookie: login.setCookie.split(";")[0] } };
  assert.equal(service.isAuthenticated(request), true);
  currentNow = 7_000;
  assert.equal(service.isAuthenticated(request), false);
});

test("cookie parser handles encoded cookie values", () => {
  assert.deepEqual(parseCookies("a=1; mwb_private_beta_session=abc%20123; empty="), {
    a: "1",
    mwb_private_beta_session: "abc 123",
    empty: "",
  });
});

async function writeUsersFile(users) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-users-"));
  await mkdir(tmp, { recursive: true });
  const usersFile = path.join(tmp, "users.json");
  await writeUsersFileAt(usersFile, users);
  return usersFile;
}

async function writeUsersFileAt(usersFile, users) {
  await writeFile(
    usersFile,
    `${JSON.stringify({ schemaVersion: "private-beta-users/v1", users }, null, 2)}\n`,
    "utf8",
  );
}

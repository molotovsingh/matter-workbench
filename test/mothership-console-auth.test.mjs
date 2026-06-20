import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

import { createConsoleAuthService, hashConsolePassword, verifyPassword, parsePasswordHash } from "../mothership/console-auth.mjs";

const FIXED_NOW_MS = Date.parse("2026-06-20T12:00:00.000Z");
const VALID_HASH = hashConsolePassword("correct-horse-battery", {
  saltBytes: 16,
  hashBytes: 32,
  iterations: 1000,
});

function envWithAuth(overrides = {}) {
  return {
    MOTHERSHIP_CONSOLE: "required",
    MOTHERSHIP_CONSOLE_USERNAME: "aks",
    MOTHERSHIP_CONSOLE_PASSWORD_HASH: VALID_HASH,
    MOTHERSHIP_CONSOLE_SESSION_TTL_SECONDS: "3600",
    MOTHERSHIP_CONSOLE_LOGIN_MAX_ATTEMPTS: "3",
    MOTHERSHIP_CONSOLE_LOGIN_WINDOW_SECONDS: "60",
    ...overrides,
  };
}

function makeService({ env = envWithAuth(), nowMs = FIXED_NOW_MS } = {}) {
  return createConsoleAuthService({ env, now: () => nowMs, tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8") });
}

function cookieRequest(cookieValue = "") {
  return { headers: { cookie: cookieValue } };
}

test("console auth is disabled when MOTHERSHIP_CONSOLE is not set", () => {
  const service = createConsoleAuthService({ env: {} });
  assert.equal(service.requireAuth(), false);
  assert.equal(service.isAuthenticated(cookieRequest()), true);
  assert.deepEqual(service.status(cookieRequest()), { enabled: false, authenticated: true, user: null });
});

test("console auth requires username and a valid password hash when enabled", () => {
  assert.throws(
    () => createConsoleAuthService({ env: { MOTHERSHIP_CONSOLE: "required", MOTHERSHIP_CONSOLE_USERNAME: "aks" } }),
    /MOTHERSHIP_CONSOLE_USERNAME and a valid MOTHERSHIP_CONSOLE_PASSWORD_HASH/i,
  );
  assert.throws(
    () => createConsoleAuthService({ env: { MOTHERSHIP_CONSOLE: "required", MOTHERSHIP_CONSOLE_USERNAME: "aks", MOTHERSHIP_CONSOLE_PASSWORD_HASH: "bogus" } }),
    /MOTHERSHIP_CONSOLE_PASSWORD_HASH/i,
  );
});

test("hashConsolePassword produces a hash that verifyPassword accepts and parsePasswordHash recognizes", () => {
  const hash = hashConsolePassword("hunter2", { iterations: 5000 });
  assert.match(hash, /^pbkdf2-sha256\$5000\$/);
  assert.equal(verifyPassword("hunter2", hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
  assert.ok(parsePasswordHash(hash));
  assert.equal(parsePasswordHash("pbkdf2-sha256$0$x$y"), null);
});

test("login succeeds with correct credentials and issues a session cookie", () => {
  const service = makeService();
  const result = service.login({ username: "aks", password: "correct-horse-battery" }, { clientKey: "test" });

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.authenticated, true);
  assert.equal(result.payload.user.username, "aks");
  assert.equal(result.payload.user.role, "operator");
  assert.match(result.setCookie, /mwb_mothership_console_session=/);
  assert.match(result.setCookie, /Max-Age=3600/);
  assert.match(result.setCookie, /HttpOnly/);
});

test("an issued session cookie authenticates subsequent requests", () => {
  const service = makeService();
  const result = service.login({ username: "aks", password: "correct-horse-battery" }, { clientKey: "test" });
  const token = result.setCookie.match(/mwb_mothership_console_session=([^;]+)/)[1];
  const request = cookieRequest(`mwb_mothership_console_session=${token}`);

  assert.equal(service.isAuthenticated(request), true);
  assert.equal(service.status(request).authenticated, true);
  assert.equal(service.sessionUser(request).username, "aks");
});

test("login rejects wrong password and does not issue a cookie", () => {
  const service = makeService();
  const result = service.login({ username: "aks", password: "nope" }, { clientKey: "test" });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 401);
  assert.equal(result.setCookie, "");
  assert.equal(service.isAuthenticated(cookieRequest()), false);
});

test("login rejects wrong username", () => {
  const service = makeService();
  const result = service.login({ username: "other", password: "correct-horse-battery" }, { clientKey: "test" });
  assert.equal(result.statusCode, 401);
});

test("repeated failed logins throttle the client", () => {
  const service = makeService({ env: envWithAuth({ MOTHERSHIP_CONSOLE_LOGIN_MAX_ATTEMPTS: "2", MOTHERSHIP_CONSOLE_LOGIN_WINDOW_SECONDS: "60" }) });
  const first = service.login({ username: "aks", password: "bad" }, { clientKey: "throttled-client" });
  const second = service.login({ username: "aks", password: "bad" }, { clientKey: "throttled-client" });
  const third = service.login({ username: "aks", password: "correct-horse-battery" }, { clientKey: "throttled-client" });

  assert.equal(first.statusCode, 401);
  assert.equal(second.statusCode, 401);
  assert.equal(third.statusCode, 429);
  assert.match(third.payload.error, /too many login attempts/i);
});

test("throttle key ignores X-Forwarded-For so spoofed headers cannot bypass limits", () => {
  const service = makeService({ env: envWithAuth({ MOTHERSHIP_CONSOLE_LOGIN_MAX_ATTEMPTS: "2", MOTHERSHIP_CONSOLE_LOGIN_WINDOW_SECONDS: "60" }) });
  const requests = [
    { headers: { "x-forwarded-for": "1.2.3.4" }, socket: { remoteAddress: "192.168.1.1" } },
    { headers: { "x-forwarded-for": "5.6.7.8" }, socket: { remoteAddress: "192.168.1.1" } },
    { headers: { "x-forwarded-for": "9.10.11.12" }, socket: { remoteAddress: "192.168.1.1" } },
  ];
  const first = service.login({ username: "aks", password: "bad" }, { request: requests[0] });
  const second = service.login({ username: "aks", password: "bad" }, { request: requests[1] });
  const third = service.login({ username: "aks", password: "correct-horse-battery" }, { request: requests[2] });

  assert.equal(first.statusCode, 401);
  assert.equal(second.statusCode, 401);
  assert.equal(third.statusCode, 429, "third attempt from same remoteAddress should be throttled despite rotating XFF");
});

test("login always runs PBKDF2 regardless of username match (no timing oracle)", () => {
  const service = makeService();
  const wrongUser = service.login({ username: "totally-wrong", password: "x" }, { clientKey: "timing-1" });
  const wrongPass = service.login({ username: "aks", password: "x" }, { clientKey: "timing-2" });

  assert.equal(wrongUser.statusCode, 401);
  assert.equal(wrongPass.statusCode, 401);
  assert.equal(wrongUser.payload.error, wrongPass.payload.error, "same error message regardless of which field is wrong");
});

test("expired sessions are rejected", () => {
  let nowMs = FIXED_NOW_MS;
  const service = createConsoleAuthService({
    env: envWithAuth({ MOTHERSHIP_CONSOLE_SESSION_TTL_SECONDS: "1" }),
    now: () => nowMs,
    tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
  });
  const result = service.login({ username: "aks", password: "correct-horse-battery" }, { clientKey: "test" });
  const token = result.setCookie.match(/mwb_mothership_console_session=([^;]+)/)[1];
  const request = cookieRequest(`mwb_mothership_console_session=${token}`);

  assert.equal(service.isAuthenticated(request), true);
  nowMs += 2 * 1000;
  assert.equal(service.isAuthenticated(request), false);
  assert.equal(service.status(request).authenticated, false);
});

test("logout clears the session and cookie", () => {
  const service = makeService();
  const loginResult = service.login({ username: "aks", password: "correct-horse-battery" }, { clientKey: "test" });
  const token = loginResult.setCookie.match(/mwb_mothership_console_session=([^;]+)/)[1];
  const request = cookieRequest(`mwb_mothership_console_session=${token}`);

  assert.equal(service.isAuthenticated(request), true);
  const logoutResult = service.logout(request);
  assert.equal(logoutResult.payload.authenticated, false);
  assert.match(logoutResult.setCookie, /Max-Age=0/);
  assert.equal(service.isAuthenticated(request), false);
});

test("secure cookie flag follows https public URL", () => {
  const service = makeService({ env: envWithAuth({ MOTHERSHIP_CONSOLE_PUBLIC_URL: "https://mothership.example.com" }) });
  const result = service.login({ username: "aks", password: "correct-horse-battery" }, { clientKey: "test" });
  assert.match(result.setCookie, /; Secure/);
  assert.equal(service.secureCookie, true);
});

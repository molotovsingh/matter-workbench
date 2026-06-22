import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

import { createConsoleAuthService, hashConsolePassword, verifyPassword, parsePasswordHash, isConsoleAuthEnabled } from "../mothership/console-auth.mjs";

const FIXED_NOW_MS = Date.parse("2026-06-20T12:00:00.000Z");
const VALID_HASH = hashConsolePassword("correct-horse-battery", {
  saltBytes: 16,
  hashBytes: 32,
  iterations: 1000,
});

function envWithAuth(overrides = {}) {
  return {
    MOTHERSHIP_CONSOLE: "required",
    MOTHERSHIP_CONSOLE_USERNAME: "aks_hemanth",
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

test("console auth fails closed when MOTHERSHIP_CONSOLE is not set", () => {
  assert.throws(
    () => createConsoleAuthService({ env: {} }),
    /MOTHERSHIP_CONSOLE_USERNAME and a valid MOTHERSHIP_CONSOLE_PASSWORD_HASH/i,
  );
});

test("console auth enablement is fail-closed unless explicitly opened", () => {
  assert.equal(isConsoleAuthEnabled({}), true);
  assert.equal(isConsoleAuthEnabled({ MOTHERSHIP_CONSOLE: "required" }), true);
  assert.equal(isConsoleAuthEnabled({ MOTHERSHIP_CONSOLE: "open" }), false);
  assert.equal(isConsoleAuthEnabled({ MOTHERSHIP_CONSOLE: "disabled" }), false);
  assert.equal(isConsoleAuthEnabled({ MOTHERSHIP_CONSOLE_AUTH: "false" }), false);
});

test("console auth can be explicitly opened for local demos", () => {
  const service = createConsoleAuthService({ env: { MOTHERSHIP_CONSOLE: "open" } });
  assert.equal(service.requireAuth(), false);
  assert.equal(service.isAuthenticated(cookieRequest()), true);
  assert.deepEqual(service.status(cookieRequest()), { enabled: false, authenticated: true, authMode: "disabled", user: null });
});

test("mothership start script uses the shared console auth enablement predicate", async () => {
  const source = await readFile(new URL("../scripts/start-mothership-server.mjs", import.meta.url), "utf8");
  assert.match(source, /isConsoleAuthEnabled/);
  assert.doesNotMatch(source, /function isConsoleEnabled/);
});

test("console auth requires username and a valid password hash when enabled", () => {
  assert.throws(
    () => createConsoleAuthService({ env: { MOTHERSHIP_CONSOLE: "required", MOTHERSHIP_CONSOLE_USERNAME: "aks_hemanth" } }),
    /MOTHERSHIP_CONSOLE_USERNAME and a valid MOTHERSHIP_CONSOLE_PASSWORD_HASH/i,
  );
  assert.throws(
    () => createConsoleAuthService({ env: { MOTHERSHIP_CONSOLE: "required", MOTHERSHIP_CONSOLE_USERNAME: "aks_hemanth", MOTHERSHIP_CONSOLE_PASSWORD_HASH: "bogus" } }),
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
  const result = service.login({ username: "aks_hemanth", password: "correct-horse-battery" }, { clientKey: "test" });

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.authenticated, true);
  assert.equal(result.payload.user.username, "aks_hemanth");
  assert.equal(result.payload.user.role, "operator");
  assert.match(result.setCookie, /mwb_mothership_console_session=/);
  assert.match(result.setCookie, /Max-Age=3600/);
  assert.match(result.setCookie, /HttpOnly/);
});

test("an issued session cookie authenticates subsequent requests", () => {
  const service = makeService();
  const result = service.login({ username: "aks_hemanth", password: "correct-horse-battery" }, { clientKey: "test" });
  const token = result.setCookie.match(/mwb_mothership_console_session=([^;]+)/)[1];
  const request = cookieRequest(`mwb_mothership_console_session=${token}`);

  assert.equal(service.isAuthenticated(request), true);
  assert.equal(service.status(request).authenticated, true);
  assert.equal(service.sessionUser(request).username, "aks_hemanth");
});

test("login rejects wrong password and does not issue a cookie", () => {
  const service = makeService();
  const result = service.login({ username: "aks_hemanth", password: "nope" }, { clientKey: "test" });

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
  const first = service.login({ username: "aks_hemanth", password: "bad" }, { clientKey: "throttled-client" });
  const second = service.login({ username: "aks_hemanth", password: "bad" }, { clientKey: "throttled-client" });
  const third = service.login({ username: "aks_hemanth", password: "correct-horse-battery" }, { clientKey: "throttled-client" });

  assert.equal(first.statusCode, 401);
  assert.equal(second.statusCode, 401);
  assert.equal(third.statusCode, 429);
  assert.match(third.payload.error, /too many login attempts/i);
});

test("login throttle expiry follows the injected clock", () => {
  let nowMs = FIXED_NOW_MS;
  const service = createConsoleAuthService({
    env: envWithAuth({
      MOTHERSHIP_CONSOLE_LOGIN_MAX_ATTEMPTS: "1",
      MOTHERSHIP_CONSOLE_LOGIN_WINDOW_SECONDS: "5",
    }),
    now: () => nowMs,
    tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
  });

  assert.equal(service.login({ username: "aks_hemanth", password: "bad" }, { clientKey: "clocked-client" }).statusCode, 401);
  assert.equal(service.login({ username: "aks_hemanth", password: "correct-horse-battery" }, { clientKey: "clocked-client" }).statusCode, 429);

  nowMs += 6_000;
  assert.equal(service.login({ username: "aks_hemanth", password: "correct-horse-battery" }, { clientKey: "clocked-client" }).statusCode, 200);
});

test("throttle key ignores X-Forwarded-For so spoofed headers cannot bypass limits", () => {
  const service = makeService({ env: envWithAuth({ MOTHERSHIP_CONSOLE_LOGIN_MAX_ATTEMPTS: "2", MOTHERSHIP_CONSOLE_LOGIN_WINDOW_SECONDS: "60" }) });
  const requests = [
    { headers: { "x-forwarded-for": "1.2.3.4" }, socket: { remoteAddress: "192.168.1.1" } },
    { headers: { "x-forwarded-for": "5.6.7.8" }, socket: { remoteAddress: "192.168.1.1" } },
    { headers: { "x-forwarded-for": "9.10.11.12" }, socket: { remoteAddress: "192.168.1.1" } },
  ];
  const first = service.login({ username: "aks_hemanth", password: "bad" }, { request: requests[0] });
  const second = service.login({ username: "aks_hemanth", password: "bad" }, { request: requests[1] });
  const third = service.login({ username: "aks_hemanth", password: "correct-horse-battery" }, { request: requests[2] });

  assert.equal(first.statusCode, 401);
  assert.equal(second.statusCode, 401);
  assert.equal(third.statusCode, 429, "third attempt from same remoteAddress should be throttled despite rotating XFF");
});

test("login always runs PBKDF2 regardless of username match (no timing oracle)", () => {
  const service = makeService();
  const wrongUser = service.login({ username: "totally-wrong", password: "x" }, { clientKey: "timing-1" });
  const wrongPass = service.login({ username: "aks_hemanth", password: "x" }, { clientKey: "timing-2" });

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
  const result = service.login({ username: "aks_hemanth", password: "correct-horse-battery" }, { clientKey: "test" });
  const token = result.setCookie.match(/mwb_mothership_console_session=([^;]+)/)[1];
  const request = cookieRequest(`mwb_mothership_console_session=${token}`);

  assert.equal(service.isAuthenticated(request), true);
  nowMs += 2 * 1000;
  assert.equal(service.isAuthenticated(request), false);
  assert.equal(service.status(request).authenticated, false);
});

test("logout clears the session and cookie", () => {
  const service = makeService();
  const loginResult = service.login({ username: "aks_hemanth", password: "correct-horse-battery" }, { clientKey: "test" });
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
  const result = service.login({ username: "aks_hemanth", password: "correct-horse-battery" }, { clientKey: "test" });
  assert.match(result.setCookie, /; Secure/);
  assert.equal(service.secureCookie, true);
});

test("email-code auth requires allowed emails and sender configuration", () => {
  assert.throws(
    () => createConsoleAuthService({ env: { MOTHERSHIP_CONSOLE: "required", MOTHERSHIP_CONSOLE_AUTH_MODE: "email_code" } }),
    /ALLOWED_EMAILS/i,
  );
  assert.throws(
    () => createConsoleAuthService({
      env: {
        MOTHERSHIP_CONSOLE: "required",
        MOTHERSHIP_CONSOLE_AUTH_MODE: "email_code",
        MOTHERSHIP_CONSOLE_ALLOWED_EMAILS: "aks@example.test",
      },
    }),
    /EMAIL_PROVIDER|EMAIL_API_KEY|RESEND/i,
  );
});

test("email-code auth sends a one-time code and authenticates as the email actor", async () => {
  const sent = [];
  const service = createConsoleAuthService({
    env: {
      MOTHERSHIP_CONSOLE: "required",
      MOTHERSHIP_CONSOLE_AUTH_MODE: "email_code",
      MOTHERSHIP_CONSOLE_ALLOWED_EMAILS: "aks@example.test,hemanth@example.test",
      MOTHERSHIP_CONSOLE_SESSION_TTL_SECONDS: "3600",
    },
    now: () => FIXED_NOW_MS,
    tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
    codeGenerator: () => "123456",
    emailSender: { sendConsoleCode: async (payload) => { sent.push(payload); } },
  });

  assert.equal(service.authMode, "email_code");
  assert.deepEqual(service.status(cookieRequest()), { enabled: true, authenticated: false, authMode: "email_code", user: null });

  const request = await service.requestCode({ email: "AKS@example.test" }, { clientKey: "email-code" });
  assert.equal(request.statusCode, 200);
  assert.match(request.payload.message, /If this email is allowed/i);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, "aks@example.test");
  assert.equal(sent[0].code, "123456");

  const verify = service.verifyCode({ email: "aks@example.test", code: "123456" }, { clientKey: "email-code" });
  assert.equal(verify.ok, true);
  assert.equal(verify.payload.user.username, "aks@example.test");
  assert.equal(verify.payload.user.role, "operator");
  assert.match(verify.setCookie, /mwb_mothership_console_session=/);

  const token = verify.setCookie.match(/mwb_mothership_console_session=([^;]+)/)[1];
  assert.equal(service.sessionUser(cookieRequest(`mwb_mothership_console_session=${token}`)).username, "aks@example.test");
});

test("email-code auth gives generic request responses for unknown emails", async () => {
  const sent = [];
  const service = createConsoleAuthService({
    env: {
      MOTHERSHIP_CONSOLE: "required",
      MOTHERSHIP_CONSOLE_AUTH_MODE: "email_code",
      MOTHERSHIP_CONSOLE_ALLOWED_EMAILS: "aks@example.test",
    },
    tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
    codeGenerator: () => "123456",
    emailSender: { sendConsoleCode: async (payload) => { sent.push(payload); } },
  });

  const request = await service.requestCode({ email: "unknown@example.test" }, { clientKey: "unknown" });
  assert.equal(request.statusCode, 200);
  assert.match(request.payload.message, /If this email is allowed/i);
  assert.equal(sent.length, 0);

  const verify = service.verifyCode({ email: "unknown@example.test", code: "123456" }, { clientKey: "unknown" });
  assert.equal(verify.statusCode, 401);
  assert.match(verify.payload.error, /Invalid or expired code/);
});

test("email-code auth returns the same generic response when email delivery fails", async () => {
  const errors = [];
  const service = createConsoleAuthService({
    env: {
      MOTHERSHIP_CONSOLE: "required",
      MOTHERSHIP_CONSOLE_AUTH_MODE: "email_code",
      MOTHERSHIP_CONSOLE_ALLOWED_EMAILS: "aks@example.test",
    },
    tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
    codeGenerator: () => "123456",
    emailSender: {
      sendConsoleCode: async () => {
        throw new Error("resend rejected");
      },
    },
    onEmailSendError: (error) => errors.push(error),
  });

  const request = await service.requestCode({ email: "aks@example.test" }, { clientKey: "send-failure" });

  assert.equal(request.statusCode, 200);
  assert.match(request.payload.message, /If this email is allowed/i);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /resend rejected/);
});

test("email-code auth does not consume the send window when delivery fails", async () => {
  const errors = [];
  let sendAttempts = 0;
  const service = createConsoleAuthService({
    env: {
      MOTHERSHIP_CONSOLE: "required",
      MOTHERSHIP_CONSOLE_AUTH_MODE: "email_code",
      MOTHERSHIP_CONSOLE_ALLOWED_EMAILS: "aks@example.test",
      MOTHERSHIP_CONSOLE_CODE_SEND_WINDOW_SECONDS: "60",
    },
    tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
    codeGenerator: () => "123456",
    emailSender: {
      sendConsoleCode: async () => {
        sendAttempts += 1;
        if (sendAttempts === 1) throw new Error("resend rejected");
      },
    },
    onEmailSendError: (error) => errors.push(error),
  });

  assert.equal((await service.requestCode({ email: "aks@example.test" }, { clientKey: "retry-send" })).statusCode, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);

  assert.equal((await service.requestCode({ email: "aks@example.test" }, { clientKey: "retry-send" })).statusCode, 200);
  assert.equal(sendAttempts, 2);
});

test("email-code auth rejects expired or reused codes", async () => {
  let nowMs = FIXED_NOW_MS;
  const service = createConsoleAuthService({
    env: {
      MOTHERSHIP_CONSOLE: "required",
      MOTHERSHIP_CONSOLE_AUTH_MODE: "email_code",
      MOTHERSHIP_CONSOLE_ALLOWED_EMAILS: "aks@example.test",
      MOTHERSHIP_CONSOLE_CODE_TTL_SECONDS: "1",
    },
    now: () => nowMs,
    tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
    codeGenerator: () => "123456",
    emailSender: { sendConsoleCode: async () => {} },
  });

  await service.requestCode({ email: "aks@example.test" }, { clientKey: "expired" });
  nowMs += 2000;
  assert.equal(service.verifyCode({ email: "aks@example.test", code: "123456" }, { clientKey: "expired" }).statusCode, 401);

  nowMs = FIXED_NOW_MS;
  await service.requestCode({ email: "aks@example.test" }, { clientKey: "reuse" });
  assert.equal(service.verifyCode({ email: "aks@example.test", code: "123456" }, { clientKey: "reuse" }).statusCode, 200);
  assert.equal(service.verifyCode({ email: "aks@example.test", code: "123456" }, { clientKey: "reuse" }).statusCode, 401);
});

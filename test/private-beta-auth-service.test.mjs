import assert from "node:assert/strict";
import test from "node:test";

import {
  createPrivateBetaAuthService,
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

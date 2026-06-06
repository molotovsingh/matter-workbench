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

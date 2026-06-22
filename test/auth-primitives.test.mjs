import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  clearCookie,
  hashPassword,
  hashSessionToken,
  parseCookies,
  parsePasswordHash,
  secureBufferEqual,
  secureEqual,
  serializeCookie,
  shouldUseSecureCookie,
  verifyPasswordHash,
} from "../shared/auth-primitives.mjs";

test("shared auth primitives cover password hashing, cookies, and timing-safe equality", () => {
  const hash = hashPassword("secret", { iterations: 1000, salt: "fixed-salt", hashBytes: 32 });
  assert.match(hash, /^pbkdf2-sha256\$1000\$/);
  assert.ok(parsePasswordHash(hash));
  assert.equal(verifyPasswordHash("secret", hash), true);
  assert.equal(verifyPasswordHash("wrong", hash), false);
  assert.equal(parsePasswordHash("pbkdf2-sha256$0$x$y"), null);

  const cookie = serializeCookie("sid", "a b", { maxAgeSeconds: 60, secure: true });
  assert.match(cookie, /sid=a%20b/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.deepEqual(parseCookies("sid=a%20b; other=value"), { sid: "a b", other: "value" });
  assert.match(clearCookie("sid", { secure: true }), /Max-Age=0/);

  assert.equal(hashSessionToken("token").length, 64);
  assert.equal(secureEqual("same", "same"), true);
  assert.equal(secureEqual("same", "different"), false);
  assert.equal(secureBufferEqual(Buffer.from("a"), Buffer.from("a")), true);
  assert.equal(secureBufferEqual(Buffer.from("a"), Buffer.from("bb")), false);

  assert.equal(shouldUseSecureCookie({ COOKIE_SECURE: "true" }, { explicitVar: "COOKIE_SECURE" }), true);
  assert.equal(shouldUseSecureCookie({ PUBLIC_URL: "https://example.test" }, { explicitVar: "COOKIE_SECURE", publicUrlVars: ["PUBLIC_URL"] }), true);
  assert.equal(shouldUseSecureCookie({ PUBLIC_URL: "http://example.test" }, { explicitVar: "COOKIE_SECURE", publicUrlVars: ["PUBLIC_URL"] }), false);
});

test("auth services import shared primitives instead of local crypto/cookie twins", async () => {
  const checks = [
    new URL("../mothership/console-auth.mjs", import.meta.url),
    new URL("../mothership/http.mjs", import.meta.url),
    new URL("../services/private-beta-auth-service.mjs", import.meta.url),
  ];
  for (const fileUrl of checks) {
    const source = await readFile(fileUrl, "utf8");
    assert.match(source, /shared\/auth-primitives\.mjs/);
    assert.doesNotMatch(source, /function parseCookies\(/);
    assert.doesNotMatch(source, /function secureEqual\(/);
    assert.doesNotMatch(source, /function secureBufferEqual\(/);
    assert.doesNotMatch(source, /function parsePasswordHash\(/);
    assert.doesNotMatch(source, /function hashSessionToken\(/);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMothershipConsoleCheckArgs,
  renderMothershipConsoleCheck,
  runMothershipConsoleCheck,
} from "../scripts/mothership-console-check.mjs";

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: { "content-type": "application/json" },
  });
}

function htmlResponse(html, init = {}) {
  return new Response(html, {
    status: init.status || 200,
    headers: { "content-type": "text/html" },
  });
}

test("mothership console check parser normalizes URL and require-auth", () => {
  assert.deepEqual(
    parseMothershipConsoleCheckArgs(["--base-url", "http://127.0.0.1:4192/", "--require-auth"], {}),
    { baseUrl: "http://127.0.0.1:4192", requireAuth: true },
  );
  assert.throws(() => parseMothershipConsoleCheckArgs(["--wat"], {}), /Unknown option/);
});

test("mothership console check passes for built loopback console with auth disabled warning", async () => {
  const seen = [];
  const report = await runMothershipConsoleCheck({
    baseUrl: "http://console.test",
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.endsWith("/health")) return jsonResponse({ status: "ready", database: "ready" });
      if (url.endsWith("/api/auth/status")) return jsonResponse({ enabled: false, authenticated: true, user: null });
      return htmlResponse('<!doctype html><title>Matter Workbench · Mothership Console</title><div id="root"></div>');
    },
  });

  assert.equal(report.passed, true);
  assert.equal(report.authEnabled, false);
  assert.match(report.warning, /auth is disabled/i);
  assert.deepEqual(seen, [
    "http://console.test/health",
    "http://console.test",
    "http://console.test/api/auth/status",
  ]);
});

test("mothership console check can require auth before public exposure", async () => {
  const report = await runMothershipConsoleCheck({
    baseUrl: "http://console.test",
    requireAuth: true,
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) return jsonResponse({ status: "ready", database: "ready" });
      if (url.endsWith("/api/auth/status")) return jsonResponse({ enabled: false, authenticated: true, user: null });
      return htmlResponse('<title>Matter Workbench · Mothership Console</title><div id="root"></div>');
    },
  });

  assert.equal(report.passed, false);
  assert.match(report.error, /auth is not enabled/i);
});

test("mothership console check renderer is operator-readable", () => {
  const text = renderMothershipConsoleCheck({
    passed: true,
    baseUrl: "http://127.0.0.1:4192",
    healthOk: true,
    healthStatus: "ready",
    healthDatabase: "ready",
    rootOk: true,
    rootBytes: 461,
    rootHasConsoleTitle: true,
    rootHasMount: true,
    authStatusOk: true,
    authEnabled: true,
    authAuthenticated: false,
    requireAuth: true,
  });

  assert.match(text, /Matter Workbench mothership console check/);
  assert.match(text, /passed: yes/);
  assert.match(text, /auth_enabled: yes/);
  assert.match(text, /require_auth: yes/);
});

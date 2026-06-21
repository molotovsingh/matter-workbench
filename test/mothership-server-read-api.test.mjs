import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { createMothershipServer } from "../mothership/server.mjs";
import { createConsoleAuthService, hashConsolePassword } from "../mothership/console-auth.mjs";

const OPERATOR_HASH = hashConsolePassword("operator-secret", { iterations: 1000 });
const FIXED_NOW = Date.parse("2026-06-20T12:00:00.000Z");

function authEnv(overrides = {}) {
  return {
    MOTHERSHIP_CONSOLE: "required",
    MOTHERSHIP_CONSOLE_USERNAME: "aks_hemanth",
    MOTHERSHIP_CONSOLE_PASSWORD_HASH: OPERATOR_HASH,
    MOTHERSHIP_CONSOLE_SESSION_TTL_SECONDS: "3600",
    ...overrides,
  };
}

function makeAuth(overrides = {}) {
  return createConsoleAuthService({
    env: authEnv(overrides.env || {}),
    now: () => FIXED_NOW,
    tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
  });
}

test("console read API requires an authenticated session", async () => {
  const app = await startServer({ store: createFakeStore(), auth: makeAuth() });
  try {
    const unauthenticated = await fetch(`${app.baseUrl}/api/installations`);
    assert.equal(unauthenticated.status, 401);

    const reportDenied = await fetch(`${app.baseUrl}/api/report`);
    assert.equal(reportDenied.status, 401);
  } finally {
    await app.close();
  }
});

test("console login then read installations and report round-trip", async () => {
  const store = createFakeStore();
  const app = await startServer({ store, auth: makeAuth() });
  try {
    const session = await login(app.baseUrl, "aks_hemanth", "operator-secret");
    assert.equal(session.response.status, 200);
    assert.equal(session.body.authenticated, true);
    const cookie = session.response.headers.get("set-cookie");

    const installations = await authedGet(app.baseUrl, "/api/installations?sinceDays=7", cookie);
    assert.equal(installations.response.status, 200);
    assert.equal(installations.body.sinceDays, 7);
    assert.equal(installations.body.installations.length, 1);
    assert.equal(installations.body.installations[0].installationId, "firm-beta-01");

    const report = await authedGet(app.baseUrl, "/api/report", cookie);
    assert.equal(report.response.status, 200);
    assert.equal(report.body.schema_version, "mothership-development-report/v1");
    assert.equal(report.body.summary.total, 1);

    const instReport = await authedGet(app.baseUrl, "/api/installations/firm-beta-01/report?sinceDays=30", cookie);
    assert.equal(instReport.response.status, 200);
    assert.equal(instReport.body.sinceDays, 30);
    assert.equal(store.calls.some((call) => call.type === "queryReport" && call.installationId === "firm-beta-01"), true);
  } finally {
    await app.close();
  }
});

test("console feedback status action wires to the store with operator actor", async () => {
  const store = createFakeStore();
  const app = await startServer({ store, auth: makeAuth() });
  try {
    const session = await login(app.baseUrl, "aks_hemanth", "operator-secret");
    const cookie = session.response.headers.get("set-cookie");

    const result = await authedPost(app.baseUrl, "/api/feedback/firm-beta-01/feedback_001/status", cookie, {
      status: "needs_evidence",
      note: "Need repro steps.",
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.action, "update_feedback_status");
    assert.equal(result.body.updated, true);
    assert.equal(result.body.status, "needs_evidence");

    const triageCall = store.calls.find((call) => call.type === "updateFeedbackStatus");
    assert.ok(triageCall);
    assert.equal(triageCall.installationId, "firm-beta-01");
    assert.equal(triageCall.feedbackId, "feedback_001");
    assert.equal(triageCall.status, "needs_evidence");
    assert.equal(triageCall.actor, "aks_hemanth");
  } finally {
    await app.close();
  }
});

test("report filter with an invalid severity returns 400 not 500", async () => {
  const store = createFakeStore();
  const app = await startServer({ store, auth: makeAuth() });
  try {
    const session = await login(app.baseUrl, "aks_hemanth", "operator-secret");
    const cookie = session.response.headers.get("set-cookie");

    const result = await authedGet(app.baseUrl, "/api/report?severity=bogus", cookie);
    assert.equal(result.response.status, 400);
    assert.match(result.body.error, /severity must be one of/i);
  } finally {
    await app.close();
  }
});

test("report filter with a valid severity returns 200", async () => {
  const store = createFakeStore();
  const app = await startServer({ store, auth: makeAuth() });
  try {
    const session = await login(app.baseUrl, "aks_hemanth", "operator-secret");
    const cookie = session.response.headers.get("set-cookie");

    const result = await authedGet(app.baseUrl, "/api/report?severity=error", cookie);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.schema_version, "mothership-development-report/v1");
  } finally {
    await app.close();
  }
});

test("console revoke installation action returns 404 when the store reports no change", async () => {
  const store = createFakeStore({ revokeReturned: false });
  const app = await startServer({ store, auth: makeAuth() });
  try {
    const session = await login(app.baseUrl, "aks_hemanth", "operator-secret");
    const cookie = session.response.headers.get("set-cookie");

    const result = await authedPost(app.baseUrl, "/api/installations/ghost-install/revoke", cookie, {});
    assert.equal(result.response.status, 404);
    assert.equal(result.body.revoked, false);
  } finally {
    await app.close();
  }
});

test("console logout clears the session and subsequent reads are unauthorized", async () => {
  const app = await startServer({ store: createFakeStore(), auth: makeAuth() });
  try {
    const session = await login(app.baseUrl, "aks_hemanth", "operator-secret");
    const cookie = session.response.headers.get("set-cookie");

    const logout = await fetch(`${app.baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(logout.status, 200);

    const denied = await fetch(`${app.baseUrl}/api/installations`, { headers: { Cookie: cookie } });
    assert.equal(denied.status, 401);
  } finally {
    await app.close();
  }
});

test("ingestion endpoints still work alongside the console API", async () => {
  const store = createFakeStore();
  const app = await startServer({ store, auth: makeAuth() });
  try {
    const response = await postJson(app.baseUrl, "/v1/feedback", validFeedbackPayload(), "ingest-token");
    assert.equal(response.response.status, 202);
    assert.equal(response.body.accepted, true);
    assert.equal(store.calls.some((call) => call.type === "ingestFeedback"), true);
  } finally {
    await app.close();
  }
});

test("api/health alias returns the database readiness", async () => {
  const app = await startServer({ store: createFakeStore(), auth: makeAuth() });
  try {
    const response = await fetch(`${app.baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "ready");
    assert.equal(body.database, "ready");
  } finally {
    await app.close();
  }
});

test("console status endpoint reports authenticated state", async () => {
  const app = await startServer({ store: createFakeStore(), auth: makeAuth() });
  try {
    const before = await fetch(`${app.baseUrl}/api/auth/status`);
    const beforeBody = await before.json();
    assert.equal(beforeBody.enabled, true);
    assert.equal(beforeBody.authenticated, false);

    const session = await login(app.baseUrl, "aks_hemanth", "operator-secret");
    const cookie = session.response.headers.get("set-cookie");
    const after = await fetch(`${app.baseUrl}/api/auth/status`, { headers: { Cookie: cookie } });
    const afterBody = await after.json();
    assert.equal(afterBody.authenticated, true);
    assert.equal(afterBody.user.username, "aks_hemanth");
  } finally {
    await app.close();
  }
});

test("login with the wrong password is rejected", async () => {
  const app = await startServer({ store: createFakeStore(), auth: makeAuth() });
  try {
    const result = await login(app.baseUrl, "aks_hemanth", "wrong-password");
    assert.equal(result.response.status, 401);
    assert.match(result.body.error, /invalid username or password/i);
  } finally {
    await app.close();
  }
});

test("disabled console auth reports authenticated=true and allows reads without a session", async () => {
  const app = await startServer({ store: createFakeStore(), auth: null });
  try {
    const status = await fetch(`${app.baseUrl}/api/auth/status`);
    const statusBody = await status.json();
    assert.equal(statusBody.enabled, false);
    assert.equal(statusBody.authenticated, true);

    const installations = await fetch(`${app.baseUrl}/api/installations`);
    assert.equal(installations.status, 200);
    const instBody = await installations.json();
    assert.equal(instBody.installations.length, 1);
  } finally {
    await app.close();
  }
});

test("server serves the built console SPA index when a console asset root is configured", async () => {
  const tmpRoot = path.join(os.tmpdir(), `console-test-${Date.now()}-${process.pid}`);
  fs.mkdirSync(path.join(tmpRoot, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, "index.html"),
    '<!DOCTYPE html><html><head><title>Matter Workbench · Mothership Console</title></head><body><div id="root"></div></body></html>',
  );
  fs.writeFileSync(path.join(tmpRoot, "assets", "app.js"), "console.log('test');");

  const store = createFakeStore();
  const app = await startServer({ store, auth: makeAuth(), options: { consoleAssetRoot: tmpRoot } });
  try {
    const root = await fetch(`${app.baseUrl}/`);
    assert.equal(root.status, 200);
    const html = await root.text();
    assert.match(html, /Mothership Console/);
    assert.match(html, /id="root"/);

    const asset = await fetch(`${app.baseUrl}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");

    const unknownApi = await fetch(`${app.baseUrl}/api/unknown-endpoint`);
    assert.equal(unknownApi.status, 401);

    const clientRoute = await fetch(`${app.baseUrl}/fleet`);
    assert.equal(clientRoute.status, 200);
    const routeHtml = await clientRoute.text();
    assert.match(routeHtml, /id="root"/);
  } finally {
    await app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

async function startServer({ store, auth, options = {} }) {
  const app = createMothershipServer({ store, consoleAuth: auth, ...options });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, baseUrl, close: () => new Promise((resolve) => app.server.close(resolve)) };
}

function createFakeStore({ revokeReturned = true } = {}) {
  const calls = [];
  return {
    calls,
    health: async () => { calls.push({ type: "health" }); return { database: "ready" }; },
    authorizeIngestion: async ({ rawToken, installationId }) => {
      calls.push({ type: "authorize", rawToken, installationId });
      return { installationId };
    },
    ingestFeedback: async ({ installationId, feedback }) => {
      calls.push({ type: "ingestFeedback", installationId, feedback });
      return { inserted: true };
    },
    ingestSignal: async ({ installationId, signal }) => {
      calls.push({ type: "ingestSignal", installationId, signal });
      return { inserted: true };
    },
    ingestMetricSnapshot: async ({ installationId, metric }) => {
      calls.push({ type: "ingestMetric", installationId, metric });
      return { inserted: true };
    },
    ingestHeartbeat: async ({ installationId, heartbeat }) => {
      calls.push({ type: "ingestHeartbeat", installationId, heartbeat });
      return { inserted: true };
    },
    listInstallations: async ({ sinceDays } = {}) => {
      calls.push({ type: "listInstallations", sinceDays });
      return {
        sinceDays,
        installations: [{
          installationId: "firm-beta-01",
          label: "Firm beta one",
          status: "active",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
          revokedAt: null,
          latestHeartbeatReceivedAt: "2026-06-20T09:00:00.000Z",
          recentSignalCount: 3,
          recentFeedbackCount: 2,
        }],
      };
    },
    queryReport: async ({ sinceDays, installationId } = {}) => {
      calls.push({ type: "queryReport", sinceDays, installationId });
      return {
        sinceDays,
        feedback: [{
          installation_id: "firm-beta-01",
          feedback_id: "feedback_001",
          classification: "bug",
          status: "new",
          matter_name: "Example Matter",
          occurred_at: "2026-06-10T10:00:00.000Z",
          received_at: "2026-06-10T10:00:01.000Z",
          payload: { id: "feedback_001", classification: "bug", status: "new", createdAt: "2026-06-10T10:00:00.000Z", context: {} },
        }],
        signals: [],
        metrics: [],
        heartbeats: [],
      };
    },
    updateFeedbackStatus: async ({ installationId, feedbackId, status, actor, note }) => {
      calls.push({ type: "updateFeedbackStatus", installationId, feedbackId, status, actor, note });
      return { updated: true, status, updatedAt: "2026-06-20T12:00:00.000Z", actor, note };
    },
    revokeInstallation: async ({ installationId }) => {
      calls.push({ type: "revokeInstallation", installationId });
      return revokeReturned;
    },
  };
}

function validFeedbackPayload() {
  return {
    schema_version: "private-beta-feedback-sync/v1",
    installId: "firm-beta-01",
    feedback: {
      schema_version: "private-beta-feedback/v1",
      id: "feedback_001",
      choice: "confused",
      classification: "confusing_ux",
      status: "new",
      tryingToDo: "Understand the matter home",
      createdAt: "2026-06-10T10:00:00.000Z",
      context: {},
    },
  };
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { response, body: await response.json() };
}

async function authedGet(baseUrl, pathname, cookie) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { Cookie: cookie } });
  return { response, body: await response.json() };
}

async function authedPost(baseUrl, pathname, cookie, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function postJson(baseUrl, pathname, body, token) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("console email-code login endpoints authenticate allowed emails", async () => {
  const sent = [];
  const auth = createConsoleAuthService({
    env: {
      MOTHERSHIP_CONSOLE: "required",
      MOTHERSHIP_CONSOLE_AUTH_MODE: "email_code",
      MOTHERSHIP_CONSOLE_ALLOWED_EMAILS: "aks@example.test,hemanth@example.test",
      MOTHERSHIP_CONSOLE_SESSION_TTL_SECONDS: "3600",
    },
    now: () => FIXED_NOW,
    tokenBytes: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
    codeGenerator: () => "222333",
    emailSender: { sendConsoleCode: async (payload) => { sent.push(payload); } },
  });
  const app = await startServer({ store: createFakeStore(), auth });
  try {
    const status = await fetch(`${app.baseUrl}/api/auth/status`);
    const statusBody = await status.json();
    assert.equal(statusBody.authMode, "email_code");
    assert.equal(statusBody.authenticated, false);

    const requestCode = await postJson(app.baseUrl, "/api/auth/request-code", { email: "AKS@example.test" });
    assert.equal(requestCode.response.status, 200);
    assert.match(requestCode.body.message, /If this email is allowed/i);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, "aks@example.test");

    const verify = await postJson(app.baseUrl, "/api/auth/verify-code", { email: "aks@example.test", code: "222333" });
    assert.equal(verify.response.status, 200);
    assert.equal(verify.body.user.username, "aks@example.test");
    const cookie = verify.response.headers.get("set-cookie");

    const installations = await authedGet(app.baseUrl, "/api/installations", cookie);
    assert.equal(installations.response.status, 200);
  } finally {
    await app.close();
  }
});

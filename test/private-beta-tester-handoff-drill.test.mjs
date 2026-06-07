import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parsePrivateBetaTesterHandoffDrillArgs,
  runPrivateBetaTesterHandoffDrill,
} from "../scripts/private-beta-tester-handoff-drill.mjs";
import {
  readPrivateBetaUsersFile,
  verifyPrivateBetaPassword,
} from "../services/private-beta-auth-service.mjs";

test("private beta tester handoff drill verifies login, feedback, signals, and restores state", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-handoff-drill-"));
  const usersFile = path.join(tmp, "users.json");
  const feedbackPath = path.join(tmp, "feedback.json");
  const outDir = path.join(tmp, "evidence");
  const originalUsers = {
    schemaVersion: "private-beta-users/v1",
    users: [],
  };
  const originalFeedback = {
    schema_version: "private-beta-feedback-ledger/v1",
    feedback: [],
  };
  await writeFile(usersFile, `${JSON.stringify(originalUsers, null, 2)}\n`, "utf8");
  await writeFile(feedbackPath, `${JSON.stringify(originalFeedback, null, 2)}\n`, "utf8");

  const server = await startDrillServer({ usersFile, feedbackPath });
  try {
    const result = await runPrivateBetaTesterHandoffDrill({
      baseUrl: server.baseUrl,
      usersFile,
      feedbackPath,
      outDir,
      timestamp: "2026-06-07T17:00:00.000Z",
      username: "codex-test-handoff",
      password: "temporary-password",
    });

    assert.equal(result.schemaVersion, "private-beta-tester-handoff-drill/v1");
    assert.equal(result.success, true);
    assert.equal(result.checks.login.ok, true);
    assert.equal(result.checks.authStatus.ok, true);
    assert.equal(result.checks.rootReactEntry.ok, true);
    assert.equal(result.checks.mattersList.count, 2);
    assert.equal(result.checks.feedbackCreated.ok, true);
    assert.equal(result.checks.feedbackListed.ok, true);
    assert.equal(result.checks.feedbackSyncEndpoint.ok, true);
    assert.equal(result.checks.signalEndpoint.ok, true);
    assert.equal(result.checks.tempSessionInvalidated.ok, true);
    assert.equal(result.checks.tempTesterRemoved.ok, true);
    assert.equal(result.cleanup.usersFileRestored, true);
    assert.equal(result.cleanup.feedbackLedgerRestored, true);
    assert.equal(existsSync(result.files.json), true);
    assert.equal(existsSync(result.files.markdown), true);

    const usersAfter = await readFile(usersFile, "utf8");
    const feedbackAfter = await readFile(feedbackPath, "utf8");
    assert.equal(usersAfter, `${JSON.stringify(originalUsers, null, 2)}\n`);
    assert.equal(feedbackAfter, `${JSON.stringify(originalFeedback, null, 2)}\n`);

    const evidence = await readFile(result.files.json, "utf8");
    assert.doesNotMatch(evidence, /temporary-password/);
    assert.doesNotMatch(evidence, /mwb_private_beta_session/);

    const rendered = await readFile(result.files.markdown, "utf8");
    assert.match(rendered, /Private Beta Tester Handoff Drill/);
    assert.match(rendered, /Temp tester removed: true/);
  } finally {
    await server.close();
  }
});

test("private beta tester handoff drill restores state when a later check fails", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-handoff-drill-fail-"));
  const usersFile = path.join(tmp, "users.json");
  const feedbackPath = path.join(tmp, "feedback.json");
  await writeFile(usersFile, `${JSON.stringify({ schemaVersion: "private-beta-users/v1", users: [] }, null, 2)}\n`, "utf8");
  await writeFile(feedbackPath, `${JSON.stringify({ schema_version: "private-beta-feedback-ledger/v1", feedback: [] }, null, 2)}\n`, "utf8");

  const server = await startDrillServer({ usersFile, feedbackPath, failMatters: true });
  try {
    await assert.rejects(
      () => runPrivateBetaTesterHandoffDrill({
        baseUrl: server.baseUrl,
        usersFile,
        feedbackPath,
        outDir: path.join(tmp, "evidence"),
        timestamp: "2026-06-07T17:00:00.000Z",
        username: "codex-test-handoff",
        password: "temporary-password",
      }),
      /GET \/api\/matters failed: 500/,
    );

    const usersAfter = JSON.parse(await readFile(usersFile, "utf8"));
    const feedbackAfter = JSON.parse(await readFile(feedbackPath, "utf8"));
    assert.deepEqual(usersAfter.users, []);
    assert.deepEqual(feedbackAfter.feedback, []);
  } finally {
    await server.close();
  }
});

test("private beta tester handoff drill parser reads env defaults and CLI overrides", () => {
  assert.deepEqual(
    parsePrivateBetaTesterHandoffDrillArgs([
      "--base-url",
      "https://beta.example.test/",
      "--users-file",
      "/secure/users.json",
      "--feedback-ledger",
      "/secure/feedback.json",
      "--out-dir",
      "/tmp/handoff",
      "--timestamp",
      "2026-06-07T17:00:00.000Z",
      "--username",
      "tester-one",
      "--json",
    ], {
      MWB_PRIVATE_BETA_PUBLIC_URL: "https://ignored.example.test",
      MWB_PRIVATE_BETA_USERS_FILE: "/ignored/users.json",
      MWB_PRIVATE_BETA_FEEDBACK_PATH: "/ignored/feedback.json",
    }),
    {
      baseUrl: "https://beta.example.test",
      usersFile: "/secure/users.json",
      feedbackPath: "/secure/feedback.json",
      outDir: "/tmp/handoff",
      timestamp: "2026-06-07T17:00:00.000Z",
      username: "tester-one",
      password: "",
      json: true,
    },
  );
});

test("package and docs expose the tester handoff drill", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["private-beta:tester-handoff-drill"], "node scripts/private-beta-tester-handoff-drill.mjs");

  const operatorChecklist = await readFile(new URL("../docs/beta-operator-checklist.md", import.meta.url), "utf8");
  assert.match(operatorChecklist, /private-beta:tester-handoff-drill/);

  const deploymentDoc = await readFile(new URL("../docs/private-beta-codex-deployment.md", import.meta.url), "utf8");
  assert.match(deploymentDoc, /private-beta:tester-handoff-drill/);
});

async function startDrillServer({ usersFile, feedbackPath, failMatters = false }) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readJsonBody(request);
        const users = readPrivateBetaUsersFile(usersFile);
        const account = users.find((item) => item.username === body.username);
        if (!account || account.disabled || !verifyPrivateBetaPassword(body.password, account.passwordHash)) {
          sendJson(response, 401, { error: "Invalid username or password" });
          return;
        }
        response.setHeader("Set-Cookie", `mwb_private_beta_session=session-${account.username}; Path=/; HttpOnly; SameSite=Strict`);
        sendJson(response, 200, {
          enabled: true,
          authenticated: true,
          user: { username: account.username, role: account.role },
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/auth/status") {
        const username = sessionUsername(request);
        const users = readPrivateBetaUsersFile(usersFile);
        const account = users.find((item) => item.username === username);
        sendJson(response, 200, {
          enabled: true,
          authenticated: Boolean(account && !account.disabled),
          user: account && !account.disabled ? { username, role: "tester" } : null,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<!doctype html><title>Matter Workbench</title><div id=\"root\">Matter Workbench</div>");
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/matters") {
        if (failMatters) {
          sendJson(response, 500, { error: "matter list failed" });
          return;
        }
        sendJson(response, 200, { matters: [{ name: "Matter One" }, { name: "Matter Two" }] });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/private-beta/feedback") {
        const body = await readJsonBody(request);
        const store = JSON.parse(await readFile(feedbackPath, "utf8"));
        const feedback = {
          schema_version: "private-beta-feedback/v1",
          id: "feedback_drill_001",
          choice: body.choice,
          classification: "confusing_ux",
          status: "new",
          tryingToDo: body.tryingToDo,
          happenedInstead: body.happenedInstead,
          context: body.context || {},
          sync: { status: "not_configured", attempts: 0 },
        };
        store.feedback.push(feedback);
        await writeFile(feedbackPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
        sendJson(response, 201, { feedback });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/private-beta/feedback") {
        sendJson(response, 200, JSON.parse(await readFile(feedbackPath, "utf8")));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/private-beta/feedback/sync") {
        sendJson(response, 200, {
          schema_version: "private-beta-feedback-sync-result/v1",
          attempted: 0,
          sent: 0,
          queued: 0,
          failed: 0,
          skipped: 0,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/private-beta/signals") {
        sendJson(response, 200, { schema_version: "private-beta-signal-ledger/v1", signals: [] });
        return;
      }
      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, 500, { error: error?.message || "server error" });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sessionUsername(request) {
  const cookie = String(request.headers.cookie || "");
  const match = cookie.match(/mwb_private_beta_session=session-([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";
import { hashPrivateBetaPassword } from "../services/private-beta-auth-service.mjs";
import { currentRequestContext } from "../services/request-context.mjs";

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

test("private beta feedback records the authenticated sender in context", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-feedback-auth-context-"));
  const usersFile = path.join(tmp, "users.json");
  await writePrivateBetaUsersFile(usersFile, [
    {
      username: "aksingh",
      displayName: "AK Singh",
      role: "superuser",
      passwordHash: hashPrivateBetaPassword("super-secret", { salt: "route-feedback-superuser", iterations: 1_000 }),
    },
    {
      username: "shivangi@lawzeus.com",
      displayName: "Shivangi",
      role: "tester",
      passwordHash: hashPrivateBetaPassword("tester-secret", { salt: "route-feedback-sender", iterations: 1_000 }),
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
    const cookie = await loginCookie(baseUrl, "shivangi@lawzeus.com", "tester-secret");
    const created = await postJson(baseUrl, "/api/private-beta/feedback", {
      choice: "confused",
      tryingToDo: "Understand whether List of Dates runs automatically",
      happenedInstead: "I could not tell whether I needed to run a skill.",
      context: { screen: "home", route: "/" },
    }, cookie);

    assert.equal(created.feedback.context.username, "shivangi@lawzeus.com");
    assert.equal(created.feedback.context.userRole, "tester");
    assert.equal(created.feedback.context.displayName, "Shivangi");

    const superCookie = await loginCookie(baseUrl, "aksingh", "super-secret");
    const listed = await getJson(baseUrl, "/api/private-beta/feedback?limit=10", superCookie);
    assert.equal(listed.feedback[0].context.username, "shivangi@lawzeus.com");
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

test("private beta runtime DB matters and active matter state are scoped per login", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-runtime-isolation-"));
  const usersFile = path.join(tmp, "users.json");
  await writePrivateBetaUsersFile(usersFile, [
    {
      username: "aks",
      role: "superuser",
      passwordHash: hashPrivateBetaPassword("aks-secret", { salt: "route-aks", iterations: 1_000 }),
    },
    {
      username: "shivangi@lawzeus.com",
      role: "tester",
      passwordHash: hashPrivateBetaPassword("shivangi-secret", { salt: "route-shivangi", iterations: 1_000 }),
    },
  ]);
  const mattersByUser = new Map([
    ["aks", [{ id: "11111111-1111-4111-8111-111111111111", name: "AKS Matter", matterName: "AKS Matter" }]],
    ["shivangi@lawzeus.com", [{ id: "22222222-2222-4222-8222-222222222222", name: "Shivangi Matter", matterName: "Shivangi Matter" }]],
  ]);
  const runtimeMatterIndex = {
    enabled: true,
    storageMode: "postgres",
    async listMatterFolders() {
      return mattersByUser.get(currentRequestContext().user?.username || "") || [];
    },
    async findMatterFolder(name) {
      return (mattersByUser.get(currentRequestContext().user?.username || "") || [])
        .find((matter) => matter.name === name || matter.matterName === name) || null;
    },
  };
  const capturedJobLedgers = [];
  let feedbackSyncCalled = false;
  let signalSyncCalled = false;
  const app = await createTestApp({
    env: {
      MWB_PRIVATE_BETA_USERNAME: "",
      MWB_PRIVATE_BETA_PASSWORD: "",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
    runtimeMatterIndex,
    configurableSkillRunsService: {
      async listRuns() {
        return {
          schema_version: "configurable-skill-runs/v1",
          runs: [
            { id: "run_aks", matterName: "AKS Matter", matterFolder: "AKS Matter", status: "succeeded" },
            { id: "run_shivangi", matterName: "Shivangi Matter", matterFolder: "Shivangi Matter", status: "succeeded" },
          ],
        };
      },
    },
    jobStatusService: {
      async listJobs() {
        return {
          schema_version: "job-status-ledger/v1",
          jobs: [
            { id: "job_aks", matterName: "AKS Matter", status: "failed", kind: "extract" },
            { id: "job_shivangi", matterName: "Shivangi Matter", status: "failed", kind: "extract" },
          ],
        };
      },
    },
    privateBetaFeedbackService: {
      async listFeedback() {
        return {
          schema_version: "private-beta-feedback-ledger/v1",
          feedback: [
            { id: "feedback_aks", context: { activeMatterName: "AKS Matter" } },
            { id: "feedback_shivangi", context: { activeMatterName: "Shivangi Matter" } },
          ],
        };
      },
      async createFeedback(input) {
        return { id: "feedback_new", ...input };
      },
      async syncQueuedFeedback() {
        feedbackSyncCalled = true;
        return { schema_version: "private-beta-feedback-sync-result/v1", attempted: 1, sent: 1, queued: 0, failed: 0, skipped: 0 };
      },
    },
    privateBetaSignalService: {
      async captureJobSignals(ledger) {
        capturedJobLedgers.push(ledger);
        return { schema_version: "private-beta-signal-capture-result/v1", captured: 0, sent: 0, queued: 0, skipped: 0, signals: [] };
      },
      async listSignals() {
        return {
          schema_version: "private-beta-signal-ledger/v1",
          signals: [
            { id: "signal_aks", matterName: "AKS Matter" },
            { id: "signal_shivangi", matterName: "Shivangi Matter" },
          ],
        };
      },
      async syncQueuedSignals() {
        signalSyncCalled = true;
        return { schema_version: "private-beta-signal-sync-result/v1", attempted: 1, sent: 1, queued: 0, failed: 0, skipped: 0 };
      },
    },
    runtimeDbStorageService: {
      enabled: true,
      async readWorkspace(matter) {
        return { folderName: matter.name, tree: { name: matter.name, path: "", children: [] }, files: [] };
      },
      async checkUploadedFileOverlap() {
        return {
          warnings: [
            { matterName: "AKS Matter", overlapCount: 1, totalIncoming: 1, matterTotalFiles: 2, overlapPercent: 100 },
            { matterName: "Shivangi Matter", overlapCount: 1, totalIncoming: 1, matterTotalFiles: 2, overlapPercent: 100 },
          ],
        };
      },
    },
  });
  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const aksCookie = await loginCookie(baseUrl, "aks", "aks-secret");
    const shivangiCookie = await loginCookie(baseUrl, "shivangi@lawzeus.com", "shivangi-secret");

    const aksMatters = await getJson(baseUrl, "/api/matters", aksCookie);
    assert.deepEqual(aksMatters.matters.map((matter) => matter.name), ["AKS Matter"]);

    const shivangiMatters = await getJson(baseUrl, "/api/matters", shivangiCookie);
    assert.deepEqual(shivangiMatters.matters.map((matter) => matter.name), ["Shivangi Matter"]);

    const forbiddenSwitch = await fetch(`${baseUrl}/api/switch-matter`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: shivangiCookie },
      body: JSON.stringify({ name: "AKS Matter" }),
    });
    assert.equal(forbiddenSwitch.status, 404);

    await postJson(baseUrl, "/api/switch-matter", { name: "AKS Matter" }, aksCookie);
    await postJson(baseUrl, "/api/switch-matter", { name: "Shivangi Matter" }, shivangiCookie);

    const aksConfig = await getJson(baseUrl, "/api/config", aksCookie);
    const shivangiConfig = await getJson(baseUrl, "/api/config", shivangiCookie);
    assert.equal(aksConfig.activeMatterName, "AKS Matter");
    assert.equal(shivangiConfig.activeMatterName, "Shivangi Matter");

    const shivangiJobs = await getJson(baseUrl, "/api/jobs?limit=10", shivangiCookie);
    assert.deepEqual(shivangiJobs.jobs.map((job) => job.id), ["job_shivangi"]);
    assert.equal(capturedJobLedgers.at(-1).jobs.length, 1);
    assert.equal(capturedJobLedgers.at(-1).jobs[0].matterName, "Shivangi Matter");

    const shivangiRuns = await getJson(baseUrl, "/api/configurable-skills/runs?limit=10", shivangiCookie);
    assert.deepEqual(shivangiRuns.runs.map((run) => run.id), ["run_shivangi"]);

    const shivangiFeedback = await getJson(baseUrl, "/api/private-beta/feedback?limit=10", shivangiCookie);
    assert.deepEqual(shivangiFeedback.feedback.map((item) => item.id), ["feedback_shivangi"]);

    const shivangiOverlap = await postJson(baseUrl, "/api/matters/check-overlap", {
      hashes: ["a".repeat(64)],
    }, shivangiCookie);
    assert.deepEqual(shivangiOverlap.warnings.map((warning) => warning.matterName), ["Shivangi Matter"]);

    const shivangiSignals = await getJson(baseUrl, "/api/private-beta/signals?limit=10", shivangiCookie);
    assert.deepEqual(shivangiSignals.signals, []);
    await postJson(baseUrl, "/api/private-beta/signals/sync", {}, shivangiCookie);
    await postJson(baseUrl, "/api/private-beta/feedback/sync", {}, shivangiCookie);
    assert.equal(signalSyncCalled, false);
    assert.equal(feedbackSyncCalled, false);

    const aksSignals = await getJson(baseUrl, "/api/private-beta/signals?limit=10", aksCookie);
    assert.deepEqual(aksSignals.signals.map((signal) => signal.id), ["signal_aks", "signal_shivangi"]);
    await postJson(baseUrl, "/api/private-beta/signals/sync", {}, aksCookie);
    await postJson(baseUrl, "/api/private-beta/feedback/sync", {}, aksCookie);
    assert.equal(signalSyncCalled, true);
    assert.equal(feedbackSyncCalled, true);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});


async function createTestApp({ env = {}, ...options } = {}) {
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
    runtimeMatterIndex: {
      enabled: true,
      listMatterFolders: async () => [],
      findMatterFolder: async () => null,
    },
    ...options,
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

async function getJson(baseUrl, pathname, cookie) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(baseUrl, pathname, body, cookie) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function writePrivateBetaUsersFile(usersFile, users) {
  await writeFile(
    usersFile,
    `${JSON.stringify({ schemaVersion: "private-beta-users/v1", users }, null, 2)}\n`,
    "utf8",
  );
}

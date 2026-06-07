import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

async function postJson(baseUrl, pathName, body = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

test("private beta feedback API records and lists safe feedback packets", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-api-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Feedback Matter");
  await mkdir(appDir, { recursive: true });
  await mkdir(matterRoot, { recursive: true });

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    privateBetaFeedbackPath: path.join(tmp, "feedback-ledger.json"),
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    await postJson(baseUrl, "/api/switch-matter", { name: "Feedback Matter" });

    const created = await postJson(baseUrl, "/api/private-beta/feedback", {
      choice: "did_not_work",
      tryingToDo: "Open the List of Dates",
      happenedInstead: "The button did nothing and token=sk-feedback-secret appeared",
      context: {
        screen: "activity",
        route: "/activity",
        recentActivity: ["opened Activity", "OPENAI_API_KEY=sk-hidden"],
      },
    });

    assert.equal(created.feedback.choice, "did_not_work");
    assert.equal(created.feedback.classification, "bug");
    assert.equal(created.feedback.context.activeMatterName, "Feedback Matter");
    assert.match(created.feedback.happenedInstead, /\[redacted-secret\]/);
    assert.doesNotMatch(JSON.stringify(created), /sk-feedback-secret|sk-hidden/);

    const listed = await getJson(baseUrl, "/api/private-beta/feedback");
    assert.equal(listed.schema_version, "private-beta-feedback-ledger/v1");
    assert.equal(listed.feedback.length, 1);
    assert.equal(listed.feedback[0].id, created.feedback.id);
  } finally {
    app.server.close();
  }
});

test("private beta feedback API exposes an operator retry route for queued sync", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-api-sync-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });
  let syncCalled = false;

  const app = await createWorkbenchServer({
    appDir,
    host: "127.0.0.1",
    port: 0,
    privateBetaFeedbackService: {
      listFeedback: async () => ({ schema_version: "private-beta-feedback-ledger/v1", feedback: [] }),
      createFeedback: async () => ({ id: "feedback_stub", sync: { status: "queued" } }),
      syncQueuedFeedback: async () => {
        syncCalled = true;
        return {
          schema_version: "private-beta-feedback-sync-result/v1",
          attempted: 1,
          sent: 1,
          queued: 0,
          failed: 0,
          skipped: 0,
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const result = await postJson(baseUrl, "/api/private-beta/feedback/sync", {});
    assert.equal(syncCalled, true);
    assert.equal(result.schema_version, "private-beta-feedback-sync-result/v1");
    assert.equal(result.sent, 1);
  } finally {
    app.server.close();
  }
});

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
  return { payload, response };
}

async function postJson(baseUrl, pathName, body = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { payload, response };
}

test("private beta observability correlates feedback with trace-linked failed jobs", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-observability-api-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Trace Matter");
  await mkdir(appDir, { recursive: true });
  await mkdir(matterRoot, { recursive: true });

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    jobStatusPath: path.join(tmp, "job-status-ledger.json"),
    privateBetaFeedbackPath: path.join(tmp, "feedback-ledger.json"),
    privateBetaSignalPath: path.join(tmp, "signals-ledger.json"),
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const failed = await postJson(baseUrl, "/api/matter-init", { matterName: "Trace Matter", dryRun: false });
    assert.equal(failed.response.ok, false);
    const traceId = failed.response.headers.get("x-mwb-trace-id");
    assert.match(traceId, /^trace_[a-zA-Z0-9_-]+$/);

    const feedback = await postJson(baseUrl, "/api/private-beta/feedback", {
      choice: "did_not_work",
      tryingToDo: "Create the Trace Matter",
      happenedInstead: "It failed during setup.",
      context: { activeMatterName: "Trace Matter", traceId },
    });
    assert.equal(feedback.response.ok, true);
    assert.equal(feedback.payload.feedback.context.traceId, traceId);

    const jobs = await getJson(baseUrl, "/api/jobs?status=failed&limit=5");
    assert.equal(jobs.payload.jobs.length, 1);
    assert.equal(jobs.payload.jobs[0].traceId, traceId);
    assert.equal(jobs.payload.jobs[0].failureClass, "user_action_needed");

    const observability = await getJson(baseUrl, "/api/private-beta/observability?limit=10");
    assert.equal(observability.payload.schema_version, "private-beta-observability/v1");
    assert.equal(observability.payload.summary.failedJobs, 1);
    assert.equal(observability.payload.feedbackEvidence.length, 1);
    assert.equal(observability.payload.feedbackEvidence[0].feedback.id, feedback.payload.feedback.id);
    assert.equal(observability.payload.feedbackEvidence[0].relatedJobs.length, 1);
    assert.equal(observability.payload.feedbackEvidence[0].relatedJobs[0].traceId, traceId);
    assert.ok(observability.payload.topProblems.some((problem) => problem.kind === "job_failed"));
  } finally {
    app.server.close();
  }
});

test("private beta observability hides operator evidence from scoped beta users", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-observability-scoped-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });

  const app = await createWorkbenchServer({
    appDir,
    host: "127.0.0.1",
    port: 0,
    privateBetaAuthService: {
      requireAuth: () => true,
      status: () => ({ enabled: true, authenticated: true, user: { username: "tester@example.test", role: "tester" } }),
      isAuthenticated: () => true,
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const response = await fetch(`${baseUrl}/api/private-beta/observability`);
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.match(payload.error, /superuser/i);
  } finally {
    app.server.close();
  }
});

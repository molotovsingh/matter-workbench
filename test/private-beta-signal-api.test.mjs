import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
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

test("private beta signal API exposes ledger and operator retry route", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-signal-api-retry-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });
  let syncCalled = false;

  const app = await createWorkbenchServer({
    appDir,
    host: "127.0.0.1",
    port: 0,
    privateBetaSignalService: {
      listSignals: async () => ({ schema_version: "private-beta-signal-ledger/v1", signals: [] }),
      captureJobSignals: async () => ({ schema_version: "private-beta-signal-capture-result/v1", captured: 0, sent: 0, queued: 0, skipped: 0, signals: [] }),
      syncQueuedSignals: async () => {
        syncCalled = true;
        return {
          schema_version: "private-beta-signal-sync-result/v1",
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
    const listed = await getJson(baseUrl, "/api/private-beta/signals?limit=5");
    assert.equal(listed.schema_version, "private-beta-signal-ledger/v1");
    assert.deepEqual(listed.signals, []);

    const retried = await postJson(baseUrl, "/api/private-beta/signals/sync", {});
    assert.equal(syncCalled, true);
    assert.equal(retried.schema_version, "private-beta-signal-sync-result/v1");
    assert.equal(retried.sent, 1);
  } finally {
    app.server.close();
  }
});

test("private beta signal API auto-captures failed jobs when jobs monitor is read", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-signal-api-jobs-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });
  const captured = [];

  const app = await createWorkbenchServer({
    appDir,
    host: "127.0.0.1",
    port: 0,
    jobStatusService: {
      listJobs: async () => ({
        schema_version: "job-status-ledger/v1",
        jobs: [{
          id: "job_failed",
          kind: "skill-run",
          label: "Run The Story",
          status: "failed",
          matterName: "Signal Matter",
          errorMessage: "OPENAI_API_KEY=sk-hidden broke",
        }],
      }),
    },
    privateBetaSignalService: {
      listSignals: async () => ({ schema_version: "private-beta-signal-ledger/v1", signals: [] }),
      captureJobSignals: async (ledger) => {
        captured.push(ledger);
        return { schema_version: "private-beta-signal-capture-result/v1", captured: 1, sent: 0, queued: 1, skipped: 0, signals: [] };
      },
      syncQueuedSignals: async () => ({ schema_version: "private-beta-signal-sync-result/v1", attempted: 0, sent: 0, queued: 0, failed: 0, skipped: 0 }),
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const jobs = await getJson(baseUrl, "/api/jobs?limit=5");
    assert.equal(jobs.schema_version, "job-status-ledger/v1");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].jobs[0].id, "job_failed");
  } finally {
    app.server.close();
  }
});

test("private beta signal API honors stable signal ledger path from env", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-signal-api-env-path-"));
  const appDir = path.join(tmp, "app");
  const signalPath = path.join(tmp, "stable", "private-beta-signal-ledger.json");
  await mkdir(appDir, { recursive: true });

  const app = await createWorkbenchServer({
    appDir,
    host: "127.0.0.1",
    port: 0,
    env: { MWB_PRIVATE_BETA_SIGNAL_PATH: signalPath },
    jobStatusService: {
      listJobs: async () => ({
        schema_version: "job-status-ledger/v1",
        jobs: [{
          id: "job_failed_env_path",
          kind: "custom_skill",
          label: "Run test skill",
          status: "failed",
          matterName: "Signal Matter",
          errorMessage: "Failed while testing stable signal path",
        }],
      }),
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    await getJson(baseUrl, "/api/jobs?limit=5");

    assert.equal(existsSync(signalPath), true);
    assert.equal(existsSync(path.join(appDir, ".local", "private-beta-signal-ledger.json")), false);
    const store = JSON.parse(await readFile(signalPath, "utf8"));
    assert.equal(store.signals.length, 1);
    assert.equal(store.signals[0].details.jobId, "job_failed_env_path");
  } finally {
    app.server.close();
  }
});

test("private beta telemetry mode env enables firm-internal feedback and signal packets", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-telemetry-mode-api-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });
  const feedbackRequests = [];
  const signalRequests = [];

  const app = await createWorkbenchServer({
    appDir,
    host: "127.0.0.1",
    port: 0,
    env: {
      MWB_PRIVATE_BETA_TELEMETRY_MODE: "firm_internal",
      MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL: "https://mothership.example.test/api/beta-feedback",
      MWB_PRIVATE_BETA_SIGNAL_SYNC_URL: "https://mothership.example.test/api/beta-signals",
      MWB_PRIVATE_BETA_INSTALL_ID: "firm-install-01",
    },
    privateBetaFeedbackPath: path.join(tmp, "feedback-ledger.json"),
    privateBetaSignalPath: path.join(tmp, "signals-ledger.json"),
    privateBetaFeedbackFetch: async (url, options = {}) => {
      feedbackRequests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 202, text: async () => "" };
    },
    privateBetaSignalFetch: async (url, options = {}) => {
      signalRequests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 202, text: async () => "" };
    },
    jobStatusService: {
      listJobs: async () => ({
        schema_version: "job-status-ledger/v1",
        jobs: [{
          id: "job_firm_api",
          kind: "custom_skill",
          label: "Run The Story",
          status: "failed",
          matterName: "Firm Matter",
          errorMessage: "failed while reading facts token=sk-job-secret",
          metadata: { sourceText: "Client gave detailed firm-internal facts." },
        }],
      }),
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    await postJson(baseUrl, "/api/private-beta/feedback", {
      choice: "did_not_work",
      tryingToDo: "Use firm-internal feedback",
      context: {
        sourceText: "Client says the notice was sent in March.",
        generatedOutput: "Draft missed the notice.",
      },
    });
    await getJson(baseUrl, "/api/jobs?limit=5");
    assert.equal(feedbackRequests.length, 0);
    assert.equal(signalRequests.length, 0);

    const feedbackSync = await postJson(baseUrl, "/api/private-beta/feedback/sync", {});
    const signalSync = await postJson(baseUrl, "/api/private-beta/signals/sync", {});

    assert.equal(feedbackSync.sent, 1);
    assert.equal(feedbackRequests.length, 1);
    assert.equal(feedbackRequests[0].body.feedback.telemetryMode, "firm_internal");
    assert.equal(feedbackRequests[0].body.feedback.context.sourceText, "Client says the notice was sent in March.");
    assert.equal(feedbackRequests[0].body.feedback.context.generatedOutput, "Draft missed the notice.");

    assert.equal(signalSync.sent, 1);
    assert.equal(signalRequests.length, 1);
    assert.equal(signalRequests[0].body.signal.telemetryMode, "firm_internal");
    assert.equal(signalRequests[0].body.signal.details.metadata.sourceText, "Client gave detailed firm-internal facts.");
    assert.match(signalRequests[0].body.signal.details.errorMessage, /token=\[redacted-secret\]/);
    assert.doesNotMatch(JSON.stringify({ feedbackRequests, signalRequests }), /sk-job-secret/);
  } finally {
    app.server.close();
  }
});

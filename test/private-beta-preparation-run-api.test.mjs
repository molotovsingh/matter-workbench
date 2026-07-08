import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";

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

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

test("private beta preparation run API records one run envelope with stage evidence", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-prep-run-api-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });

  const app = await createWorkbenchServer({
    appDir,
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const runId = "prep_test_run_001";

    const started = await postJson(baseUrl, "/api/private-beta/preparation-runs", {
      action: "start",
      runId,
      matterName: "Taori vs Roma Builder",
      mode: "full",
      stages: ["matter-init", "extract", "describe-sources", "case-timeline"],
    });
    assert.equal(started.job.id, runId);
    assert.equal(started.job.kind, "preparation_run");
    assert.equal(started.job.status, "running");

    await postJson(baseUrl, "/api/private-beta/preparation-runs", {
      action: "stage",
      runId,
      matterName: "Taori vs Roma Builder",
      stage: { id: "extract", label: "Reading documents", status: "succeeded", durationMs: 1800 },
    });

    const finished = await postJson(baseUrl, "/api/private-beta/preparation-runs", {
      action: "finish",
      runId,
      matterName: "Taori vs Roma Builder",
      status: "succeeded",
      message: "Preparation rerun completed.",
      stages: [
        { id: "matter-init", status: "succeeded" },
        { id: "extract", status: "succeeded", durationMs: 1800 },
        { id: "describe-sources", status: "succeeded" },
        { id: "case-timeline", status: "succeeded" },
      ],
    });
    assert.equal(finished.job.status, "succeeded");

    const jobs = await getJson(baseUrl, "/api/jobs?kind=preparation_run&limit=5");
    assert.equal(jobs.jobs.length, 1);
    assert.equal(jobs.jobs[0].matterName, "Taori vs Roma Builder");
    assert.equal(jobs.jobs[0].metadata.preparationRun.mode, "full");
    assert.deepEqual(jobs.jobs[0].metadata.preparationRun.stages.map((stage) => stage.id), [
      "matter-init",
      "extract",
      "describe-sources",
      "case-timeline",
    ]);
  } finally {
    app.server.close();
  }
});

test("private beta preparation run API records failed runs without raw html dumps", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-prep-run-api-fail-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });

  const app = await createWorkbenchServer({
    appDir,
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const runId = "prep_test_run_failed";
    await postJson(baseUrl, "/api/private-beta/preparation-runs", {
      action: "start",
      runId,
      matterName: "Bharat Nagpal Vs Gionee India",
      mode: "full",
    });
    await postJson(baseUrl, "/api/private-beta/preparation-runs", {
      action: "finish",
      runId,
      matterName: "Bharat Nagpal Vs Gionee India",
      status: "failed",
      message: "<html><head><title>504 Gateway Time-out</title></head><body>nginx</body></html>",
      stages: [{ id: "extract", label: "Reading documents", status: "failed" }],
    });

    const jobs = await getJson(baseUrl, "/api/jobs?kind=preparation_run&status=failed&limit=5");
    assert.equal(jobs.jobs.length, 1);
    assert.equal(jobs.jobs[0].failureClass, "provider");
    assert.doesNotMatch(jobs.jobs[0].errorMessage, /<html>|<body>|nginx/i);
    assert.match(jobs.jobs[0].errorMessage, /504 Gateway Time-out/);
  } finally {
    app.server.close();
  }
});

test("private beta preparation run API keeps bounded stage diagnostics without raw html", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-prep-run-api-diagnostic-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });

  const app = await createWorkbenchServer({
    appDir,
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const runId = "prep_test_run_diagnostic";
    await postJson(baseUrl, "/api/private-beta/preparation-runs", {
      action: "start",
      runId,
      matterName: "State v Rajesh Mehra",
      mode: "full",
    });
    await postJson(baseUrl, "/api/private-beta/preparation-runs", {
      action: "stage",
      runId,
      matterName: "State v Rajesh Mehra",
      stage: {
        id: "extract",
        label: "Reading documents",
        status: "failed",
        message: "Reading documents took too long. The app may still be finishing in the background.",
        diagnostic: {
          statusCode: 504,
          code: "preparation.extract_timeout",
          statusText: "Gateway Timeout",
          urlPath: "/api/extract",
          bodyKind: "html",
          htmlTitle: "504 Gateway Time-out",
          rawBody: "<html><body><center>nginx/1.24.0</center></body></html>",
        },
      },
    });

    const jobs = await getJson(baseUrl, "/api/jobs?kind=preparation_run&limit=5");
    assert.equal(jobs.jobs.length, 1);
    const latestStage = jobs.jobs[0].metadata.latestStage;
    assert.deepEqual(latestStage.diagnostic, {
      statusCode: 504,
      code: "preparation.extract_timeout",
      statusText: "Gateway Timeout",
      urlPath: "/api/extract",
      bodyKind: "html",
      htmlTitle: "504 Gateway Time-out",
    });
    assert.doesNotMatch(JSON.stringify(jobs.jobs[0]), /<html>|<body>|nginx/i);
  } finally {
    app.server.close();
  }
});

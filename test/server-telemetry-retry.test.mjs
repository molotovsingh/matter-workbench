import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";

test("Workbench starts and stops telemetry retry only when mothership sync is configured", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "mwb-telemetry-server-"));
  const events = [];
  const telemetryRetryService = {
    start: (options) => events.push(["start", options]),
    stop: () => events.push(["stop"]),
  };
  const app = await createWorkbenchServer({
    appDir,
    env: {
      MATTERS_HOME: path.join(appDir, "matters"),
      MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL: "http://127.0.0.1:4192/v1/feedback",
      MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN: "test-token",
    },
    host: "127.0.0.1",
    port: 0,
    telemetryRetryService,
  });

  assert.deepEqual(events, []);
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  assert.deepEqual(events, [["start", { immediate: true }]]);
  await new Promise((resolve) => app.server.close(resolve));
  assert.deepEqual(events, [["start", { immediate: true }], ["stop"]]);
});

test("Workbench does not schedule telemetry retries without a complete sync credential pair", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "mwb-telemetry-server-off-"));
  const events = [];
  const app = await createWorkbenchServer({
    appDir,
    env: {
      MATTERS_HOME: path.join(appDir, "matters"),
      MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL: "http://127.0.0.1:4192/v1/feedback",
    },
    host: "127.0.0.1",
    port: 0,
    telemetryRetryService: {
      start: () => events.push("start"),
      stop: () => events.push("stop"),
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => app.server.close(resolve));
  assert.deepEqual(events, []);
});

test("Workbench records request latency through the private beta metrics service", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "mwb-telemetry-metrics-server-"));
  const observations = [];
  const app = await createWorkbenchServer({
    appDir,
    env: {
      MATTERS_HOME: path.join(appDir, "matters"),
    },
    host: "127.0.0.1",
    port: 0,
    privateBetaMetricsService: {
      observeRequest: (input) => observations.push(input),
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(`${baseUrl}/api/settings`);
  await response.text();
  await new Promise((resolve) => app.server.close(resolve));

  assert.equal(observations.length, 1);
  assert.equal(observations[0].method, "GET");
  assert.equal(observations[0].pathname, "/api/settings");
  assert.equal(observations[0].statusCode, response.status);
  assert.equal(typeof observations[0].durationMs, "number");
});

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPrivateBetaMetricsService,
  summarizeRequestLatency,
} from "../services/private-beta-metrics-service.mjs";

test("metrics service records latency, scores backend suitability, and syncs snapshots", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-metrics-"));
  const requests = [];
  let nowMs = Date.parse("2026-06-10T10:00:00.000Z");
  const service = createPrivateBetaMetricsService({
    appDir: tmp,
    metricsPath: path.join(tmp, "metrics-ledger.json"),
    syncUrl: "https://mothership.example.test/v1/metrics",
    syncToken: "mwb_ing_secret-token",
    installId: "firm-beta-01",
    idFactory: () => "metrics_001",
    now: () => new Date(nowMs),
    sampleRuntime: async () => ({
      uptimeSeconds: 120,
      rssMb: 900,
      heapUsedMb: 210,
      loadAverage1m: 1.25,
      cpuCount: 4,
      diskFreePercent: 62,
      diskFreeGb: 98,
      diskTotalGb: 160,
    }),
    fetchImpl: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return { ok: true, status: 202 };
    },
  });

  service.observeRequest({ pathname: "/api/matter/copilot", statusCode: 200, durationMs: 8300 });
  service.observeRequest({ pathname: "/api/extract", statusCode: 200, durationMs: 18000, visibleProgress: false });
  service.observeRequest({ pathname: "/api/configurable-skills/run", statusCode: 500, durationMs: 2200 });
  nowMs += 1000;

  const snapshot = await service.captureRuntimeSnapshot({
    deployment: {
      commit: "abc1234",
      baseUrl: "https://beta.example.test",
      storageMode: "postgres",
      restoreDrill: "not_run",
      storageBackup: "unknown",
    },
  });

  assert.equal(snapshot.schema_version, "private-beta-metrics/v1");
  assert.equal(snapshot.id, "metrics_001");
  assert.equal(snapshot.latency.requestCount, 3);
  assert.equal(snapshot.latency.p95Ms, 18000);
  assert.equal(snapshot.latency.silentWaitMaxMs, 18000);
  assert.equal(snapshot.scores.userPatienceRisk, "medium");
  assert.equal(snapshot.scores.restoreConfidence, 40);
  assert.ok(snapshot.scores.backendSuitability < 100);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://mothership.example.test/v1/metrics");
  assert.equal(requests[0].body.schema_version, "private-beta-metrics-sync/v1");
  assert.equal(requests[0].body.installId, "firm-beta-01");
  assert.equal(requests[0].body.metric.id, "metrics_001");
  assert.doesNotMatch(JSON.stringify(requests[0].body), /secret-token/);
  assert.equal(requests[0].headers.Authorization, "Bearer mwb_ing_secret-token");

  const ledger = JSON.parse(await readFile(path.join(tmp, "metrics-ledger.json"), "utf8"));
  assert.equal(ledger.metrics[0].sync.status, "sent");
});

test("metrics service queues failed sync and retries later", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-metrics-retry-"));
  let fail = true;
  const service = createPrivateBetaMetricsService({
    appDir: tmp,
    metricsPath: path.join(tmp, "metrics-ledger.json"),
    syncUrl: "https://mothership.example.test/v1/metrics",
    syncToken: "token",
    installId: "firm-beta-01",
    idFactory: () => "metrics_retry_001",
    now: () => new Date("2026-06-10T10:00:00.000Z"),
    sampleRuntime: async () => ({ diskFreePercent: 90, cpuCount: 4 }),
    fetchImpl: async (_url, options = {}) => {
      assert.ok(options.signal instanceof AbortSignal);
      if (fail) return { ok: false, status: 503, text: async () => "down" };
      return { ok: true, status: 202 };
    },
  });

  const snapshot = await service.captureRuntimeSnapshot();
  assert.equal(snapshot.sync.status, "queued");

  fail = false;
  const result = await service.syncQueuedMetrics();
  assert.equal(result.attempted, 1);
  assert.equal(result.sent, 1);
});

test("latency summary calculates percentiles and route buckets", () => {
  const summary = summarizeRequestLatency([
    { route: "GET /api/matters", statusCode: 200, durationMs: 100 },
    { route: "POST /api/extract", statusCode: 200, durationMs: 20000, visibleProgress: false },
    { route: "POST /api/extract", statusCode: 500, durationMs: 5000 },
  ]);

  assert.equal(summary.requestCount, 3);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.p50Ms, 5000);
  assert.equal(summary.p95Ms, 20000);
  assert.equal(summary.silentWaitMaxMs, 20000);
  assert.deepEqual(summary.byRoute.map((route) => route.route), ["POST /api/extract", "GET /api/matters"]);
});

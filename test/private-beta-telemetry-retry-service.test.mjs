import assert from "node:assert/strict";
import test from "node:test";

import { createPrivateBetaTelemetryRetryService } from "../services/private-beta-telemetry-retry-service.mjs";

test("telemetry retry service schedules five-minute queue drains and stops cleanly", async () => {
  const calls = [];
  let scheduled;
  let cleared;
  const service = createPrivateBetaTelemetryRetryService({
    feedbackService: { syncQueuedFeedback: async () => calls.push("feedback") },
    signalService: { syncQueuedSignals: async () => calls.push("signals") },
    setIntervalImpl: (callback, milliseconds) => {
      scheduled = { callback, milliseconds, unref: () => calls.push("unref") };
      return scheduled;
    },
    clearIntervalImpl: (handle) => { cleared = handle; },
  });

  service.start();
  assert.equal(scheduled.milliseconds, 5 * 60 * 1000);
  assert.deepEqual(calls, ["unref"]);

  await scheduled.callback();
  assert.deepEqual(calls, ["unref", "feedback", "signals"]);

  service.stop();
  assert.equal(cleared, scheduled);
});

test("telemetry retry service supports immediate retry without blocking start", async () => {
  let resolveFeedback;
  const events = [];
  const service = createPrivateBetaTelemetryRetryService({
    feedbackService: { syncQueuedFeedback: () => new Promise((resolve) => { resolveFeedback = () => { events.push("feedback"); resolve(); }; }) },
    signalService: { syncQueuedSignals: async () => events.push("signals") },
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl: () => {},
  });

  service.start({ immediate: true });
  assert.deepEqual(events, []);
  await Promise.resolve();
  resolveFeedback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["feedback", "signals"]);
});

test("telemetry retry service captures a new metric snapshot before draining the metrics queue", async () => {
  const events = [];
  const service = createPrivateBetaTelemetryRetryService({
    feedbackService: { syncQueuedFeedback: async () => events.push("feedback") },
    metricsService: {
      captureRuntimeSnapshot: async (context) => {
        events.push(`metrics:${context.deployment.commit}`);
        return { sync: { status: "queued" } };
      },
      syncQueuedMetrics: async () => {
        events.push("metrics-queued");
        return { attempted: 0, sent: 0 };
      },
    },
    metricsContextProvider: () => ({ deployment: { commit: "abc1234" } }),
    signalService: { syncQueuedSignals: async () => events.push("signals") },
  });

  const result = await service.runOnce();

  assert.equal(result.metrics.captured, true);
  assert.equal(result.metrics.syncStatus, "queued");
  assert.deepEqual(events, ["feedback", "metrics:abc1234", "metrics-queued", "signals"]);
});

test("telemetry retry service captures and syncs heartbeat snapshots", async () => {
  const calls = [];
  const service = createPrivateBetaTelemetryRetryService({
    feedbackService: { syncQueuedFeedback: async () => ({ sent: 0 }) },
    metricsService: {
      captureRuntimeSnapshot: async () => ({ sync: { status: "queued" } }),
      syncQueuedMetrics: async () => ({ sent: 0 }),
    },
    signalService: { syncQueuedSignals: async () => ({ sent: 0 }) },
    heartbeatService: {
      captureHeartbeat: async () => {
        calls.push("captureHeartbeat");
        return { sync: { status: "queued" } };
      },
      syncQueuedHeartbeats: async () => {
        calls.push("syncQueuedHeartbeats");
        return { sent: 1 };
      },
    },
  });

  const result = await service.runOnce();

  assert.deepEqual(calls, ["captureHeartbeat", "syncQueuedHeartbeats"]);
  assert.equal(result.heartbeats.captured, true);
  assert.equal(result.heartbeats.syncStatus, "queued");
  assert.equal(result.heartbeats.queued.sent, 1);
});

test("telemetry retry service prevents overlaps and isolates queue failures", async () => {
  let release;
  let feedbackCalls = 0;
  let signalCalls = 0;
  const errors = [];
  const service = createPrivateBetaTelemetryRetryService({
    feedbackService: {
      syncQueuedFeedback: async () => {
        feedbackCalls += 1;
        if (feedbackCalls === 1) await new Promise((resolve) => { release = resolve; });
        else throw new Error("token=super-secret network failure");
      },
    },
    signalService: { syncQueuedSignals: async () => { signalCalls += 1; } },
    log: { error: (line) => errors.push(line) },
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl: () => {},
  });

  const first = service.runOnce();
  assert.deepEqual(await service.runOnce(), { skipped: true, reason: "already_running" });
  release();
  assert.equal((await first).completed, true);
  assert.equal(signalCalls, 1);

  const second = await service.runOnce();
  assert.equal(second.completed, true);
  assert.equal(signalCalls, 2);
  assert.match(errors.join("\n"), /token=\[redacted-secret\]/);
  assert.doesNotMatch(errors.join("\n"), /super-secret/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { BoundedDocumentWorkerLoop, abortableSleep } from "../workers/document-processing/bounded-worker-loop.mjs";

// V4-WORK-001 stateless bounded worker-pool evidence
test("worker loop keeps execution within configured concurrency and emits sanitized outcomes", async () => {
  let active = 0;
  let maximumActive = 0;
  const events = [];
  const loop = new BoundedDocumentWorkerLoop({
    tenantId: "tenant-1",
    concurrency: 2,
    worker: {
      async runOnce({ workerId }) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { status: "accepted", workUnitId: workerId, text: "must not enter telemetry" };
      },
    },
    onOutcome: async (event) => events.push(event),
  });
  const stats = await loop.run({ maximumIterationsPerLane: 2 });
  assert.equal(maximumActive, 2);
  assert.deepEqual(stats, { iterations: 4, completed: 4, deferred: 0, idle: 0, errors: 0 });
  assert.equal(events.length, 4);
  assert.doesNotMatch(JSON.stringify(events), /must not enter telemetry/);
});

test("worker loop backs off errors, honors provider deferral, and avoids idle hot polling", async () => {
  const sleeps = [];
  const events = [];
  let call = 0;
  const loop = new BoundedDocumentWorkerLoop({
    tenantId: "tenant-1",
    concurrency: 1,
    idlePollMs: 10,
    baseErrorBackoffMs: 100,
    maximumErrorBackoffMs: 1000,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    onOutcome: async (event) => events.push(event),
    worker: {
      async runOnce() {
        call += 1;
        if (call === 1) throw Object.assign(new Error("database password=secret"), { code: "worker.db_failed" });
        if (call === 2) return { status: "deferred", retryAfterMs: 500 };
        return null;
      },
    },
  });
  const stats = await loop.run({ maximumIterationsPerLane: 5 });
  assert.deepEqual(stats, { iterations: 5, completed: 0, deferred: 1, idle: 3, errors: 1 });
  // Error backoff, then the provider's own deferral hint (admission gating
  // never grows past the poll floor), then exponentially growing idle polls.
  assert.deepEqual(sleeps, [100, 500, 10, 20, 40]);
  assert.deepEqual(events.map((event) => event.type), ["error", "deferred"]);
  assert.doesNotMatch(JSON.stringify(events), /password|secret/);
});

test("abortable sleep ends immediately on shutdown", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const sleeping = abortableSleep(60_000, controller.signal);
  controller.abort();
  await sleeping;
  assert.ok(Date.now() - started < 1000);
});

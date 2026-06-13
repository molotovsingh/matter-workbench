import assert from "node:assert/strict";
import test from "node:test";

import {
  attemptTelemetrySync,
  drainQueuedTelemetrySync,
  markTelemetrySyncQueued,
  normalizeTelemetrySyncConfig,
  syncTelemetryItemOutsideLock,
} from "../services/telemetry-sync-client.mjs";

test("telemetry sync config fails closed on missing or non-http URLs and clamps timeouts", () => {
  assert.equal(normalizeTelemetrySyncConfig({}).url, null);
  assert.equal(normalizeTelemetrySyncConfig({ syncUrl: "not a url" }).url, null);
  assert.equal(normalizeTelemetrySyncConfig({ syncUrl: "ftp://mothership.test" }).url, null);
  assert.equal(normalizeTelemetrySyncConfig({ syncUrl: "https://mothership.test/api" }).url.hostname, "mothership.test");
  assert.equal(normalizeTelemetrySyncConfig({}).timeoutMs, 10_000);
  assert.equal(normalizeTelemetrySyncConfig({ timeoutMs: 0 }).timeoutMs, 10_000);
  assert.equal(normalizeTelemetrySyncConfig({ timeoutMs: 999_999 }).timeoutMs, 60_000);
});

test("telemetry sync posts the payload with bearer auth and records sent state", async () => {
  const requests = [];
  const syncConfig = normalizeTelemetrySyncConfig({
    syncUrl: "https://mothership.test/api/feedback",
    syncToken: "mwb_ing_fixture",
    installId: "firm-01",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true };
    },
  });

  const sync = await attemptTelemetrySync({
    syncConfig,
    previousSync: { status: "queued", attempts: 2 },
    now: () => new Date("2026-06-12T10:00:00.000Z"),
    buildPayload: (installId) => ({ installId, hello: "world" }),
  });

  assert.equal(sync.status, "sent");
  assert.equal(sync.attempts, 3);
  assert.equal(sync.sentAt, "2026-06-12T10:00:00.000Z");
  assert.equal(sync.endpointHost, "mothership.test");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.Authorization, "Bearer mwb_ing_fixture");
  assert.deepEqual(JSON.parse(requests[0].options.body), { installId: "firm-01", hello: "world" });
});

test("telemetry sync timeout aborts a hung fetch and queues the item", async () => {
  const syncConfig = normalizeTelemetrySyncConfig({
    syncUrl: "https://mothership.test/api/feedback",
    timeoutMs: 25,
    fetchImpl: (url, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener?.("abort", () => reject(new Error("request aborted by timeout")));
    }),
  });

  const startedAt = Date.now();
  const sync = await attemptTelemetrySync({
    syncConfig,
    previousSync: {},
    buildPayload: () => ({}),
  });

  assert.ok(Date.now() - startedAt < 5_000, "must not hang for the full request");
  assert.equal(sync.status, "queued");
  assert.equal(sync.attempts, 1);
  assert.match(sync.lastError, /abort/i);
});

test("telemetry sync marks queued without touching the network when configured", () => {
  const syncConfig = normalizeTelemetrySyncConfig({
    syncUrl: "https://mothership.test/api",
    fetchImpl: () => {
      throw new Error("must not be called");
    },
  });

  assert.equal(markTelemetrySyncQueued({ syncConfig, previousSync: { status: "sent", attempts: 1 } }).status, "queued");
  assert.equal(markTelemetrySyncQueued({ syncConfig: normalizeTelemetrySyncConfig({}) }).status, "not_configured");
});

test("two-phase drain never performs network I/O while the store mutation lock is held", async () => {
  const store = {
    items: [
      { id: "a", createdAt: "2026-06-12T08:00:00.000Z", sync: { status: "queued", attempts: 1 } },
      { id: "b", createdAt: "2026-06-12T09:00:00.000Z", sync: { status: "queued", attempts: 1 } },
      { id: "c", createdAt: "2026-06-12T09:30:00.000Z", sync: { status: "sent", attempts: 1 } },
    ],
  };
  let mutationActive = false;
  const writeMutatedStore = async (mutator) => {
    mutationActive = true;
    try {
      return await mutator(store);
    } finally {
      mutationActive = false;
    }
  };

  const result = await drainQueuedTelemetrySync({
    loadStore: async () => store,
    writeMutatedStore,
    selectItems: (current) => current.items,
    attemptSync: async (item) => {
      assert.equal(mutationActive, false, "sync must run outside the store lock");
      return item.id === "a"
        ? { status: "sent", attempts: 2, lastAttemptAt: "2026-06-12T10:00:00.000Z", sentAt: "2026-06-12T10:00:00.000Z" }
        : { status: "queued", attempts: 2, lastAttemptAt: "2026-06-12T10:00:00.000Z", lastError: "mothership returned 503" };
    },
    schemaVersion: "fixture-sync-result/v1",
  });

  assert.deepEqual(
    { attempted: result.attempted, sent: result.sent, queued: result.queued, failed: result.failed, skipped: result.skipped },
    { attempted: 2, sent: 1, queued: 1, failed: 0, skipped: 0 },
  );
  assert.equal(store.items.find((item) => item.id === "a").sync.status, "sent");
  assert.equal(store.items.find((item) => item.id === "b").sync.status, "queued");
  assert.equal(store.items.find((item) => item.id === "c").sync.attempts, 1);
});

test("single-item sync writes the result back by id and tolerates evicted rows", async () => {
  const store = { items: [{ id: "kept", sync: { status: "queued", attempts: 0 } }] };
  let mutationActive = false;
  const writeMutatedStore = async (mutator) => {
    mutationActive = true;
    try {
      return await mutator(store);
    } finally {
      mutationActive = false;
    }
  };
  const attemptSync = async () => {
    assert.equal(mutationActive, false, "sync must run outside the store lock");
    return { status: "sent", attempts: 1, lastAttemptAt: "2026-06-12T10:00:00.000Z" };
  };

  const synced = await syncTelemetryItemOutsideLock({
    writeMutatedStore,
    selectItems: (current) => current.items,
    item: { id: "kept", updatedAt: "old", sync: { status: "queued", attempts: 0 } },
    attemptSync,
  });
  assert.equal(synced.sync.status, "sent");
  assert.equal(synced.updatedAt, "2026-06-12T10:00:00.000Z");
  assert.equal(store.items[0].sync.status, "sent");

  const evicted = await syncTelemetryItemOutsideLock({
    writeMutatedStore,
    selectItems: (current) => current.items,
    item: { id: "gone", sync: { status: "queued", attempts: 0 } },
    attemptSync,
  });
  assert.equal(evicted.sync.status, "sent");
});

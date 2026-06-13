# Heartbeat Journey Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact private-beta heartbeat stream so the mothership can see whether an install is alive, what journey stage testers are in, and whether they are stuck.

**Architecture:** Reuse the existing private-beta telemetry pattern: local append-only ledger first, non-blocking queued sync second, mothership authenticated ingestion third, report summary last. Heartbeat is a fourth ingestion kind beside feedback, signals, and metrics, with its own schema, local service, mothership table, endpoint, and report summary. The first slice is push-only; external pull checks are kept for a later deployment-monitor slice.

**Tech Stack:** Node.js ESM, append-only JSON ledgers, existing `telemetry-sync-client.mjs`, existing mothership HTTP server/store, PostgreSQL migrations, `node:test`.

---

## File Structure

- Create `services/private-beta-heartbeat-service.mjs`
  - Owns heartbeat ledger normalization, safe packet shape, queued sync, and sync retry.
  - Mirrors the structure of `services/private-beta-metrics-service.mjs`.
- Modify `services/private-beta-telemetry-retry-service.mjs`
  - Calls `heartbeatService.captureHeartbeat()` and `heartbeatService.syncQueuedHeartbeats()` in the existing retry loop.
- Modify `server.mjs`
  - Instantiates heartbeat service.
  - Wires env vars and existing deployment context.
  - Passes the service into telemetry retry and exported `services`.
- Modify `mothership/server.mjs`
  - Accepts `POST /v1/heartbeats`.
  - Validates `private-beta-heartbeat-sync/v1` and `private-beta-heartbeat/v1`.
- Modify `mothership/store.mjs`
  - Adds `ingestHeartbeat`.
  - Includes heartbeats in `queryReport`.
  - Prunes expired heartbeat rows.
- Create `mothership/db/migrations/003_mothership_heartbeats.sql`
  - Adds `mothership_heartbeat_events`.
- Modify `mothership/report.mjs`
  - Summarizes latest heartbeat per installation.
  - Surfaces stale heartbeat and patience risk.
- Modify `services/private-beta-observability-service.mjs`
  - Reads local heartbeat ledger if available and includes latest heartbeat in operator observability.
- Add tests:
  - `test/private-beta-heartbeat-service.test.mjs`
  - Update `test/private-beta-telemetry-retry-service.test.mjs`
  - Update `test/mothership-server.test.mjs`
  - Update `test/mothership-store.test.mjs`
  - Update `test/mothership-db-migration.test.mjs`
  - Update `test/mothership-report.test.mjs`
  - Update `test/private-beta-observability-service.test.mjs`

## Task 1: App Heartbeat Service

**Files:**
- Create: `services/private-beta-heartbeat-service.mjs`
- Test: `test/private-beta-heartbeat-service.test.mjs`

- [ ] **Step 1: Write the failing service test**

Create `test/private-beta-heartbeat-service.test.mjs` with these cases:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPrivateBetaHeartbeatService } from "../services/private-beta-heartbeat-service.mjs";

test("heartbeat service queues compact journey snapshots and syncs later", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-heartbeat-"));
  const requests = [];
  const service = createPrivateBetaHeartbeatService({
    appDir: tmp,
    heartbeatPath: path.join(tmp, "heartbeat-ledger.json"),
    syncUrl: "https://mothership.example.test/v1/heartbeats",
    syncToken: "mwb_ing_secret-token",
    installId: "firm-beta-01",
    telemetryMode: "firm_internal",
    idFactory: () => "heartbeat_001",
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return { ok: true, status: 202 };
    },
    journeyProvider: () => ({
      activeSessions: 1,
      journeys: [{
        user: "shivangi@lawzeus.com",
        matter: "Gionee India Pvt Ltd v Bharat Nagpal",
        screen: "matter_overview",
        lastAction: "run_preparation_again",
        currentStage: "extract_documents",
        currentStageStatus: "failed",
        traceId: "trace_001",
        jobId: "job_001",
        lastError: "504 Gateway Time-out",
        patienceRisk: "high",
      }],
      counters: { queuedFeedback: 1, openSignals: 2, failedJobs: 1, slowStages: 1 },
    }),
    deploymentProvider: () => ({
      appVersion: "abc1234",
      runtimeMode: "postgres",
      publicUrl: "https://mwb-beta.example.test",
    }),
  });

  const heartbeat = await service.captureHeartbeat();

  assert.equal(heartbeat.schema_version, "private-beta-heartbeat/v1");
  assert.equal(heartbeat.id, "heartbeat_001");
  assert.equal(heartbeat.installId, "firm-beta-01");
  assert.equal(heartbeat.telemetryMode, "firm_internal");
  assert.equal(heartbeat.activeSessions, 1);
  assert.equal(heartbeat.journeys[0].currentStage, "extract_documents");
  assert.equal(heartbeat.journeys[0].lastError, "504 Gateway Time-out");
  assert.equal(heartbeat.sync.status, "queued");
  assert.equal(requests.length, 0);

  const synced = await service.syncQueuedHeartbeats();
  assert.equal(synced.sent, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://mothership.example.test/v1/heartbeats");
  assert.equal(requests[0].body.schema_version, "private-beta-heartbeat-sync/v1");
  assert.equal(requests[0].body.installId, "firm-beta-01");
  assert.equal(requests[0].body.heartbeat.id, "heartbeat_001");
  assert.doesNotMatch(JSON.stringify(requests[0].body), /secret-token/);
  assert.equal(requests[0].headers.Authorization, "Bearer mwb_ing_secret-token");

  const ledger = JSON.parse(await readFile(path.join(tmp, "heartbeat-ledger.json"), "utf8"));
  assert.equal(ledger.heartbeats[0].sync.status, "sent");
});

test("heartbeat service redacts secrets and legal text in safe mode", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-heartbeat-safe-"));
  const service = createPrivateBetaHeartbeatService({
    appDir: tmp,
    heartbeatPath: path.join(tmp, "heartbeat-ledger.json"),
    installId: "firm-beta-01",
    telemetryMode: "safe",
    idFactory: () => "heartbeat_safe",
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    journeyProvider: () => ({
      activeSessions: 1,
      journeys: [{
        user: "lawyer@example.test",
        matter: "Sensitive Matter",
        screen: "matter_overview",
        lastAction: "ask_copilot",
        currentStage: "copilot_answer",
        currentStageStatus: "failed",
        lastError: "OPENAI_API_KEY=sk-secret failed",
        sourceText: "The contract says the client admitted liability.",
        generatedOutput: "Draft legal output body",
      }],
    }),
  });

  const heartbeat = await service.captureHeartbeat();
  const text = JSON.stringify(heartbeat);

  assert.match(text, /OPENAI_API_KEY=\\[redacted-secret\\]/);
  assert.doesNotMatch(text, /sk-secret/);
  assert.doesNotMatch(text, /admitted liability/);
  assert.doesNotMatch(text, /Draft legal output body/);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test test/private-beta-heartbeat-service.test.mjs
```

Expected: fail with missing module/export.

- [ ] **Step 3: Implement the heartbeat service**

Create `services/private-beta-heartbeat-service.mjs` using the metrics service pattern:

```js
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import {
  attemptTelemetrySync,
  markTelemetrySyncQueued,
  normalizeTelemetrySyncConfig,
} from "./telemetry-sync-client.mjs";

const LEDGER_SCHEMA_VERSION = "private-beta-heartbeat-ledger/v1";
const HEARTBEAT_SCHEMA_VERSION = "private-beta-heartbeat/v1";
const SYNC_RESULT_SCHEMA_VERSION = "private-beta-heartbeat-sync-result/v1";
const DEFAULT_LIMIT = 100;

export function createPrivateBetaHeartbeatService({
  appDir = process.cwd(),
  heartbeatPath,
  syncUrl = "",
  syncToken = "",
  installId = "",
  telemetryMode = "safe",
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  idFactory = () => `heartbeat_${randomUUID()}`,
  journeyProvider = () => ({}),
  deploymentProvider = () => ({}),
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = heartbeatPath || path.join(root, ".local", "private-beta-heartbeat-ledger.json");
  const syncConfig = normalizeTelemetrySyncConfig({ syncUrl, syncToken, installId, fetchImpl });
  const normalizedTelemetryMode = normalizeTelemetryMode(telemetryMode);
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: (store) => formatJsonStore(normalizeStore(store)),
  });

  async function captureHeartbeat(input = {}) {
    return writeMutatedStore(async (store) => {
      const createdAt = isoNow(now);
      const deployment = safeObject(typeof deploymentProvider === "function" ? await deploymentProvider() : {});
      const journey = safeObject(typeof journeyProvider === "function" ? await journeyProvider() : {});
      const heartbeat = normalizeHeartbeat({
        schema_version: HEARTBEAT_SCHEMA_VERSION,
        id: validId(input.id) || idFactory(),
        installId: syncConfig.installId || sanitizeText(input.installId, 160).trim(),
        appVersion: deployment.appVersion || deployment.commit || "",
        runtimeMode: deployment.runtimeMode || "",
        publicUrl: deployment.publicUrl || deployment.baseUrl || "",
        telemetryMode: normalizedTelemetryMode,
        createdAt,
        sentAt: createdAt,
        activeSessions: journey.activeSessions,
        journeys: journey.journeys,
        counters: journey.counters,
      });
      heartbeat.sync = markTelemetrySyncQueued({
        syncConfig,
        previousSync: heartbeat.sync,
        normalizeSync,
      });
      store.heartbeats.push(heartbeat);
      if (store.heartbeats.length > 500) store.heartbeats.splice(0, store.heartbeats.length - 500);
      return heartbeat;
    });
  }

  async function listHeartbeats(filters = {}) {
    const store = await loadStore();
    const limit = parseLimit(filters.limit);
    return {
      schema_version: LEDGER_SCHEMA_VERSION,
      heartbeats: store.heartbeats
        .sort(compareNewestFirst)
        .slice(0, limit),
    };
  }

  async function syncQueuedHeartbeats(filters = {}) {
    return writeMutatedStore(async (store) => {
      const limit = parseLimit(filters.limit);
      const candidates = store.heartbeats
        .filter((heartbeat) => heartbeat.sync?.status === "queued")
        .sort(compareOldestSyncFirst)
        .slice(0, limit);
      const result = {
        schema_version: SYNC_RESULT_SCHEMA_VERSION,
        attempted: 0,
        sent: 0,
        queued: 0,
        failed: 0,
        skipped: 0,
      };
      for (const heartbeat of candidates) {
        result.attempted += 1;
        heartbeat.sync = await attemptSync(heartbeat, heartbeat.sync);
        heartbeat.updatedAt = heartbeat.sync.lastAttemptAt || heartbeat.updatedAt;
        if (heartbeat.sync.status === "sent") result.sent += 1;
        else if (heartbeat.sync.status === "queued") result.queued += 1;
        else if (heartbeat.sync.status === "not_configured") result.skipped += 1;
        else result.failed += 1;
      }
      return result;
    });
  }

  async function loadStore() {
    try {
      return normalizeStore(JSON.parse(await readFile(storePath, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async function writeMutatedStore(mutator) {
    return persistence.withStoreMutation(async () => {
      const store = await loadStore();
      const result = await mutator(store);
      await persistence.writeStoreFile(store);
      return result;
    });
  }

  async function attemptSync(heartbeat, previousSync = {}) {
    return attemptTelemetrySync({
      syncConfig,
      previousSync,
      normalizeSync,
      now,
      buildPayload: (install) => buildSyncPayload(heartbeat, install),
      sanitizeError: (message) => sanitizeText(message, 300).trim(),
    });
  }

  return { captureHeartbeat, listHeartbeats, syncQueuedHeartbeats };
}
```

Then add local helpers in the same file:

```js
function normalizeHeartbeat(input = {}) {
  const createdAt = normalizeIso(input.createdAt) || new Date().toISOString();
  const mode = normalizeTelemetryMode(input.telemetryMode);
  return {
    schema_version: HEARTBEAT_SCHEMA_VERSION,
    id: validId(input.id) || `heartbeat_${randomUUID()}`,
    installId: sanitizeText(input.installId, 160).trim(),
    telemetryMode: mode,
    appVersion: sanitizeText(input.appVersion, 80).trim(),
    runtimeMode: sanitizeText(input.runtimeMode, 80).trim(),
    publicUrl: sanitizeText(input.publicUrl, 240).trim(),
    createdAt,
    updatedAt: normalizeIso(input.updatedAt) || createdAt,
    sentAt: normalizeIso(input.sentAt) || createdAt,
    activeSessions: Math.max(0, Math.round(Number(input.activeSessions) || 0)),
    journeys: sanitizeJourneys(input.journeys, mode),
    counters: sanitizeCounters(input.counters),
    sync: normalizeSync(input.sync),
  };
}

function sanitizeJourneys(items = [], mode = "safe") {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).map((item) => {
    const base = {
      user: sanitizeText(item.user, 180).trim(),
      matter: sanitizeText(item.matter, 300).trim(),
      screen: sanitizeText(item.screen, 80).trim(),
      route: sanitizeText(item.route, 120).trim(),
      lastAction: sanitizeText(item.lastAction, 120).trim(),
      currentStage: sanitizeText(item.currentStage, 120).trim(),
      currentStageStatus: sanitizeText(item.currentStageStatus, 80).trim(),
      traceId: sanitizeText(item.traceId, 180).trim(),
      jobId: sanitizeText(item.jobId, 180).trim(),
      lastError: sanitizeText(item.lastError, 500).trim(),
      patienceRisk: ["low", "medium", "high"].includes(item.patienceRisk) ? item.patienceRisk : "low",
    };
    if (mode === "firm_internal") {
      base.details = safeObject(item.details || {});
    }
    return base;
  });
}

function sanitizeCounters(counters = {}) {
  return {
    queuedFeedback: nonNegativeInt(counters.queuedFeedback),
    openSignals: nonNegativeInt(counters.openSignals),
    failedJobs: nonNegativeInt(counters.failedJobs),
    slowStages: nonNegativeInt(counters.slowStages),
  };
}
```

Use helper functions equivalent to the metrics service helpers: `buildSyncPayload`, `emptyStore`, `normalizeStore`, `normalizeSync`, `compareNewestFirst`, `compareOldestSyncFirst`, `parseLimit`, `validId`, `normalizeIso`, `isoNow`, `normalizeTelemetryMode`, `sanitizeText`, `redactSecretLikeText`, `safeObject`, and `nonNegativeInt`.

- [ ] **Step 4: Run the heartbeat service test**

Run:

```bash
node --test test/private-beta-heartbeat-service.test.mjs
```

Expected: pass.

## Task 2: Retry Loop And Server Wiring

**Files:**
- Modify: `services/private-beta-telemetry-retry-service.mjs`
- Modify: `server.mjs`
- Test: `test/private-beta-telemetry-retry-service.test.mjs`

- [ ] **Step 1: Add failing retry test**

Extend `test/private-beta-telemetry-retry-service.test.mjs` with:

```js
test("telemetry retry captures and syncs heartbeat snapshots", async () => {
  const calls = [];
  const service = createPrivateBetaTelemetryRetryService({
    feedbackService: { syncQueuedFeedback: async () => ({ sent: 0 }) },
    metricsService: { captureRuntimeSnapshot: async () => ({ sync: { status: "queued" } }), syncQueuedMetrics: async () => ({ sent: 0 }) },
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
  assert.equal(result.heartbeats.queued.sent, 1);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test test/private-beta-telemetry-retry-service.test.mjs
```

Expected: fail because `heartbeatService` is ignored.

- [ ] **Step 3: Update retry service**

Modify `createPrivateBetaTelemetryRetryService` signature:

```js
export function createPrivateBetaTelemetryRetryService({
  feedbackService,
  metricsService,
  metricsContextProvider,
  signalService,
  heartbeatService,
  intervalMs = DEFAULT_INTERVAL_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  log = console,
} = {}) {
```

Change result initialization:

```js
const result = { completed: true, feedback: null, metrics: null, signals: null, heartbeats: null };
```

Call heartbeat after metrics and before signals:

```js
result.heartbeats = await runHeartbeats();
```

Add:

```js
async function runHeartbeats() {
  if (typeof heartbeatService?.captureHeartbeat !== "function") {
    return { skipped: true, reason: "unavailable" };
  }
  try {
    const heartbeat = await heartbeatService.captureHeartbeat();
    const queued = typeof heartbeatService.syncQueuedHeartbeats === "function"
      ? await heartbeatService.syncQueuedHeartbeats()
      : { skipped: true, reason: "unavailable" };
    return {
      captured: true,
      syncStatus: heartbeat?.sync?.status || "unknown",
      queued,
    };
  } catch (error) {
    log.error?.(`private beta heartbeat retry failed: ${redactRetryError(error?.message)}`);
    return { failed: true };
  }
}
```

- [ ] **Step 4: Wire server**

In `server.mjs`, import:

```js
import { createPrivateBetaHeartbeatService } from "./services/private-beta-heartbeat-service.mjs";
```

Instantiate after metrics:

```js
const privateBetaHeartbeatService = options.privateBetaHeartbeatService || createPrivateBetaHeartbeatService({
  appDir,
  heartbeatPath: options.privateBetaHeartbeatPath || env.MWB_PRIVATE_BETA_HEARTBEAT_PATH,
  syncUrl: env.MWB_PRIVATE_BETA_HEARTBEAT_SYNC_URL
    || siblingMothershipSyncUrl(env.MWB_PRIVATE_BETA_METRICS_SYNC_URL || env.MWB_PRIVATE_BETA_SIGNAL_SYNC_URL || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_URL, "/v1/heartbeats"),
  syncToken: env.MWB_PRIVATE_BETA_HEARTBEAT_SYNC_TOKEN || env.MWB_PRIVATE_BETA_METRICS_SYNC_TOKEN || env.MWB_PRIVATE_BETA_SIGNAL_SYNC_TOKEN || env.MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN,
  installId: env.MWB_PRIVATE_BETA_INSTALL_ID || env.MWB_PRIVATE_BETA_HEARTBEAT_INSTALL_ID || env.MWB_PRIVATE_BETA_METRICS_INSTALL_ID || env.MWB_PRIVATE_BETA_SIGNAL_INSTALL_ID || env.MWB_PRIVATE_BETA_FEEDBACK_INSTALL_ID,
  telemetryMode: env.MWB_PRIVATE_BETA_TELEMETRY_MODE,
  fetchImpl: options.privateBetaHeartbeatFetch || options.privateBetaMetricsFetch || options.privateBetaSignalFetch || options.privateBetaFeedbackFetch,
  deploymentProvider: () => buildDeploymentMetricsContext({ env, host, port, matterStore }),
  journeyProvider: async () => ({
    activeSessions: 0,
    journeys: [],
    counters: {},
  }),
});
```

Pass to retry service:

```js
heartbeatService: privateBetaHeartbeatService,
```

Add to exported `services`:

```js
privateBetaHeartbeatService,
```

Update `hasTelemetrySyncConfig` to return true when heartbeat URL/token resolves.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test test/private-beta-heartbeat-service.test.mjs test/private-beta-telemetry-retry-service.test.mjs
```

Expected: pass.

## Task 3: Mothership Ingestion Endpoint And Store

**Files:**
- Modify: `mothership/server.mjs`
- Modify: `mothership/store.mjs`
- Create: `mothership/db/migrations/003_mothership_heartbeats.sql`
- Test: `test/mothership-server.test.mjs`
- Test: `test/mothership-store.test.mjs`
- Test: `test/mothership-db-migration.test.mjs`

- [ ] **Step 1: Add server test for `/v1/heartbeats`**

In `test/mothership-server.test.mjs`, extend the happy-path test:

```js
const heartbeatPayload = {
  schema_version: "private-beta-heartbeat-sync/v1",
  installId: "firm-beta-01",
  heartbeat: {
    schema_version: "private-beta-heartbeat/v1",
    id: "heartbeat_001",
    createdAt: "2026-06-13T10:00:00.000Z",
    telemetryMode: "firm_internal",
    activeSessions: 1,
    journeys: [{ user: "shivangi@lawzeus.com", currentStage: "extract_documents", patienceRisk: "high" }],
  },
};
const heartbeat = await postJson(app.baseUrl, "/v1/heartbeats", heartbeatPayload, "mwb_ing_test-token");
assert.equal(heartbeat.response.status, 202);
assert.equal(heartbeat.body.accepted, true);
```

Update fake store:

```js
ingestHeartbeat: async ({ installationId, heartbeat }) => {
  calls.push({ type: "heartbeat", installationId, heartbeat });
  return { inserted: !duplicate };
},
```

Update expected call sequence to include `"authorize", "heartbeat"`.

- [ ] **Step 2: Update mothership server**

Add constants:

```js
const HEARTBEAT_SYNC_SCHEMA = "private-beta-heartbeat-sync/v1";
```

Allow route:

```js
if (
  url.pathname !== "/v1/feedback"
  && url.pathname !== "/v1/signals"
  && url.pathname !== "/v1/metrics"
  && url.pathname !== "/v1/heartbeats"
) {
  throw httpError("Not found", 404);
}
```

Compute kind:

```js
const kind = url.pathname === "/v1/feedback"
  ? "feedback"
  : url.pathname === "/v1/signals"
    ? "signal"
    : url.pathname === "/v1/metrics"
      ? "metric"
      : "heartbeat";
```

Extend `validateSyncPayload` schema and item schema branches for heartbeat.

Extend `ingestPayload`:

```js
if (kind === "heartbeat") {
  return store.ingestHeartbeat({ installationId: payload.installId, heartbeat: payload.heartbeat });
}
```

- [ ] **Step 3: Add store test**

In `test/mothership-store.test.mjs`, add:

```js
test("store inserts heartbeat events and includes them in reports", async () => {
  const calls = [];
  const database = fakeDatabase({
    calls,
    query: async (text, values = []) => {
      calls.push({ text, values });
      if (/insert into mothership_heartbeat_events/i.test(text)) return { rowCount: 1, rows: [{ inserted: true }] };
      if (/from mothership_heartbeat_events/i.test(text)) {
        return { rows: [{
          installation_id: "firm-beta-01",
          heartbeat_id: "heartbeat_001",
          captured_at: new Date("2026-06-13T10:00:00.000Z"),
          received_at: new Date("2026-06-13T10:00:01.000Z"),
          payload: { id: "heartbeat_001", schema_version: "private-beta-heartbeat/v1", activeSessions: 1 },
        }] };
      }
      return { rowCount: 0, rows: [] };
    },
  });
  const store = createMothershipStore({ database });

  const heartbeat = {
    id: "heartbeat_001",
    schema_version: "private-beta-heartbeat/v1",
    createdAt: "2026-06-13T10:00:00.000Z",
    activeSessions: 1,
  };

  assert.equal((await store.ingestHeartbeat({ installationId: "firm-beta-01", heartbeat })).inserted, true);
  const report = await store.queryReport({ sinceDays: 7 });
  assert.equal(report.heartbeats.length, 1);
  assert.equal(report.heartbeats[0].heartbeat_id, "heartbeat_001");
});
```

- [ ] **Step 4: Add migration**

Create `mothership/db/migrations/003_mothership_heartbeats.sql`:

```sql
-- Operator-only heartbeat and journey telemetry snapshots.

CREATE TABLE IF NOT EXISTS mothership_heartbeat_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id text NOT NULL REFERENCES mothership_installations(installation_id) ON DELETE RESTRICT,
  heartbeat_id text NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  UNIQUE (installation_id, heartbeat_id)
);

CREATE INDEX IF NOT EXISTS mothership_heartbeat_events_received_at_idx
  ON mothership_heartbeat_events (received_at DESC);
CREATE INDEX IF NOT EXISTS mothership_heartbeat_events_installation_id_idx
  ON mothership_heartbeat_events (installation_id, received_at DESC);
```

- [ ] **Step 5: Update mothership store**

In `mothership/store.mjs`, add `ingestHeartbeat`, include heartbeats in `pruneExpired`, include heartbeats in `queryReport`, and return it from the store.

Use this insert:

```js
`insert into mothership_heartbeat_events
   (installation_id, heartbeat_id, captured_at, payload)
 values ($1, $2, $3::timestamptz, $4::jsonb)
 on conflict (installation_id, heartbeat_id) do update
 set captured_at = excluded.captured_at,
     received_at = now(),
     payload = excluded.payload
 returning id, (xmax = 0) as inserted`
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test test/mothership-server.test.mjs test/mothership-store.test.mjs test/mothership-db-migration.test.mjs
```

Expected: pass.

## Task 4: Report And Observability Summary

**Files:**
- Modify: `mothership/report.mjs`
- Modify: `services/private-beta-observability-service.mjs`
- Test: `test/mothership-report.test.mjs`
- Test: `test/private-beta-observability-service.test.mjs`

- [ ] **Step 1: Add report test**

In `test/mothership-report.test.mjs`, add a dataset with heartbeats:

```js
heartbeats: [{
  installation_id: "firm-beta-01",
  heartbeat_id: "heartbeat_001",
  captured_at: "2026-06-13T10:00:00.000Z",
  received_at: "2026-06-13T10:00:01.000Z",
  payload: {
    id: "heartbeat_001",
    activeSessions: 1,
    journeys: [{ user: "shivangi@lawzeus.com", matter: "Gionee", currentStage: "extract_documents", currentStageStatus: "failed", patienceRisk: "high" }],
    counters: { failedJobs: 1 },
  },
}],
```

Assert:

```js
assert.equal(report.summary.latestHeartbeatAgeMinutes, 0);
assert.equal(report.heartbeats.latestByInstallation[0].installationId, "firm-beta-01");
assert.equal(report.heartbeats.latestByInstallation[0].journeys[0].currentStage, "extract_documents");
```

- [ ] **Step 2: Update report builder**

In `mothership/report.mjs`, add:

```js
const heartbeatSummary = summarizeHeartbeats(dataset.heartbeats || [], generatedAt);
```

Add summary fields:

```js
latestHeartbeatAgeMinutes: heartbeatSummary.latestAgeMinutes,
silentInstallations: heartbeatSummary.silentInstallations,
```

Add top-level:

```js
heartbeats: heartbeatSummary,
```

Add markdown section after deployment metrics:

```js
if (report.heartbeats?.latestByInstallation?.length) {
  lines.push("## Heartbeats", "");
  for (const item of report.heartbeats.latestByInstallation.slice(0, 10)) {
    lines.push(`- ${item.installationId}: last seen ${item.lastSeenAt}; sessions ${item.activeSessions}; patience ${item.highestPatienceRisk}`);
  }
  lines.push("");
}
```

Add helpers: `summarizeHeartbeats`, `heartbeatSnapshot`, and `highestPatienceRisk`.

- [ ] **Step 3: Update observability service**

Add optional `heartbeatService` to `createPrivateBetaObservabilityService`.

Read ledger:

```js
const heartbeatLedger = await readLedger("heartbeats", () => heartbeatService?.listHeartbeats?.({ limit: 5 }));
```

Include:

```js
const heartbeats = Array.isArray(heartbeatLedger.heartbeats) ? heartbeatLedger.heartbeats : [];
latestHeartbeat: heartbeats[0] || null,
```

Add heartbeat to ledger error collection.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/mothership-report.test.mjs test/private-beta-observability-service.test.mjs
```

Expected: pass.

## Task 5: Verification And Documentation

**Files:**
- Modify: `docs/future-design-decisions/private-beta-feedback-capture.md`
- Modify: `docs/superpowers/specs/2026-06-10-private-beta-mothership-design.md`

- [ ] **Step 1: Mark heartbeat first implementation slice**

Update both docs to say the heartbeat push path has an implemented foundation if Tasks 1-4 pass. Keep external Mother pull checks marked planned.

- [ ] **Step 2: Run focused heartbeat suite**

Run:

```bash
node --test \
  test/private-beta-heartbeat-service.test.mjs \
  test/private-beta-telemetry-retry-service.test.mjs \
  test/mothership-server.test.mjs \
  test/mothership-store.test.mjs \
  test/mothership-db-migration.test.mjs \
  test/mothership-report.test.mjs \
  test/private-beta-observability-service.test.mjs
```

Expected: all pass.

- [ ] **Step 3: Run release gates**

Run:

```bash
npm test --silent
npm run ui:typecheck --silent
npm run ui:build --silent
git diff --check
```

Expected: all pass.

- [ ] **Step 4: Commit**

Stage only files touched by this heartbeat slice, not unrelated untracked review artifacts:

```bash
git add \
  services/private-beta-heartbeat-service.mjs \
  services/private-beta-telemetry-retry-service.mjs \
  server.mjs \
  mothership/server.mjs \
  mothership/store.mjs \
  mothership/db/migrations/003_mothership_heartbeats.sql \
  mothership/report.mjs \
  services/private-beta-observability-service.mjs \
  test/private-beta-heartbeat-service.test.mjs \
  test/private-beta-telemetry-retry-service.test.mjs \
  test/mothership-server.test.mjs \
  test/mothership-store.test.mjs \
  test/mothership-db-migration.test.mjs \
  test/mothership-report.test.mjs \
  test/private-beta-observability-service.test.mjs \
  docs/future-design-decisions/private-beta-feedback-capture.md \
  docs/superpowers/specs/2026-06-10-private-beta-mothership-design.md \
  docs/superpowers/plans/2026-06-13-heartbeat-journey-telemetry.md

git commit -m "Add private beta heartbeat telemetry plan and foundation"
```

## Out Of Scope

- No lawyer-facing UI changes.
- No source text, OCR text, generated legal output, raw documents, or secrets in heartbeat packets.
- No external pull monitor in this slice.
- No separate Mother VM provisioning in this code slice.
- No deployment to DigitalOcean in this code slice.

## Self-Review

- Spec coverage: app push heartbeat, local ledger, queued sync, mothership ingestion, reporting, and observability are covered. External pull checks remain explicitly out of scope.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: heartbeat schemas are `private-beta-heartbeat/v1`, `private-beta-heartbeat-sync/v1`, and `private-beta-heartbeat-ledger/v1` across service, server, store, report, and tests.

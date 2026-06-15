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
      matterHealth: [{
        matter: "Gionee India Pvt Ltd v Bharat Nagpal",
        prepareState: "complete",
        nextStepLabel: "Core preparation is current",
        attentionState: "clear",
        blockers: 0,
        warnings: 0,
        checkedAt: "2026-06-13T09:59:00.000Z",
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
  assert.equal(heartbeat.matterHealth[0].matter, "Gionee India Pvt Ltd v Bharat Nagpal");
  assert.equal(heartbeat.matterHealth[0].prepareState, "complete");
  assert.equal(heartbeat.matterHealth[0].attentionState, "clear");
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
        lastError: "OPENAI_API_KEY=sk-secret failed postgres://operator:heartpass@db:5432/mwb AIzaSyFixtureGoogleKeyValue",
        sourceText: "The contract says the client admitted liability.",
        generatedOutput: "Draft legal output body",
      }],
    }),
  });

  const heartbeat = await service.captureHeartbeat();
  const text = JSON.stringify(heartbeat);

  assert.match(text, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.match(text, /postgres:\/\/operator:\*\*\*@db:5432\/mwb/);
  assert.doesNotMatch(text, /sk-secret|heartpass|AIzaSyFixtureGoogleKeyValue/);
  assert.doesNotMatch(text, /admitted liability/);
  assert.doesNotMatch(text, /Draft legal output body/);
});

test("heartbeat service does not hold the store lock while waiting on providers", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-heartbeat-provider-lock-"));
  let releaseFirstProvider;
  let firstProviderStarted = false;
  let secondProviderCompleted = false;
  const service = createPrivateBetaHeartbeatService({
    appDir: tmp,
    heartbeatPath: path.join(tmp, "heartbeat-ledger.json"),
    installId: "firm-beta-01",
    idFactory: incrementingIds("heartbeat_"),
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    journeyProvider: () => {
      if (!firstProviderStarted) {
        firstProviderStarted = true;
        return new Promise((resolve) => {
          releaseFirstProvider = () => resolve({ activeSessions: 1 });
        });
      }
      return { activeSessions: 2 };
    },
  });

  const first = service.captureHeartbeat();
  await Promise.resolve();
  const second = service.captureHeartbeat().then((heartbeat) => {
    secondProviderCompleted = true;
    return heartbeat;
  });

  const secondHeartbeat = await second;

  assert.equal(secondProviderCompleted, true);
  assert.equal(secondHeartbeat.activeSessions, 2);

  releaseFirstProvider();
  const firstHeartbeat = await first;
  assert.equal(firstHeartbeat.activeSessions, 1);
});

function incrementingIds(prefix) {
  let index = 0;
  return () => `${prefix}${String(++index).padStart(3, "0")}`;
}

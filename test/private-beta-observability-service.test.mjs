import assert from "node:assert/strict";
import test from "node:test";

import { createPrivateBetaObservabilityService } from "../services/private-beta-observability-service.mjs";

test("observability reports ledger errors while preserving available evidence", async () => {
  const service = createPrivateBetaObservabilityService({
    feedbackService: {
      listFeedback: async () => {
        throw new Error("feedback ledger is corrupt token=sk-hidden");
      },
    },
    jobStatusService: {
      listJobs: async () => ({
        schema_version: "job-status-ledger/v1",
        jobs: [{
          id: "job_001",
          kind: "source_labels",
          label: "Label Sources",
          status: "failed",
          failureClass: "provider",
          matterName: "Edge Matter",
          errorMessage: "OpenRouter timeout",
          startedAt: "2026-06-12T08:00:00.000Z",
          finishedAt: "2026-06-12T08:01:00.000Z",
        }],
      }),
    },
    signalService: {
      listSignals: async () => ({ schema_version: "private-beta-signal-ledger/v1", signals: [] }),
    },
    metricsService: {
      listMetrics: async () => ({ schema_version: "private-beta-metrics-ledger/v1", metrics: [] }),
    },
    now: () => new Date("2026-06-12T08:05:00.000Z"),
  });

  const result = await service.readObservability({ limit: 10 });

  assert.equal(result.schema_version, "private-beta-observability/v1");
  assert.equal(result.summary.failedJobs, 1);
  assert.equal(result.failedJobs[0].id, "job_001");
  assert.equal(result.ledgerErrors.length, 1);
  assert.equal(result.ledgerErrors[0].source, "feedback");
  assert.match(result.ledgerErrors[0].message, /feedback ledger is corrupt/);
  assert.doesNotMatch(JSON.stringify(result), /sk-hidden/);
});

test("observability links feedback by nearby matter time without pulling stale jobs", async () => {
  const service = createPrivateBetaObservabilityService({
    feedbackService: {
      listFeedback: async () => ({
        schema_version: "private-beta-feedback-ledger/v1",
        feedback: [{
          id: "feedback_001",
          classification: "bug",
          choice: "did_not_work",
          status: "new",
          tryingToDo: "Prepare the matter",
          createdAt: "2026-06-12T09:00:00.000Z",
          context: { activeMatterName: "Nearby Matter" },
        }],
      }),
    },
    jobStatusService: {
      listJobs: async () => ({
        schema_version: "job-status-ledger/v1",
        jobs: [
          {
            id: "job_near",
            kind: "extract",
            label: "Extract Documents",
            status: "failed",
            failureClass: "storage",
            matterName: "Nearby Matter",
            errorMessage: "PDF read failed",
            startedAt: "2026-06-12T08:50:00.000Z",
            finishedAt: "2026-06-12T08:51:00.000Z",
          },
          {
            id: "job_stale",
            kind: "extract",
            label: "Extract Documents",
            status: "failed",
            failureClass: "storage",
            matterName: "Nearby Matter",
            errorMessage: "Old failure",
            startedAt: "2026-06-12T07:00:00.000Z",
            finishedAt: "2026-06-12T07:01:00.000Z",
          },
        ],
      }),
    },
  });

  const result = await service.readObservability({ limit: 10 });

  assert.deepEqual(result.feedbackEvidence[0].relatedJobs.map((job) => job.id), ["job_near"]);
});

test("observability survives total ledger outage and reports each failed source", async () => {
  const service = createPrivateBetaObservabilityService({
    feedbackService: { listFeedback: async () => { throw new Error("feedback failed password=hunter2"); } },
    jobStatusService: { listJobs: async () => { throw new Error("jobs failed OPENAI_API_KEY=sk-jobs"); } },
    signalService: { listSignals: async () => { throw new Error("signals failed token=sk-signals"); } },
    metricsService: { listMetrics: async () => { throw new Error("metrics failed secret=sk-metrics"); } },
    now: () => new Date("2026-06-12T10:00:00.000Z"),
  });

  const result = await service.readObservability({ limit: 10 });

  assert.equal(result.schema_version, "private-beta-observability/v1");
  assert.equal(result.summary.feedback, 0);
  assert.equal(result.summary.failedJobs, 0);
  assert.equal(result.summary.openSignals, 0);
  assert.equal(result.summary.ledgerErrors, 4);
  assert.deepEqual(result.ledgerErrors.map((error) => error.source), ["feedback", "jobs", "signals", "metrics"]);
  assert.doesNotMatch(JSON.stringify(result), /hunter2|sk-jobs|sk-signals|sk-metrics/);
});

test("observability treats malformed non-object ledgers as empty ledgers", async () => {
  const service = createPrivateBetaObservabilityService({
    feedbackService: { listFeedback: async () => null },
    jobStatusService: { listJobs: async () => "not-json" },
    signalService: { listSignals: async () => 42 },
    metricsService: { listMetrics: async () => [] },
  });

  const result = await service.readObservability({ limit: 10 });

  assert.equal(result.summary.feedback, 0);
  assert.equal(result.summary.failedJobs, 0);
  assert.equal(result.summary.openSignals, 0);
  assert.equal(result.summary.ledgerErrors, 0);
  assert.deepEqual(result.feedbackEvidence, []);
  assert.deepEqual(result.failedJobs, []);
  assert.deepEqual(result.signals, []);
});

test("observability links signals through related failed job ids", async () => {
  const service = createPrivateBetaObservabilityService({
    feedbackService: {
      listFeedback: async () => ({
        schema_version: "private-beta-feedback-ledger/v1",
        feedback: [{
          id: "feedback_002",
          classification: "bug",
          choice: "did_not_work",
          tryingToDo: "Run source labels",
          createdAt: "2026-06-12T11:00:00.000Z",
          context: { activeMatterName: "Matter With Job" },
        }],
      }),
    },
    jobStatusService: {
      listJobs: async () => ({
        schema_version: "job-status-ledger/v1",
        jobs: [{
          id: "job_signal_link",
          kind: "source_labels",
          label: "Label Sources",
          status: "failed",
          failureClass: "provider",
          matterName: "Matter With Job",
          startedAt: "2026-06-12T10:55:00.000Z",
          finishedAt: "2026-06-12T10:56:00.000Z",
        }],
      }),
    },
    signalService: {
      listSignals: async () => ({
        schema_version: "private-beta-signal-ledger/v1",
        signals: [{
          id: "signal_001",
          source: "job_status",
          severity: "error",
          title: "Provider failure",
          matterName: "Different Matter Name",
          lastSeenAt: "2026-06-12T10:56:00.000Z",
          details: { jobId: "job_signal_link" },
        }],
      }),
    },
  });

  const result = await service.readObservability({ limit: 10 });

  assert.deepEqual(result.feedbackEvidence[0].relatedJobs.map((job) => job.id), ["job_signal_link"]);
  assert.deepEqual(result.feedbackEvidence[0].relatedSignals.map((signal) => signal.id), ["signal_001"]);
});

test("observability groups failed jobs by diagnostic code before message text", async () => {
  const service = createPrivateBetaObservabilityService({
    feedbackService: {
      listFeedback: async () => ({ schema_version: "private-beta-feedback-ledger/v1", feedback: [] }),
    },
    jobStatusService: {
      listJobs: async () => ({
        schema_version: "job-status-ledger/v1",
        jobs: [
          {
            id: "job_extract_1",
            kind: "preparation_run",
            label: "Reading documents",
            status: "failed",
            failureClass: "provider",
            matterName: "Matter A",
            errorMessage: "Reading documents took too long.",
            metadata: { latestStage: { diagnostic: { code: "preparation.extract_timeout" } } },
            finishedAt: "2026-06-12T12:00:00.000Z",
          },
          {
            id: "job_extract_2",
            kind: "preparation_run",
            label: "Reading documents",
            status: "failed",
            failureClass: "provider",
            matterName: "Matter B",
            errorMessage: "The app may still be finishing in the background.",
            metadata: { latestStage: { diagnostic: { code: "preparation.extract_timeout" } } },
            finishedAt: "2026-06-12T12:01:00.000Z",
          },
        ],
      }),
    },
    signalService: {
      listSignals: async () => ({ schema_version: "private-beta-signal-ledger/v1", signals: [] }),
    },
  });

  const result = await service.readObservability({ limit: 10 });
  const extractProblem = result.topProblems.find((problem) => problem.code === "preparation.extract_timeout");

  assert.ok(extractProblem);
  assert.equal(extractProblem.occurrenceCount, 2);
  assert.equal(extractProblem.kind, "job_failed");
});

test("observability includes latest local heartbeat", async () => {
  const service = createPrivateBetaObservabilityService({
    feedbackService: {
      listFeedback: async () => ({ schema_version: "private-beta-feedback-ledger/v1", feedback: [] }),
    },
    jobStatusService: {
      listJobs: async () => ({ schema_version: "job-status-ledger/v1", jobs: [] }),
    },
    signalService: {
      listSignals: async () => ({ schema_version: "private-beta-signal-ledger/v1", signals: [] }),
    },
    metricsService: {
      listMetrics: async () => ({ schema_version: "private-beta-metrics-ledger/v1", metrics: [] }),
    },
    heartbeatService: {
      listHeartbeats: async () => ({
        schema_version: "private-beta-heartbeat-ledger/v1",
        heartbeats: [{
          id: "heartbeat_001",
          createdAt: "2026-06-13T10:00:00.000Z",
          activeSessions: 1,
          journeys: [{ currentStage: "extract_documents", patienceRisk: "high" }],
        }],
      }),
    },
  });

  const result = await service.readObservability({ limit: 10 });

  assert.equal(result.latestHeartbeat.id, "heartbeat_001");
  assert.equal(result.latestHeartbeat.journeys[0].currentStage, "extract_documents");
  assert.equal(result.summary.latestHeartbeatPatienceRisk, "high");
});

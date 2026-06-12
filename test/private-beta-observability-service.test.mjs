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

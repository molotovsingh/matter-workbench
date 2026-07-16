import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeDbProcessingJobStore,
  expireProcessingJobLeasesSql,
  normalizeRuntimeProcessingJobRow,
} from "../services/runtime-db-processing-job-store.mjs";

test("runtime DB processing job lease recovery fails exhausted jobs and bounds future claims", async () => {
  const queries = [];
  const client = {
    async query(text, values = []) {
      queries.push({ text: String(text), values });
      return { rows: [] };
    },
  };
  const store = createRuntimeDbProcessingJobStore({
    withRuntimeDbClient: async (operation) => operation(client),
  });

  const claimed = await store.claimNextProcessingJob({
    workerId: "worker-1",
    kinds: ["extract"],
    lockMs: 30_000,
  });

  assert.equal(claimed, null);
  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /status = case when attempt_count >= max_attempts then 'failed' else 'retrying' end/i);
  assert.match(queries[0].text, /finished_at = case when attempt_count >= max_attempts then now\(\) else null end/i);
  assert.match(queries[0].text, /processing\.lease_expired/i);
  assert.match(queries[0].text, /lock_expires_at < now\(\)/i);
  assert.match(queries[0].text, /status in \('queued', 'retrying'\)[\s\S]*attempt_count >= max_attempts/i);
  assert.match(queries[0].text, /processing\.attempts_exhausted/i);
  assert.match(queries[1].text, /attempt_count < max_attempts/i);
  assert.match(queries[1].text, /for update skip locked/i);
});

test("runtime DB processing job store keeps normalization and lease SQL independently testable", () => {
  const sql = expireProcessingJobLeasesSql();
  assert.doesNotMatch(sql, /status = 'retrying'/i);
  assert.match(sql, /locked_by = null/);

  assert.deepEqual(normalizeRuntimeProcessingJobRow({
    id: "job-1",
    matter_id: "matter-1",
    matter_name: "Matter A",
    kind: "extract",
    status: "failed",
    attempt_count: "3",
    max_attempts: "3",
    progress_json: '{"failedStage":"extract"}',
    finished_at: "2026-07-11T00:00:00.000Z",
    error_code: "processing.lease_expired",
  }), {
    id: "job-1",
    matterId: "matter-1",
    matterName: "Matter A",
    kind: "extract",
    status: "failed",
    idempotencyKey: "",
    attemptCount: 3,
    maxAttempts: 3,
    progress: { failedStage: "extract" },
    createdAt: "",
    updatedAt: "",
    startedAt: "",
    finishedAt: "2026-07-11T00:00:00.000Z",
    errorCode: "processing.lease_expired",
    errorMessage: "",
  });
});

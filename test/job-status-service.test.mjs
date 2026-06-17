import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createJobStatusService } from "../services/job-status-service.mjs";

test("job status service records a running job and completes it with durable evidence", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-status-"));
  const jobsPath = path.join(tmp, "job-status-ledger.json");
  const service = createJobStatusService({
    jobsPath,
    now: fixedClock([
      "2026-06-07T12:00:00.000Z",
      "2026-06-07T12:00:01.000Z",
    ]),
    idFactory: () => "job_001",
  });

  const result = await service.runTrackedJob({
    kind: "extract",
    label: "Extract Documents",
    matterName: "Atlas Construction vs Diptishree",
    operation: async ({ job }) => ({ state: "written", jobId: job.id }),
  });

  assert.equal(result.result.state, "written");
  assert.equal(result.job.id, "job_001");
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.job.kind, "extract");
  assert.equal(result.job.matterName, "Atlas Construction vs Diptishree");
  assert.equal(result.job.startedAt, "2026-06-07T12:00:00.000Z");
  assert.equal(result.job.finishedAt, "2026-06-07T12:00:01.000Z");
  assert.equal(existsSync(jobsPath), true);

  const listed = await service.listJobs({ matterName: "Atlas Construction vs Diptishree" });
  assert.equal(listed.schema_version, "job-status-ledger/v1");
  assert.equal(listed.jobs.length, 1);
  assert.equal(listed.jobs[0].id, "job_001");

  const store = JSON.parse(await readFile(jobsPath, "utf8"));
  assert.equal(store.jobs[0].status, "succeeded");
});

test("job status service fails closed and keeps secret-looking details out of the ledger", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-status-fail-"));
  const service = createJobStatusService({
    jobsPath: path.join(tmp, "job-status-ledger.json"),
    now: fixedClock([
      "2026-06-07T12:00:00.000Z",
      "2026-06-07T12:00:02.000Z",
    ]),
    idFactory: () => "job_failed",
  });

  await assert.rejects(
    () => service.runTrackedJob({
      kind: "custom_skill",
      label: "The Story",
      matterName: "Bharat Nagpal Vs Gionee India",
      operation: async () => {
        throw new Error("provider failed with OPENAI_API_KEY=sk-job-secret postgres://operator:jobpass@db:5432/mwb AIzaSyFixtureGoogleKeyValue");
      },
    }),
    /provider failed/,
  );

  const listed = await service.listJobs({ status: "failed" });
  assert.equal(listed.jobs.length, 1);
  assert.equal(listed.jobs[0].status, "failed");
  assert.match(listed.jobs[0].errorMessage, /\[redacted-secret\]/);
  assert.match(listed.jobs[0].errorMessage, /postgres:\/\/operator:\*\*\*@db:5432\/mwb/);
  assert.doesNotMatch(JSON.stringify(listed), /sk-job-secret|jobpass|AIzaSyFixtureGoogleKeyValue/);
});

test("job status service stores safe app error codes separately from messages", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-status-code-"));
  const service = createJobStatusService({
    jobsPath: path.join(tmp, "job-status-ledger.json"),
    now: fixedClock([
      "2026-06-07T12:00:00.000Z",
      "2026-06-07T12:00:02.000Z",
    ]),
    idFactory: () => "job_failed_code",
  });

  await assert.rejects(
    () => service.runTrackedJob({
      kind: "upload",
      label: "Create Matter",
      matterName: "State v Rajesh Mehra",
      failureErrorCode: "workflow.upload.failed",
      operation: async () => {
        const error = new Error("Attach at least one source file before creating a matter.");
        error.code = "upload.no_files_attached";
        throw error;
      },
    }),
    /Attach at least one source file/,
  );

  const listed = await service.listJobs({ status: "failed" });
  assert.equal(listed.jobs.length, 1);
  assert.equal(listed.jobs[0].errorCode, "upload.no_files_attached");
});

test("job status service applies fallback workflow failure codes and keeps diagnostic metadata", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-status-workflow-code-"));
  const service = createJobStatusService({
    jobsPath: path.join(tmp, "job-status-ledger.json"),
    now: fixedClock([
      "2026-06-07T12:00:00.000Z",
      "2026-06-07T12:00:02.000Z",
    ]),
    idFactory: () => "job_workflow_failed",
  });

  await assert.rejects(
    () => service.runTrackedJob({
      kind: "extract",
      label: "Extract Documents",
      matterName: "State v Rajesh Mehra",
      metadata: {
        workflow: {
          stage: "extract",
          route: "/api/extract",
          label: "Extract Documents",
        },
      },
      failureErrorCode: "workflow.extract.failed",
      operation: async () => {
        throw new Error("Source folder is missing");
      },
    }),
    /Source folder is missing/,
  );

  const listed = await service.listJobs({ status: "failed" });
  assert.equal(listed.jobs.length, 1);
  assert.equal(listed.jobs[0].errorCode, "workflow.extract.failed");
  assert.equal(listed.jobs[0].failureClass, "user_action_needed");
  assert.deepEqual(listed.jobs[0].metadata.workflow, {
    stage: "extract",
    route: "/api/extract",
    label: "Extract Documents",
  });
});

test("job status service lists newest jobs with matter, kind, and status filters", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-status-list-"));
  const service = createJobStatusService({
    jobsPath: path.join(tmp, "job-status-ledger.json"),
    now: fixedClock([
      "2026-06-07T12:00:00.000Z",
      "2026-06-07T12:00:01.000Z",
      "2026-06-07T12:00:02.000Z",
      "2026-06-07T12:00:03.000Z",
    ]),
    idFactory: incrementingIds("job_"),
  });

  await service.runTrackedJob({
    kind: "intake",
    label: "Set Up Matter",
    matterName: "Matter A",
    operation: async () => ({}),
  });
  await service.runTrackedJob({
    kind: "custom_skill",
    label: "The Story",
    matterName: "Matter B",
    operation: async () => ({}),
  });

  const byKind = await service.listJobs({ kind: "custom_skill" });
  assert.deepEqual(byKind.jobs.map((job) => job.label), ["The Story"]);

  const byMatter = await service.listJobs({ matterName: "Matter A" });
  assert.deepEqual(byMatter.jobs.map((job) => job.kind), ["intake"]);

  const limited = await service.listJobs({ limit: 1 });
  assert.equal(limited.jobs.length, 1);
  assert.equal(limited.jobs[0].label, "The Story");
});

test("job status service marks abandoned running jobs failed when listed", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-status-stale-"));
  const service = createJobStatusService({
    jobsPath: path.join(tmp, "job-status-ledger.json"),
    staleRunningJobMs: 60_000,
    now: fixedClock([
      "2026-06-07T12:00:00.000Z",
      "2026-06-07T12:02:00.000Z",
      "2026-06-07T12:02:01.000Z",
    ]),
    idFactory: () => "job_stale",
  });

  await service.createJob({
    kind: "source_labels",
    label: "Label Sources",
    matterName: "State v Rajesh Mehra",
  });

  const listed = await service.listJobs({ matterName: "State v Rajesh Mehra" });
  assert.equal(listed.jobs.length, 1);
  assert.equal(listed.jobs[0].status, "failed");
  assert.match(listed.jobs[0].errorMessage, /stale running job/i);
  assert.equal(listed.jobs[0].finishedAt, "2026-06-07T12:02:00.000Z");

  const listedAgain = await service.listJobs({ matterName: "State v Rajesh Mehra" });
  assert.equal(listedAgain.jobs[0].finishedAt, "2026-06-07T12:02:00.000Z");
});

function fixedClock(values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

function incrementingIds(prefix) {
  let index = 0;
  return () => `${prefix}${String(++index).padStart(3, "0")}`;
}

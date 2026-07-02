import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createJobStatusService } from "../services/job-status-service.mjs";
import { createSkillRunnerService } from "../services/skill-runner-service.mjs";

const DEMO_RUNNER = {
  id: "demo_skill",
  version: 1,
  kind: "demo_skill",
  label: "Demo Skill",
  async run({ job, stages }) {
    await stages.startStage(job.id, { id: "build_packet", label: "Build packet" });
    await stages.succeedStage(job.id, { id: "build_packet", summary: "Packet ready" });
    return {
      state: "written",
      outputPaths: {
        markdown: "20_Workshop/Demo.md",
        json: "20_Workshop/Demo.json",
      },
      outputAvailability: {
        markdown: "present",
        json: "present",
      },
      warnings: ["Reviewed with generated-stage caveats"],
    };
  },
};

test("skill runner service can execute an operation inline and return a terminal receipt", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-skill-runner-inline-"));
  const jobStatusService = createJobStatusService({
    jobsPath: path.join(tmp, "jobs.json"),
    now: fixedClock([
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:01.000Z",
      "2026-07-01T00:00:02.000Z",
      "2026-07-01T00:00:03.000Z",
    ]),
    idFactory: () => "job_inline",
  });
  const runnerService = createSkillRunnerService({
    jobStatusService,
    runners: { "/demo_skill": DEMO_RUNNER },
    now: fixedClock([
      "2026-07-01T00:00:01.000Z",
      "2026-07-01T00:00:02.000Z",
    ]),
  });

  const result = await runnerService.start({
    slash: "/demo_skill",
    request: { matterName: "Matter A" },
    mode: "inline",
    metadata: {
      workflow: {
        stage: "demo_skill",
        route: "/api/demo-skill",
      },
    },
  });

  assert.equal(result.queued, false);
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.job.metadata.workflow.route, "/api/demo-skill");
  assert.equal(result.job.metadata.skill.slash, "/demo_skill");
  assert.equal(result.receipt.state, "succeeded");
  assert.equal(result.receipt.runId, "job_inline");
  assert.deepEqual(result.receipt.stages.map((stage) => stage.id), ["build_packet"]);
  assert.equal(result.receipt.outputFileStatus, "present");
});

test("skill runner service reports missing retry source jobs as stable 404s", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-skill-runner-retry-missing-"));
  const runnerService = createSkillRunnerService({
    jobStatusService: createJobStatusService({ jobsPath: path.join(tmp, "jobs.json") }),
    runners: { "/demo_skill": DEMO_RUNNER },
  });

  await assert.rejects(
    () => runnerService.retry({ failedRunId: "job_missing", slash: "/demo_skill", mode: "inline" }),
    (error) => error?.statusCode === 404 && error?.code === "native_skill.retry_source_not_found",
  );
});

test("skill runner service can start an operation through a fake queued worker", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-skill-runner-queued-"));
  const queued = [];
  const jobStatusService = createJobStatusService({
    jobsPath: path.join(tmp, "jobs.json"),
    now: fixedClock([
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:01.000Z",
      "2026-07-01T00:00:02.000Z",
      "2026-07-01T00:00:03.000Z",
    ]),
    idFactory: () => "job_queued",
  });
  const runnerService = createSkillRunnerService({
    jobStatusService,
    runners: { "/demo_skill": DEMO_RUNNER },
    dispatch: async (payload) => queued.push(payload),
    now: fixedClock([
      "2026-07-01T00:00:01.000Z",
      "2026-07-01T00:00:02.000Z",
    ]),
  });

  const started = await runnerService.start({
    slash: "/demo_skill",
    request: { matterName: "Matter B" },
    mode: "queued",
  });

  assert.equal(started.queued, true);
  assert.equal(started.job.status, "running");
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0], {
    runId: "job_queued",
    slash: "/demo_skill",
    request: { matterName: "Matter B" },
  });

  const executed = await runnerService.execute(queued[0]);
  assert.equal(executed.job.status, "succeeded");
  assert.deepEqual(executed.job.outputPaths, {
    markdown: "20_Workshop/Demo.md",
    json: "20_Workshop/Demo.json",
  });
  assert.equal(executed.receipt.state, "succeeded");
  assert.equal(executed.receipt.matterName, "Matter B");

  const reconstructed = await runnerService.getReceipt({ runId: "job_queued" });
  assert.equal(reconstructed.state, "succeeded");
  assert.equal(reconstructed.outputFileStatus, "present");
  assert.deepEqual(reconstructed.warnings, ["Reviewed with generated-stage caveats"]);
});

function fixedClock(values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

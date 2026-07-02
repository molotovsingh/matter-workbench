import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createJobStatusService } from "../services/job-status-service.mjs";
import { createSkillRunnerService } from "../services/skill-runner-service.mjs";
import { createListOfDatesRunner } from "../skills/builtins/create_listofdates/runner.mjs";
import {
  listOfDatesEntry,
  prepareExtractedMatter,
} from "../test-support/listofdates-fixtures.mjs";

test("List of Dates runner records native skill stages and durable output receipt", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-listofdates-runner-"));
  const matterRoot = await prepareExtractedMatter();
  const jobStatusService = createJobStatusService({
    jobsPath: path.join(tmp, "jobs.json"),
    idFactory: () => "job_listofdates_runner",
  });
  const runner = createListOfDatesRunner({
    aiProvider: async ({ chunk }) => ({
      entries: [listOfDatesEntry({ citation: chunk[0].citation })],
    }),
    env: {},
  });
  const runnerService = createSkillRunnerService({
    jobStatusService,
    runners: { [runner.slash]: runner },
  });

  const run = await runnerService.start({
    slash: "/create_listofdates",
    request: { matterName: "Mehta vs Skyline", matterRoot },
    mode: "inline",
  });

  assert.equal(run.job.status, "succeeded");
  assert.equal(run.job.kind, "list_of_dates");
  assert.equal(run.job.metadata.skill.slash, "/create_listofdates");
  assert.equal(run.job.metadata.skill.stageRetrySupported, false);
  assert.deepEqual(run.job.stages.map((stage) => stage.id), ["build_packet", "generate", "validate", "persist"]);
  assert.equal(run.job.stages[1].status, "succeeded");
  assert.equal(run.job.stages[1].salvageable, true);
  assert.equal(run.receipt.slash, "/create_listofdates");
  assert.equal(run.receipt.outputPaths.markdown, "10_Library/List of Dates.md");
  assert.equal(run.receipt.outputFileStatus, "present");
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createJobStatusService } from "../services/job-status-service.mjs";
import { createSkillRunnerService } from "../services/skill-runner-service.mjs";
import { createProceduralPostureDiagnosisRunner } from "../skills/builtins/procedural_posture_diagnosis/runner.mjs";

function store(root) {
  return {
    ensureMatterRoot: () => root,
    resolveExistingMatter: async () => ({ matterPath: root }),
  };
}

async function matterRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "posture-runner-"));
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await mkdir(path.join(root, "20_Workshop"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), `${JSON.stringify({
    matter_name: "Taori vs Roma Builder",
    client_name: "Taori",
    opposite_party: "Roma Builder",
    matter_type: "Civil",
    jurisdiction: "India",
  }, null, 2)}\n`);
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# Case Timeline\n\n| Date | Event | Legal Relevance | Source |\n| --- | --- | --- | --- |\n| 2026-01-01 | Notice issued. | Records notice. | Notice |\n");
  await writeFile(path.join(root, "10_Library", "List of Dates.json"), `${JSON.stringify({
    schema_version: "list-of-dates/v1",
    entries: [{ date_iso: "2026-01-01", event: "Notice issued.", legal_relevance: "Records notice before filing.", citation: "FILE-0001 p1.b1" }],
  }, null, 2)}\n`);
  await writeFile(path.join(root, "10_Library", "Source Index.json"), `${JSON.stringify({
    schema_version: "source-index/v1",
    sources: [{ file_id: "FILE-0001", source_label: "Notice" }],
  }, null, 2)}\n`);
  await writeFile(path.join(root, "20_Workshop", "The Story.md"), "# The Story\n\nAt a glance\nThe matter concerns a notice and possible response filing.\n");
  return root;
}

const contextPacket = {
  schema_version: "matter-context/v1",
  matter: { matter_name: "Taori vs Roma Builder", client_name: "Taori" },
  sources: [{ file_id: "FILE-0001", source_label: "Notice", sample_citations: ["FILE-0001 p1.b1"] }],
  evidence_blocks: [{ citation: "FILE-0001 p1.b1", source_label: "Notice", text: "Notice issued on 1 January 2026." }],
  library_artifacts: [{
    kind: "list_of_dates",
    path: "10_Library/List of Dates.json",
    entry_count: 1,
    entries: [{ date_iso: "2026-01-01", event: "Notice issued.", legal_relevance: "Records notice before filing.", citation: "FILE-0001 p1.b1" }],
  }],
  warnings: [],
};

test("procedural posture runner attributes provider JSON failure to finalizer stage", async () => {
  const root = await matterRoot();
  const calls = [];
  const aiProviderService = {
    resolveTask: () => ({ providerConfig: { provider: "openai-direct" } }),
    invoke: async ({ label }) => {
      calls.push(label);
      if (label.includes("finalizer")) {
        const error = new Error("Unexpected end of JSON input");
        error.code = "provider.invalid_json";
        throw error;
      }
      return {
        parsed: label.includes("critic")
          ? { verdict: "usable_with_revisions", risk_level: "medium", critique_points: ["Keep forum provisional."] }
          : { short_diagnosis: "Draft diagnosis" },
        aiRun: { provider: "openai-direct", model: label.includes("critic") ? "o3" : "gpt-5.5" },
      };
    },
  };
  const jobStatusService = createJobStatusService({
    jobsPath: path.join(root, ".jobs.json"),
    now: fixedClock([
      "2026-07-01T01:31:35.000Z",
      "2026-07-01T01:31:36.000Z",
      "2026-07-01T01:31:37.000Z",
      "2026-07-01T01:31:38.000Z",
      "2026-07-01T01:31:39.000Z",
      "2026-07-01T01:31:40.000Z",
      "2026-07-01T01:31:41.000Z",
      "2026-07-01T01:31:42.000Z",
      "2026-07-01T01:31:43.000Z",
      "2026-07-01T01:31:44.000Z",
      "2026-07-01T01:31:45.000Z",
    ]),
    idFactory: () => "job_posture_runner_failed",
  });
  const postureRunner = createProceduralPostureDiagnosisRunner({
    matterStore: store(root),
    aiProviderService,
  });
  const runnerService = createSkillRunnerService({
    jobStatusService,
    runners: { "/procedural_posture_diagnosis": postureRunner },
    now: fixedClock([
      "2026-07-01T01:31:36.000Z",
      "2026-07-01T01:31:37.000Z",
      "2026-07-01T01:31:38.000Z",
      "2026-07-01T01:31:39.000Z",
      "2026-07-01T01:31:40.000Z",
      "2026-07-01T01:31:41.000Z",
      "2026-07-01T01:31:42.000Z",
      "2026-07-01T01:31:43.000Z",
    ]),
  });

  const result = await runnerService.start({
    slash: "/procedural_posture_diagnosis",
    request: {
      overwrite: true,
      matterContextPacketOverride: contextPacket,
    },
    mode: "inline",
  });

  assert.deepEqual(calls, [
    "posture diagnosis proposer",
    "posture diagnosis critic",
    "posture diagnosis finalizer",
  ]);
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.errorCode, "provider.invalid_json");
  assert.equal(result.job.failureClass, "provider");
  assert.equal(result.receipt.failure.stageId, "finalizer");
  assert.deepEqual(result.receipt.failure.salvageableStageIds, ["build_packet", "proposer", "critic"]);
  assert.equal(result.receipt.recovery.action, "retry_stage");
  assert.equal(result.receipt.recovery.retryStageId, "finalizer");
  assert.deepEqual(result.job.stages.map((stage) => [stage.id, stage.status]), [
    ["build_packet", "succeeded"],
    ["proposer", "succeeded"],
    ["critic", "succeeded"],
    ["finalizer", "failed"],
  ]);
  assert.equal(result.job.stages.find((stage) => stage.id === "proposer").salvageable, true);
  assert.equal(result.job.stages.find((stage) => stage.id === "critic").salvageable, true);
});

function fixedClock(values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

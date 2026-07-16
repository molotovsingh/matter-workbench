import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createJobStatusService } from "../services/job-status-service.mjs";
import { createNativeSkillRunStateService } from "../services/native-skill-run-state-service.mjs";
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
  await writeFile(path.join(root, "10_Library", "Case Timeline.md"), "# Case Timeline\n\n| Date | Event | Legal Relevance | Source |\n| --- | --- | --- | --- |\n| 2026-01-01 | Notice issued. | Records notice. | Notice |\n");
  await writeFile(path.join(root, "10_Library", "Case Timeline.json"), `${JSON.stringify({
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
    path: "10_Library/Case Timeline.json",
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

test("procedural posture runner can retry finalizer from durable stage state", async () => {
  const root = await matterRoot();
  let finalizerAttempts = 0;
  const calls = [];
  const aiProviderService = {
    resolveTask: () => ({ providerConfig: { provider: "openai-direct" } }),
    invoke: async ({ label }) => {
      calls.push(label);
      if (label.includes("finalizer")) {
        finalizerAttempts += 1;
        if (finalizerAttempts <= 2) {
          const error = new Error("Unexpected end of JSON input");
          error.code = "provider.invalid_json";
          throw error;
        }
        return {
          parsed: finalDiagnosisFixture(),
          aiRun: { provider: "openai-direct", model: "gpt-5.5" },
        };
      }
      return {
        parsed: label.includes("critic")
          ? { verdict: "usable_with_revisions", risk_level: "medium", critique_points: ["Keep forum provisional."] }
          : { short_diagnosis: "Draft diagnosis", possible_filings: [] },
        aiRun: { provider: "openai-direct", model: label.includes("critic") ? "o3" : "gpt-5.5" },
      };
    },
  };
  let jobNumber = 0;
  const jobStatusService = createJobStatusService({
    jobsPath: path.join(root, ".jobs-retry.json"),
    idFactory: () => `job_posture_retry_${++jobNumber}`,
  });
  const runState = createNativeSkillRunStateService({
    statePath: path.join(root, ".native-run-state.json"),
  });
  const postureRunner = createProceduralPostureDiagnosisRunner({
    matterStore: store(root),
    aiProviderService,
  });
  const runnerService = createSkillRunnerService({
    jobStatusService,
    nativeRunStateService: runState,
    runners: { "/procedural_posture_diagnosis": postureRunner },
  });

  const failed = await runnerService.start({
    slash: "/procedural_posture_diagnosis",
    request: {
      overwrite: true,
      matterContextPacketOverride: contextPacket,
    },
    mode: "inline",
  });
  assert.equal(failed.job.status, "failed");
  assert.equal(failed.receipt.recovery.retryStageId, "finalizer");

  const retried = await runnerService.retry({
    failedRunId: failed.runId,
    retryStageId: "finalizer",
    request: {
      overwrite: true,
      matterContextPacketOverride: contextPacket,
    },
    mode: "inline",
  });

  assert.equal(retried.job.status, "succeeded");
  assert.equal(retried.receipt.state, "succeeded");
  assert.deepEqual(calls, [
    "posture diagnosis proposer",
    "posture diagnosis critic",
    "posture diagnosis finalizer",
    "posture diagnosis finalizer",
    "posture diagnosis finalizer",
  ]);
  assert.equal(retried.job.metadata.retry.ofRunId, failed.runId);
  assert.equal(retried.job.metadata.retry.retryStageId, "finalizer");
  assert.deepEqual(retried.job.stages.map((stage) => [stage.id, stage.status]), [
    ["build_packet", "succeeded"],
    ["proposer", "skipped"],
    ["critic", "skipped"],
    ["finalizer", "succeeded"],
    ["validate", "succeeded"],
    ["persist", "succeeded"],
  ]);
  assert.deepEqual(
    (await runState.listRunStageStates(retried.runId)).map((entry) => entry.stageId).sort(),
    ["build_packet", "critic", "finalizer", "proposer"],
  );
});

function finalDiagnosisFixture() {
  return {
    schema_version: "posture_diagnosis_final/v1",
    status: "provisional_mw_inferred",
    short_diagnosis: "The record suggests a pre-filing notice-response posture, subject to lawyer confirmation.",
    simple_case_view: "This looks like a notice-led civil matter and needs lawyer confirmation before filing.",
    court_forum: {
      value: "Civil court / appropriate forum to be confirmed",
      confidence: "medium",
      why: "The supplied record shows a notice but no filed proceeding.",
      source_refs: ["FILE-0001 p1.b1"],
      lawyer_to_confirm: "Confirm forum and jurisdiction.",
    },
    procedural_posture: {
      value: "Pre-filing / response to notice",
      confidence: "high",
      why: "The record shows notice but no proceeding number or order.",
      source_refs: ["FILE-0001 p1.b1"],
      lawyer_to_confirm: "Confirm no proceeding has already been filed.",
    },
    possible_filings: [{
      priority: "primary",
      filing_or_remedy: "Notice response or pre-filing strategy note",
      reason: "The visible record is notice-led and does not show an existing case.",
      key_facts: ["Notice issued on 1 January 2026"],
      caveats: ["Forum and limitation require lawyer review"],
      source_refs: ["FILE-0001 p1.b1"],
    }],
    recommended_working_path: {
      priority: "primary",
      filing_or_remedy: "Confirm posture before drafting a notice response",
      reason: "The next step depends on whether a proceeding exists outside the supplied record.",
      key_facts: ["No proceeding is visible"],
      caveats: ["Lawyer must confirm"],
      source_refs: ["FILE-0001 p1.b1"],
    },
    legal_routes: [{
      route_number: 1,
      route_title: "Confirm live status and complete record",
      route_summary: "Confirm whether a proceeding exists before choosing a filing.",
      when_to_use: "the current record shows a notice but no proceeding number",
      why_this_route: "the next step depends on the live posture",
      court_or_forum: "Civil court / appropriate forum to be confirmed",
      statutory_references: ["Verify limitation and civil procedure before filing"],
      what_to_confirm: ["Whether proceedings exist", "Forum and limitation"],
      priority: "primary",
    }],
    recommended_route: {
      route_number: 1,
      route_title: "Confirm live status and complete record",
      recommendation: "Confirm procedural status before drafting.",
      reason: "The supplied record does not show a filed proceeding.",
      next_step: "Check case status, forum, limitation, and complete source papers.",
    },
    next_best_actions: ["Confirm whether proceedings exist", "Confirm forum and limitation"],
    governing_law: [{ text: "Civil procedure and limitation require counsel confirmation.", source_refs: ["FILE-0001 p1.b1"] }],
    central_facts: [{ text: "Notice issued on 1 January 2026.", source_refs: ["FILE-0001 p1.b1"] }],
    adverse_or_difficult_facts: [{ text: "No filed proceeding is visible in the supplied record.", source_refs: ["FILE-0001 p1.b1"] }],
    missing_information: ["Forum, limitation, and live filing status."],
    lawyer_to_confirm: ["Confirm live case status before filing."],
    internal_source_handles: ["FILE-0001 p1.b1"],
    critique_handling: [{ critique_signal: "Keep forum provisional.", disposition: "accepted", reason: "Forum remains subject to confirmation." }],
  };
}

function fixedClock(values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

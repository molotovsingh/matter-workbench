import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_SKILL_RUN_RECEIPT_SCHEMA_VERSION,
  deriveNativeSkillRunReceipt,
} from "../shared/native-skill-run-receipts.mjs";

test("native skill receipt attributes provider failures to the failed stage", () => {
  const receipt = deriveNativeSkillRunReceipt({
    slash: "/procedural_posture_diagnosis",
    skillId: "procedural_posture_diagnosis",
    job: {
      id: "job_posture_failed",
      kind: "posture_diagnosis",
      status: "failed",
      matterName: "Taori vs Roma Builder",
      startedAt: "2026-07-01T01:31:35.892Z",
      finishedAt: "2026-07-01T01:35:11.644Z",
      errorCode: "provider.invalid_json",
      failureClass: "provider",
      errorMessage: "Unexpected end of JSON input",
      stages: [
        { id: "build_packet", status: "succeeded", durationMs: 1200, salvageable: true },
        { id: "proposer", status: "succeeded", durationMs: 90000, provider: "openai-direct", model: "gpt-5.5", salvageable: true },
        { id: "critic", status: "succeeded", durationMs: 78000, provider: "openai-direct", model: "o3", salvageable: true },
        {
          id: "finalizer",
          status: "failed",
          durationMs: 46000,
          provider: "openai-direct",
          model: "gpt-5.5",
          failureCode: "provider.invalid_json",
          failureClass: "provider",
          errorMessage: "Unexpected end of JSON input",
        },
      ],
    },
    outputPaths: {
      markdown: "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md",
      json: "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.json",
    },
  });

  assert.equal(receipt.schema_version, NATIVE_SKILL_RUN_RECEIPT_SCHEMA_VERSION);
  assert.equal(receipt.runId, "job_posture_failed");
  assert.equal(receipt.state, "failed");
  assert.equal(receipt.failure.code, "provider.invalid_json");
  assert.equal(receipt.failure.class, "provider");
  assert.equal(receipt.failure.stageId, "finalizer");
  assert.equal(receipt.failure.retryable, true);
  assert.deepEqual(receipt.failure.salvageableStageIds, ["build_packet", "proposer", "critic"]);
  assert.deepEqual(receipt.recovery, {
    action: "retry_stage",
    retryStageId: "finalizer",
    reason: "provider.invalid_json",
  });
  assert.deepEqual(receipt.stages.map((stage) => stage.id), ["build_packet", "proposer", "critic", "finalizer"]);
});

test("native skill receipt treats insufficient record as successful review work", () => {
  const receipt = deriveNativeSkillRunReceipt({
    slash: "/procedural_posture_diagnosis",
    skillId: "procedural_posture_diagnosis",
    state: "insufficient_record",
    job: {
      id: "job_posture_insufficient",
      kind: "posture_diagnosis",
      status: "succeeded",
      resultState: "insufficient_record",
      matterName: "Thin Record Matter",
      stages: [
        { id: "build_packet", status: "succeeded", salvageable: true },
        { id: "validate", status: "succeeded", summary: "Record lacks filing forum evidence" },
        { id: "persist", status: "succeeded" },
      ],
    },
    outputPaths: {
      markdown: "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md",
      json: "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.json",
    },
    outputAvailability: {
      markdown: "present",
      json: "present",
    },
  });

  assert.equal(receipt.state, "insufficient_record");
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.failure, undefined);
  assert.deepEqual(receipt.recovery, {
    action: "review_questions",
    reason: "insufficient_record",
  });
  assert.equal(receipt.outputFileStatus, "present");
});

test("native skill receipt redacts secret-looking failure details defensively", () => {
  const receipt = deriveNativeSkillRunReceipt({
    slash: "/procedural_posture_diagnosis",
    skillId: "procedural_posture_diagnosis",
    job: {
      id: "job_secret_failure",
      kind: "posture_diagnosis",
      status: "failed",
      errorCode: "provider.invalid_json",
      errorMessage: "OPENAI_API_KEY=sk-receipt-secret",
      stages: [
        {
          id: "finalizer",
          status: "failed",
          failureCode: "provider.invalid_json",
          failureClass: "provider",
          errorMessage: "Bearer sk-stage-receipt-secret",
        },
      ],
    },
    warnings: ["OPENROUTER_API_KEY=sk-warning-receipt-secret"],
  });

  const serialized = JSON.stringify(receipt);
  assert.match(serialized, /\[redacted-secret\]/);
  assert.doesNotMatch(serialized, /sk-receipt-secret|sk-stage-receipt-secret|sk-warning-receipt-secret/);
});

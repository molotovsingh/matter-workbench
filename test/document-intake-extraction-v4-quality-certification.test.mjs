import assert from "node:assert/strict";
import test from "node:test";

import { evaluateQualityCertification } from "../services/document-intake-extraction/readiness/quality-certification.mjs";

const POLICY = {
  thresholdApprovalId: "quality-threshold-review-2026-08-24",
  maximumWer: 0.02,
  maximumCer: 0.01,
  qualityWeight: 0.7,
  speedWeight: 0.3,
};

// V4-QUALITY-001 tooling evidence only; the expanded human-adjudicated manifest remains pending.
test("quality certification applies completeness and legal fields before 70/30 quality-speed ranking", () => {
  const samples = goldenSamples();
  const certification = evaluateQualityCertification({
    policy: POLICY,
    samples,
    arms: [
      arm("mistral", { provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "range/v1" }, samples, { wordErrors: 1, characterErrors: 1, durationMs: 100 }),
      arm("gemini", { provider: "google", model: "gemini-3.7-flash", adapterVersion: "page/v1" }, samples, { wordErrors: 0, characterErrors: 0, durationMs: 300 }),
    ],
  });
  assert.equal(certification.certified, true);
  assert.deepEqual(certification.evidence.classCounts, { repair_disagreement: 15, native: 10, difficult: 10 });
  assert.equal(certification.arms.every((candidate) => candidate.hardGatesPassed), true);
  assert.equal(certification.recommendedCapability.model, "mistral-ocr-4-1");
});

test("quality certification fails on incomplete human classes or legal-critical field loss", () => {
  const samples = goldenSamples().slice(0, 20);
  samples[0] = { ...samples[0], humanVerified: false, adjudicatorCount: 1 };
  const broken = arm("broken", { provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "range/v1" }, samples, {
    wordErrors: 0, characterErrors: 0, durationMs: 100,
  });
  broken.measurements[0].criticalMatched = 1;
  const certification = evaluateQualityCertification({ policy: POLICY, samples, arms: [broken] });
  assert.equal(certification.certified, false);
  assert.ok(certification.reasons.includes("golden_class_minimum_not_met"));
  assert.ok(certification.reasons.includes("golden_sample_not_final"));
  assert.ok(certification.reasons.includes("repair_disagreement_not_dual_adjudicated"));
  assert.ok(certification.reasons.includes("no_candidate_passed_hard_gates"));
  assert.ok(certification.arms[0].reasons.includes("legal_critical_field_loss"));
  assert.equal(certification.arms[0].compositeScore, null);
});

function goldenSamples() {
  const classes = [
    ...Array(15).fill("repair_disagreement"),
    ...Array(10).fill("native"),
    ...Array(10).fill("difficult"),
  ];
  return classes.map((sampleClass, index) => ({
    sampleId: `gold-${index + 1}`,
    sampleClass,
    sourcePageSha256: (index + 1).toString(16).padStart(64, "0"),
    humanVerified: true,
    adjudicationStatus: "final",
    adjudicatorCount: sampleClass === "repair_disagreement" ? 2 : 1,
  }));
}

function arm(armId, capability, samples, metrics) {
  return {
    armId,
    capability,
    measurements: samples.map((sample) => ({
      sampleId: sample.sampleId,
      totalWords: 100,
      wordErrors: metrics.wordErrors,
      totalCharacters: 1000,
      characterErrors: metrics.characterErrors,
      criticalExpected: 2,
      criticalMatched: 2,
      durationMs: metrics.durationMs,
      omitted: false,
      finishReason: "complete",
    })),
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyActiveSampleState,
  ensureSampleReview,
  findSampleByVersion,
  formatSkillSampleCopy,
  getLedgerSamples,
  getSampleId,
  getSampleState,
  markSampleReviewStale,
  renderSampleLedger,
} from "../frontend/skill-sample-review.js";

const sampleV1 = {
  sample_id: "sample_1",
  version: 1,
  state: "approved_stale",
  approved: true,
  current: false,
  generated_at: "2026-05-14T10:00:00.000Z",
  matter: {
    matter_name: "Ayesha Vs Japan Airlines",
    folder_name: "Ayesha Vs Japan Airlines",
  },
  ai_run: {
    provider: "openai-direct",
    model: "gpt-5.4",
    policyPromptVersion: "legal-workbench-policy/v1",
  },
  feedback: "Make this more specific.",
  sample_markdown: "## Old sample",
  warnings: ["Earlier packet omitted evidence blocks."],
};

const sampleV2 = {
  sample_id: "sample_2",
  version: 2,
  state: "approved_current",
  approved: true,
  current: true,
  generated_at: "2026-05-14T11:00:00.000Z",
  matter: {
    matter_name: "Mehta vs Skyline",
  },
  ai_run: {
    provider: "openai-direct",
    model: "gpt-5.4",
    policyPromptVersion: "legal-workbench-policy/v1",
  },
  sample_markdown: "## Current sample",
};

test("sample review helpers merge and sort ledger samples by version", () => {
  const ledger = getLedgerSamples({
    activeSample: sampleV2,
    samples: [sampleV1],
    ledger: [sampleV1, sampleV2],
  });

  assert.deepEqual(ledger.map(getSampleId), ["sample_1", "sample_2"]);
  assert.equal(findSampleByVersion({ ledger }, 2)?.sample_id, "sample_2");
  assert.equal(findSampleByVersion({ ledger }, 2)?.ai_run.policyPromptVersion, "legal-workbench-policy/v1");
});

test("sample review helpers derive active approval and stale state", () => {
  const review = {};
  applyActiveSampleState(review, sampleV1);

  assert.equal(review.approved, false);
  assert.equal(review.stale, true);
  assert.match(review.staleReason, /approved earlier/i);
  assert.equal(getSampleState(review.activeSample), "approved_stale");
});

test("sample review state helpers initialize and stale active samples", () => {
  const session = {};
  const review = ensureSampleReview(session);
  review.samples.push(sampleV2);
  review.ledger.push(sampleV2);
  review.activeSample = sampleV2;
  review.approved = true;

  markSampleReviewStale(session, "Design changed.");

  assert.equal(session.sampleReview.approved, false);
  assert.equal(session.sampleReview.stale, true);
  assert.equal(session.sampleReview.staleReason, "Design changed.");
  assert.equal(getSampleState(session.sampleReview.activeSample), "approved_stale");
  assert.equal(getSampleState(session.sampleReview.ledger[0]), "approved_stale");
});

test("sample review rendering marks active and stale samples without source text expansion", () => {
  const html = renderSampleLedger({
    activeSample: sampleV2,
    ledger: [sampleV1, sampleV2],
  });

  assert.match(html, /Sample Ledger/);
  assert.match(html, /Sample v2 · active/);
  assert.match(html, /Approved stale/);
  assert.match(html, /Regenerate and approve a current sample/);
  assert.doesNotMatch(html, /## Current sample/);
});

test("sample review copy distinguishes approved current from stale samples", () => {
  const currentCopy = formatSkillSampleCopy(sampleV2, { approved: true });
  assert.match(currentCopy, /Sample approved\. Creation and validation required before the skill is runnable/);
  assert.match(currentCopy, /This sample is approved, but it cannot be used as a skill until creation and validation succeed/);

  const staleCopy = formatSkillSampleCopy(sampleV1, { approved: true });
  assert.match(staleCopy, /Approved earlier, now stale/);
  assert.match(staleCopy, /Earlier packet omitted evidence blocks/);
  assert.match(staleCopy, /not yet a usable skill/i);
});

test("sample review copy redacts secrets from copied sample text", () => {
  const copy = formatSkillSampleCopy({
    ...sampleV2,
    matter: {
      matter_name: "Matter sk-matter-secret",
    },
    feedback: "OPENAI_API_KEY=sk-feedback-secret",
    warnings: ["OPENROUTER_API_KEY=sk-warning-secret"],
    sample_markdown: "Generated sample includes Bearer sk-sample-secret",
  });

  assert.doesNotMatch(copy, /sk-matter-secret|sk-feedback-secret|sk-warning-secret|sk-sample-secret/);
  assert.match(copy, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.match(copy, /OPENROUTER_API_KEY=\[redacted-secret\]/);
  assert.match(copy, /Bearer \[redacted-secret\]/);
});

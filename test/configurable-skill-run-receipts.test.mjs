import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveConfigurableSkillRunReceipt,
  formatConfigurableSkillRunOutputAvailability,
} from "../shared/configurable-skill-run-receipts.mjs";

test("configurable skill run receipt model separates completed output from missing output", () => {
  assert.deepEqual(deriveConfigurableSkillRunReceipt({
    status: "succeeded",
    overwrite: "not_needed",
    outputPaths: { markdown: "20_Workshop/Party Map.md" },
    outputAvailability: { markdown: "present" },
  }), {
    receiptState: "completed",
    statusLabel: "Completed",
    statusClass: "present",
    resultText: "Created output document",
    needsAttention: false,
    isCompletedWork: true,
    canOpenOutput: true,
    outputFileStatus: "present",
    outputFileStatusLabel: "Present in matter folder",
  });

  assert.deepEqual(deriveConfigurableSkillRunReceipt({
    status: "succeeded",
    overwrite: "approved",
    outputPaths: { markdown: "20_Workshop/Party Map.md" },
    outputAvailability: { markdown: "missing" },
  }), {
    receiptState: "output_missing",
    statusLabel: "Output missing",
    statusClass: "warning",
    resultText: "Output file missing from matter folder",
    needsAttention: true,
    isCompletedWork: false,
    canOpenOutput: false,
    outputFileStatus: "missing",
    outputFileStatusLabel: "Missing from matter folder",
  });
});

test("configurable skill run receipt model covers failed, running, and cancelled states", () => {
  assert.equal(deriveConfigurableSkillRunReceipt({ status: "failed" }).receiptState, "failed");
  assert.equal(deriveConfigurableSkillRunReceipt({ status: "failed" }).needsAttention, true);
  assert.equal(deriveConfigurableSkillRunReceipt({ status: "running" }).receiptState, "running");
  assert.equal(deriveConfigurableSkillRunReceipt({ status: "running" }).needsAttention, true);
  assert.equal(deriveConfigurableSkillRunReceipt({ status: "cancelled" }).receiptState, "cancelled");
  assert.equal(deriveConfigurableSkillRunReceipt({ status: "cancelled" }).resultText, "Cancelled - kept existing output document");
});

test("configurable skill run receipt model does not open output without a markdown path", () => {
  assert.equal(deriveConfigurableSkillRunReceipt({
    status: "succeeded",
    outputAvailability: { markdown: "not_recorded" },
  }).canOpenOutput, false);

  assert.equal(deriveConfigurableSkillRunReceipt({
    status: "succeeded",
    outputPaths: { markdown: "20_Workshop/Party Map.md" },
    outputAvailability: { markdown: "unknown" },
  }).canOpenOutput, true);
});

test("configurable skill run receipt model flags succeeded runs without an output path", () => {
  const receipt = deriveConfigurableSkillRunReceipt({
    status: "succeeded",
    outputAvailability: { markdown: "not_recorded" },
  });

  assert.equal(receipt.receiptState, "output_missing");
  assert.equal(receipt.statusLabel, "Output not recorded");
  assert.equal(receipt.needsAttention, true);
  assert.equal(receipt.isCompletedWork, false);
  assert.equal(receipt.canOpenOutput, false);
  assert.equal(receipt.outputFileStatus, "not_recorded");
});

test("configurable skill run output availability labels are stable", () => {
  assert.equal(formatConfigurableSkillRunOutputAvailability("present"), "Present in matter folder");
  assert.equal(formatConfigurableSkillRunOutputAvailability("missing"), "Missing from matter folder");
  assert.equal(formatConfigurableSkillRunOutputAvailability("not_recorded"), "No output path recorded");
  assert.equal(formatConfigurableSkillRunOutputAvailability("unknown"), "Not checked");
  assert.equal(formatConfigurableSkillRunOutputAvailability("nonsense"), "Not checked");
});

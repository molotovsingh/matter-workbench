import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomSkillRunAttentionItems } from "../services/matter-attention-custom-runs.mjs";

test("matter attention custom runs classify failures and dedupe repeated warnings", async () => {
  const seenRequests = [];
  const items = await buildCustomSkillRunAttentionItems({
    configurableSkillRunsService: {
      listRuns: async (request) => {
        seenRequests.push(request);
        return {
          runs: [
            {
              id: "run_failed",
              slash: "/draft_demand_notice",
              title: "Draft Demand Notice",
              status: "failed",
              matterFolder: "Attention Matter",
              errorMessage: "Provider failed closed",
              finishedAt: "2026-05-16T10:00:00.000Z",
              outputPaths: { markdown: "30_Drafts/Draft Legal Output.md" },
              receipt: receipt({
                receiptState: "failed",
                statusLabel: "Failed",
                statusClass: "failed",
                resultText: "Failed",
                needsAttention: true,
                outputFileStatus: "present",
                outputFileStatusLabel: "Present in matter folder",
              }),
            },
            {
              id: "run_warning_new",
              slash: "/party_officer_map_2",
              title: "Party and Officer Map",
              status: "succeeded",
              matterFolder: "Attention Matter",
              warnings: ["Omitted 20 evidence block(s) due to maxBlocks=70"],
              finishedAt: "2026-05-16T10:06:00.000Z",
              outputPaths: { markdown: "20_Workshop/Party and Officer Map.md" },
              receipt: completedReceipt(),
            },
            {
              id: "run_warning_old",
              slash: "/party_officer_map",
              title: "Party and Officer Map",
              status: "succeeded",
              matterFolder: "Attention Matter",
              warnings: ["Omitted 20 evidence block(s) due to maxBlocks=70"],
              finishedAt: "2026-05-16T09:06:00.000Z",
              outputPaths: { markdown: "20_Workshop/Party and Officer Map.md" },
              receipt: completedReceipt(),
            },
          ],
        };
      },
    },
    matterName: "Attention Matter",
  });

  assert.deepEqual(seenRequests, [{ matterFolder: "Attention Matter", limit: 100 }]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.code), ["custom_skill_failed", "custom_skill_warnings"]);
  assert.equal(items[0].detail, "Provider failed closed");
  assert.deepEqual(items[0].evidence, [{
    path: "30_Drafts/Draft Legal Output.md",
    runId: "run_failed",
  }]);
  assert.equal(items[1].detail, "Omitted 20 evidence block(s) due to maxBlocks=70");
  assert.deepEqual(items[1].evidence, [{
    path: "20_Workshop/Party and Officer Map.md",
    runId: "run_warning_new",
  }]);
});

test("matter attention custom runs report unreadable run ledgers", async () => {
  const items = await buildCustomSkillRunAttentionItems({
    configurableSkillRunsService: {
      listRuns: async () => {
        throw new Error("bad json");
      },
    },
    matterName: "Attention Matter",
  });

  assert.deepEqual(items, [{
    severity: "warning",
    category: "custom_skill",
    code: "custom_skill_runs_unreadable",
    title: "Custom skill run ledger could not be read",
    detail: "bad json",
    action: "Inspect configurable-skill-runs.json.",
  }]);
});

test("matter attention custom runs report succeeded receipts with missing output files", async () => {
  const items = await buildCustomSkillRunAttentionItems({
    configurableSkillRunsService: {
      listRuns: async () => ({
        runs: [
          {
            id: "run_missing_output",
            slash: "/party_officer_map",
            title: "Party and Officer Map",
            status: "succeeded",
            matterFolder: "Attention Matter",
            finishedAt: "2026-05-16T10:06:00.000Z",
            outputPaths: { markdown: "20_Workshop/Party and Officer Map.md" },
            outputAvailability: { markdown: "missing" },
            receipt: receipt({
              receiptState: "output_missing",
              statusLabel: "Output missing",
              statusClass: "warning",
              resultText: "Output file missing from matter folder",
              needsAttention: true,
              outputFileStatus: "missing",
              outputFileStatusLabel: "Missing from matter folder",
            }),
          },
        ],
      }),
    },
    matterName: "Attention Matter",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].severity, "warning");
  assert.equal(items[0].code, "custom_skill_output_missing");
  assert.match(items[0].detail, /run receipt says this skill completed/i);
  assert.deepEqual(items[0].evidence, [{
    path: "20_Workshop/Party and Officer Map.md",
    runId: "run_missing_output",
  }]);
});

test("matter attention custom runs report succeeded receipts without output paths", async () => {
  const items = await buildCustomSkillRunAttentionItems({
    configurableSkillRunsService: {
      listRuns: async () => ({
        runs: [
          {
            id: "run_not_recorded",
            slash: "/party_officer_map",
            title: "Party and Officer Map",
            status: "succeeded",
            matterFolder: "Attention Matter",
            finishedAt: "2026-05-16T10:06:00.000Z",
            outputAvailability: { markdown: "not_recorded" },
            receipt: receipt({
              receiptState: "output_missing",
              statusLabel: "Output not recorded",
              statusClass: "warning",
              resultText: "Output path was not recorded for this run",
              needsAttention: true,
              outputFileStatus: "not_recorded",
              outputFileStatusLabel: "No output path recorded",
            }),
          },
        ],
      }),
    },
    matterName: "Attention Matter",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].severity, "warning");
  assert.equal(items[0].code, "custom_skill_output_missing");
  assert.match(items[0].detail, /output document was not recorded/i);
  assert.deepEqual(items[0].evidence, [{ runId: "run_not_recorded" }]);
});

test("matter attention custom runs return empty items without a runs service", async () => {
  assert.deepEqual(await buildCustomSkillRunAttentionItems({ matterName: "Attention Matter" }), []);
});

test("matter attention custom runs flag malformed rows without receipts conservatively", async () => {
  const items = await buildCustomSkillRunAttentionItems({
    configurableSkillRunsService: {
      listRuns: async () => ({
        runs: [
          {
            id: "run_without_receipt",
            slash: "/party_officer_map",
            title: "Party and Officer Map",
            status: "succeeded",
            matterFolder: "Attention Matter",
            finishedAt: "2026-05-16T10:06:00.000Z",
            outputPaths: { markdown: "20_Workshop/Party and Officer Map.md" },
          },
        ],
      }),
    },
    matterName: "Attention Matter",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].code, "custom_skill_receipt_unavailable");
  assert.equal(items[0].severity, "warning");
});

function completedReceipt() {
  return receipt({
    receiptState: "completed",
    statusLabel: "Completed",
    statusClass: "present",
    resultText: "Created output document",
    isCompletedWork: true,
    canOpenOutput: true,
    outputFileStatus: "present",
    outputFileStatusLabel: "Present in matter folder",
  });
}

function receipt(overrides = {}) {
  return {
    receiptState: "unknown",
    statusLabel: "Receipt unavailable",
    statusClass: "warning",
    resultText: "Run receipt is unavailable",
    needsAttention: false,
    isCompletedWork: false,
    canOpenOutput: false,
    outputFileStatus: "unknown",
    outputFileStatusLabel: "Not checked",
    ...overrides,
  };
}

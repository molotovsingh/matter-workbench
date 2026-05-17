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

test("matter attention custom runs return empty items without a runs service", async () => {
  assert.deepEqual(await buildCustomSkillRunAttentionItems({ matterName: "Attention Matter" }), []);
});

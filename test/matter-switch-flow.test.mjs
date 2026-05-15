import assert from "node:assert/strict";
import test from "node:test";
import { switchMatterFlow } from "../frontend/matter-switch-flow.js";

test("switch matter flow clears the matter search after successful selection", async () => {
  const calls = [];
  const payload = { folder: "Mehta vs Skyline" };

  const result = await switchMatterFlow({
    name: "Mehta vs Skyline",
    postSwitchMatter: async (name) => {
      calls.push(["post", name]);
      return payload;
    },
    mergeMattersState: (patch) => calls.push(["merge", patch]),
    clearMatterSearch: (value) => calls.push(["clear-search", value]),
    setActiveMatter: (matter) => calls.push(["active", matter]),
    matterFromWorkspace: (workspace) => ({ folderName: workspace.folder }),
    resetForMatterChange: () => calls.push(["reset"]),
  });

  assert.equal(result, payload);
  assert.deepEqual(calls, [
    ["post", "Mehta vs Skyline"],
    ["merge", { active: "Mehta vs Skyline" }],
    ["clear-search", ""],
    ["reset"],
    ["active", { folderName: "Mehta vs Skyline" }],
  ]);
});

test("switch matter flow does not clear search when switch fails", async () => {
  const calls = [];

  await assert.rejects(() => switchMatterFlow({
    name: "Mehta vs Skyline",
    postSwitchMatter: async () => {
      throw new Error("switch failed");
    },
    mergeMattersState: (patch) => calls.push(["merge", patch]),
    clearMatterSearch: (value) => calls.push(["clear-search", value]),
    setActiveMatter: (matter) => calls.push(["active", matter]),
    matterFromWorkspace: (workspace) => workspace,
    resetForMatterChange: () => calls.push(["reset"]),
  }), /switch failed/);

  assert.deepEqual(calls, []);
});

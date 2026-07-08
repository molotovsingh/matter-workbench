import assert from "node:assert/strict";
import test from "node:test";
import {
  isBlockedWorkspacePath,
  toWorkspacePath,
} from "../services/workspace-path-policy.mjs";

test("workspace path policy normalizes browser paths", () => {
  assert.equal(toWorkspacePath("10_Library\\Case Timeline.md"), "10_Library/Case Timeline.md");
  assert.equal(toWorkspacePath("10_Library\\List of Dates.md"), "10_Library/List of Dates.md");
  assert.equal(toWorkspacePath(null), "");
});

test("workspace path policy blocks hidden and system paths", () => {
  for (const value of [
    ".env",
    ".env.local",
    ".git/config",
    ".playwright-cli/output.json",
    "phase1_legal_workbench/old.json",
    "00_Inbox/Intake 01 - Initial/.DS_Store",
    "00_Inbox/Intake 01 - Initial/~$draft.docx",
    "node_modules/pkg/index.js",
  ]) {
    assert.equal(isBlockedWorkspacePath(value), true, value);
  }
});

test("workspace path policy allows ordinary matter artifacts", () => {
  for (const value of [
    "matter.json",
    "10_Library/Source Index.json",
    "10_Library/Case Timeline.md",
    "20_Workshop/Party and Officer Map.md",
    "30_Drafts/Draft Legal Output.md",
  ]) {
    assert.equal(isBlockedWorkspacePath(value), false, value);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  isExcludedMatterContextPath,
  toMatterContextPacketPath,
} from "../services/matter-context-path-policy.mjs";

test("matter context path policy normalizes paths for packets", () => {
  assert.equal(
    toMatterContextPacketPath("00_Inbox\\Intake 01 - Initial\\Source Files\\notice.pdf"),
    "00_Inbox/Intake 01 - Initial/Source Files/notice.pdf",
  );
  assert.equal(toMatterContextPacketPath(null), "");
});

test("matter context path policy excludes secrets, logs, machine junk, and dependency folders", () => {
  for (const value of [
    ".env",
    ".env.local",
    "10_Library/provider.log",
    "20_Workshop/cache.sqlite",
    "20_Workshop/cases.db",
    "00_Inbox/Intake 01 - Initial/.DS_Store",
    "00_Inbox/Intake 01 - Initial/~$draft.docx",
    ".git/config",
    "node_modules/pkg/index.js",
  ]) {
    assert.equal(isExcludedMatterContextPath(value), true, value);
  }
});

test("matter context path policy keeps ordinary matter documents", () => {
  for (const value of [
    "00_Inbox/Intake 01 - Initial/Source Files/notice.pdf",
    "00_Inbox/Intake 01 - Initial/Originals/email.eml",
    "10_Library/Source Index.json",
    "20_Workshop/Party and Officer Map.md",
  ]) {
    assert.equal(isExcludedMatterContextPath(value), false, value);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCommandReport,
  normalizeTerminalLines,
} from "../frontend/command-reporting.js";

test("normalizeTerminalLines accepts scalars and arrays", () => {
  assert.deepEqual(normalizeTerminalLines(null), []);
  assert.deepEqual(normalizeTerminalLines(undefined), []);
  assert.deepEqual(normalizeTerminalLines("one"), ["one"]);
  assert.deepEqual(normalizeTerminalLines(["one", "", 2]), ["one", "2"]);
});

test("formatCommandReport renders copyable command metadata", () => {
  const report = formatCommandReport({
    matterName: "Ayesha Vs Japan Airlines",
    matterFolder: "Ayesha Vs Japan Airlines",
    timestamp: "2026-05-14T09:00:00.000Z",
    typedInput: "/party_officer_map",
    matchedCommand: "/party_officer_map",
    status: "ran",
    providerModel: "openai-direct / gpt-5.4",
    runId: "run_123",
    overwrite: "approved",
    artifacts: [
      "20_Workshop/Party and Officer Map.md",
      "20_Workshop/Party and Officer Map.json",
    ],
    statusBar: "Skill Run Complete",
    terminalLines: ["[custom-skill] /party_officer_map succeeded"],
  });

  assert.match(report, /# Command Report/);
  assert.match(report, /- Matter: Ayesha Vs Japan Airlines/);
  assert.match(report, /- Matched command: `\/party_officer_map`/);
  assert.match(report, /- Provider\/model: openai-direct \/ gpt-5\.4/);
  assert.match(report, /- Run id: run_123/);
  assert.match(report, /- Output document: Replaced existing matter output/);
  assert.doesNotMatch(report, /- Overwrite:/);
  assert.match(report, /`20_Workshop\/Party and Officer Map\.md`/);
  assert.match(report, /## Latest Terminal Lines/);
});

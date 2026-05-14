import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommandInteractionLogBody,
  deriveReportPatchFromStatus,
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

test("buildCommandInteractionLogBody maps command report fields to beta diagnostics shape", () => {
  const body = buildCommandInteractionLogBody({
    timestamp: "2026-05-14T09:00:00.000Z",
    typedInput: "/party_officer_map",
    matchedCommand: "/party_officer_map",
    status: "ran",
    skillIdeaId: "idea_1",
    sampleId: "sample_1",
    routerDecision: "modify_existing_skill",
    routerMatchedSkill: "/create_listofdates",
    plannerSource: "model",
    plannerModel: "openai-direct / gpt-5.4",
    error: "sample error",
  }, {
    renderedState: "configurable_skill/run",
    providerRunInvoked: true,
  }, {
    statusBar: "Skill Run Complete",
    terminalLines: ["[custom-skill] done"],
  });

  assert.deepEqual(body, {
    timestamp: "2026-05-14T09:00:00.000Z",
    typed_input: "/party_officer_map",
    matched_command: "/party_officer_map",
    rendered_state: "configurable_skill/run",
    status: "ran",
    skill_idea_id: "idea_1",
    sample_id: "sample_1",
    router_decision: {
      decision: "modify_existing_skill",
      matched_skill: "/create_listofdates",
    },
    provider_run_invoked: true,
    planner_source: "model",
    planner_model: "openai-direct / gpt-5.4",
    planner_fallback_reason: "",
    errors: ["sample error"],
    status_bar: "Skill Run Complete",
    terminal_lines: ["[custom-skill] done"],
  });
});

test("deriveReportPatchFromStatus preserves status-bar and terminal-derived command states", () => {
  assert.deepEqual(deriveReportPatchFromStatus({
    bar: "Rerun Confirmation",
  }, {
    terminalLines: ["existing"],
  }), {
    status: "warned",
    statusBar: "Rerun Confirmation",
    terminalLines: ["existing"],
  });
  assert.equal(deriveReportPatchFromStatus({
    terminal: "cancelled by user",
  }).status, "cancelled");
  assert.equal(deriveReportPatchFromStatus({
    terminal: ["skill failed"],
  }).status, "failed");
  assert.equal(deriveReportPatchFromStatus({
    bar: "Skill Run Complete",
  }).status, "ran");
});

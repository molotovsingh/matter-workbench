import assert from "node:assert/strict";
import test from "node:test";
import { formatConfigurableSkillRunReport } from "../frontend/views/configurable-skill-run-report.js";

test("configurable skill run report contains metadata but not generated output", () => {
  const report = formatConfigurableSkillRunReport({
    id: "run_123",
    title: "Party Map",
    slash: "/party_map",
    status: "succeeded",
    matterName: "Ayesha Vs Japan Airlines",
    matterFolder: "Ayesha Vs Japan Airlines",
    startedAt: "2026-05-15T10:00:00.000Z",
    finishedAt: "2026-05-15T10:01:00.000Z",
    overwrite: "approved",
    outputPaths: {
      markdown: "20_Workshop/Party Map.md",
      json: "20_Workshop/Party Map.json",
    },
    aiRun: {
      provider: "openai-direct",
      model: "gpt-5.4",
    },
    warnings: ["Reviewed manually before relying on it."],
    markdown: "# Generated work product",
  });

  assert.match(report, /# Custom Skill Run Report/);
  assert.match(report, /Run id: run_123/);
  assert.match(report, /Provider\/model: openai-direct \/ gpt-5\.4/);
  assert.match(report, /Output document: Replaced existing output document/);
  assert.match(report, /20_Workshop\/Party Map\.md/);
  assert.match(report, /metadata only/);
  assert.doesNotMatch(report, /Generated work product/);
});

test("configurable skill run report redacts secrets in copied diagnostics", () => {
  const report = formatConfigurableSkillRunReport({
    id: "run_123",
    title: "Party Map sk-title-secret",
    slash: "/party_map",
    status: "failed",
    matterName: "Ayesha Vs Japan Airlines",
    matterFolder: "Ayesha Vs Japan Airlines",
    outputPaths: {
      markdown: "20_Workshop/sk-path-secret.md",
    },
    warnings: ["OPENAI_API_KEY=sk-warning-secret"],
    errorMessage: "provider rejected Bearer sk-error-secret",
  });

  assert.doesNotMatch(report, /sk-title-secret|sk-path-secret|sk-warning-secret|sk-error-secret/);
  assert.match(report, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.match(report, /Bearer \[redacted-secret\]/);
});

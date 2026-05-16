import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import { renderMatterPipelineStatus } from "../frontend/views/matter-overview.js";

test("matter overview renders read-only pipeline status", () => {
  const html = renderMatterPipelineStatus({
    stages: [
      {
        slash: "/matter-init",
        label: "Matter Init",
        present: true,
        artifacts: ["matter.json", "00_Inbox/Intake 01 - Initial/File Register.csv"],
      },
      {
        slash: "/describe_sources",
        label: "Describe Sources",
        present: true,
        artifacts: [],
        rerunAdvice: {
          state: "stale",
          shouldConfirm: false,
          reason: "newer extraction records were found",
          newestInputPath: "00_Inbox/Intake 01 - Initial/_extracted/FILE-0001.json",
        },
      },
      {
        slash: "/create_listofdates",
        label: "Create List of Dates",
        present: true,
        artifacts: ["10_Library/List of Dates.md"],
        metrics: {
          rows: 36,
        },
        aiRun: {
          provider: "openrouter",
          model: "openai/gpt-4.1",
          returnedProvider: "Friendli",
        },
        rerunAdvice: {
          state: "current",
          shouldConfirm: true,
          artifactPath: "10_Library/List of Dates.md",
          lastRunAt: "2026-05-11T14:16:00.000Z",
          provider: "Friendli",
          model: "openai/gpt-4.1",
          reason: "No newer extraction records or Source Index changes were found.",
        },
      },
    ],
  }, escapeHtml);

  assert.match(html, /Matter readiness/);
  assert.match(html, /pipeline-stage-list/);
  assert.match(html, /Based on files already saved for this matter/);
  assert.match(html, /Set up matter/);
  assert.match(html, /\/matter-init/);
  assert.match(html, /Done/);
  assert.match(html, /pipeline-state present/);
  assert.doesNotMatch(html, />Present</);
  assert.match(html, /\/describe_sources/);
  assert.match(html, /Label sources/);
  assert.match(html, /Needs update/);
  assert.match(html, /pipeline-rerun-hint stale/);
  assert.doesNotMatch(html, />Stale</);
  assert.match(html, /Review the existing output document, then regenerate deliberately/);
  assert.match(html, /10_Library\/List of Dates\.md/);
  assert.match(html, /Friendli/);
  assert.match(html, /openai\/gpt-4\.1/);
  assert.match(html, /app will ask before replacing it/);
  assert.match(html, /36 rows/);
});

test("matter overview explains label refresh without implying AI regeneration is required", () => {
  const html = renderMatterPipelineStatus({
    stages: [
      {
        slash: "/create_listofdates",
        label: "Create List of Dates",
        present: true,
        artifacts: ["10_Library/List of Dates.md"],
        rerunAdvice: {
          state: "stale",
          shouldConfirm: true,
          dependencyState: "label_refresh_needed",
          reason: "Only Source Index labels appear newer than this artifact.",
          newestInputPath: "10_Library/Source Index.json",
        },
      },
    ],
  }, escapeHtml);

  assert.match(html, /Source labels changed after this chronology was rendered/);
  assert.match(html, /label refresh should be enough/);
  assert.match(html, /AI chronology regeneration is not required/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import { renderMatterAttentionStatus } from "../frontend/views/matter-attention-card.js";
import { renderMatterPipelineStatus } from "../frontend/views/matter-overview.js";

test("matter overview renders read-only pipeline status", () => {
  const html = renderMatterPipelineStatus({
    stages: [
      {
        slash: "/matter-init",
        label: "Matter Init",
        display: {
          action: "Set Up Matter",
          artifact: "Matter Setup",
          running: "Setting up matter",
          complete: "Matter set up",
          pill: "Local",
        },
        present: true,
        artifacts: ["matter.json", "00_Inbox/Intake 01 - Initial/File Register.csv"],
      },
      {
        slash: "/describe_sources",
        label: "Describe Sources",
        display: {
          action: "Label Sources",
          artifact: "Source Labels",
          running: "Labeling sources",
          complete: "Source labels complete",
          pill: "Uses AI",
        },
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
        slash: "/create_case_timeline",
        label: "Build Case Timeline",
        present: true,
        artifacts: ["10_Library/Case Timeline.md"],
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
          artifactPath: "10_Library/Case Timeline.md",
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
  assert.match(html, /Set Up Matter/);
  assert.match(html, /Local/);
  assert.match(html, /Done/);
  assert.match(html, /pipeline-state present/);
  assert.doesNotMatch(html, />Present</);
  assert.match(html, /Label Sources/);
  assert.match(html, /Uses AI/);
  assert.doesNotMatch(html, /\/describe_sources/);
  assert.match(html, /Needs update/);
  assert.match(html, /pipeline-rerun-hint stale/);
  assert.doesNotMatch(html, />Stale</);
  assert.match(html, /Review the existing output document, then regenerate deliberately/);
  assert.match(html, /10_Library\/Case Timeline\.md/);
  assert.match(html, /Friendli/);
  assert.match(html, /openai\/gpt-4\.1/);
  assert.match(html, /app will ask before replacing it/);
  assert.match(html, /36 rows/);
});

test("matter overview explains label refresh without implying AI regeneration is required", () => {
  const html = renderMatterPipelineStatus({
    stages: [
      {
        slash: "/create_case_timeline",
        label: "Build Case Timeline",
        present: true,
        artifacts: ["10_Library/Case Timeline.md"],
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

test("matter overview renders developer attention blockers compactly", () => {
  const html = renderMatterAttentionStatus({
    summary: {
      state: "blocked",
      total: 2,
      blocker: 1,
      warning: 1,
      info: 0,
    },
    items: [
      {
        severity: "blocker",
        category: "extraction",
        title: "Extraction failed",
        detail: "One working copy could not be converted into text.",
        action: "Open Extraction Log.csv and inspect the failed row.",
        evidence: [
          { path: "00_Inbox/Intake 01 - Initial/Extraction Log.csv", row: "FILE-0001", status: "failed" },
          { path: "00_Inbox/Intake 01 - Initial/Source Files/bad.pdf", row: "FILE-0002", status: "unsupported" },
        ],
      },
      {
        severity: "warning",
        category: "source_labels",
        title: "Source labels need review",
        detail: "Some labels are still suggested.",
        action: "Review Source Index.json.",
      },
    ],
  }, escapeHtml);

  assert.match(html, /<details class="matter-attention-disclosure">/);
  assert.match(html, /Developer diagnostics/);
  assert.doesNotMatch(html, /<details class="matter-attention-disclosure" open>/);
  assert.match(html, /Blocked/);
  assert.match(html, /1<\/strong> Blockers/);
  assert.match(html, /1<\/strong> Warnings/);
  assert.match(html, /Extraction failed/);
  assert.match(html, /Blocker/);
  assert.match(html, /Open Extraction Log\.csv/);
  assert.match(html, /00_Inbox\/Intake 01 - Initial\/Extraction Log\.csv - FILE-0001 - failed/);
  assert.match(html, /00_Inbox\/Intake 01 - Initial\/Source Files\/bad\.pdf - FILE-0002 - unsupported/);
  assert.match(html, /Source labels need review/);
});

test("matter overview renders clear developer attention state", () => {
  const html = renderMatterAttentionStatus({
    summary: {
      state: "clear",
      total: 0,
      blocker: 0,
      warning: 0,
      info: 0,
    },
    items: [],
  }, escapeHtml);

  assert.match(html, /Clear/);
  assert.match(html, /No developer blockers or warnings found/);
  assert.doesNotMatch(html, /matter-attention-item/);
});

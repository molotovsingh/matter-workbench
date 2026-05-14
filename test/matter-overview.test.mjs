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

  assert.match(html, /Matter Pipeline/);
  assert.match(html, /\/matter-init/);
  assert.match(html, /Present/);
  assert.match(html, /\/describe_sources/);
  assert.match(html, /Stale/);
  assert.match(html, /Review the current work product, then regenerate deliberately/);
  assert.match(html, /10_Library\/List of Dates\.md/);
  assert.match(html, /Friendli/);
  assert.match(html, /openai\/gpt-4\.1/);
  assert.match(html, /Run will ask before replacing it/);
  assert.match(html, /36 rows/);
});

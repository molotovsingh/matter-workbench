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
        present: false,
        artifacts: [],
      },
      {
        slash: "/create_listofdates",
        label: "Create List of Dates",
        present: true,
        artifacts: ["10_Library/List of Dates.md"],
        aiRun: {
          provider: "openrouter",
          model: "openai/gpt-4.1",
          returnedProvider: "Friendli",
        },
      },
    ],
  }, escapeHtml);

  assert.match(html, /Matter Pipeline/);
  assert.match(html, /\/matter-init/);
  assert.match(html, /Present/);
  assert.match(html, /\/describe_sources/);
  assert.match(html, /Not run/);
  assert.match(html, /10_Library\/List of Dates\.md/);
  assert.match(html, /Friendli/);
  assert.match(html, /openai\/gpt-4\.1/);
});

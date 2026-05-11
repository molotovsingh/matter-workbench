import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  renderSkillsPageHtml,
  skillsPageSummary,
} from "../frontend/views/skills-page.js";

function registryFixture() {
  return {
    schema_version: "skill-registry/v1",
    skills: [
      {
        id: "extract",
        slash: "/extract",
        title: "Extract",
        purpose: "Convert working-copy documents into extraction records.",
        mode: "deterministic",
        matter_required: true,
        paid_provider_call: false,
        rerun_guarded: false,
        default_lane: "00_Inbox",
        runner_key: "/extract",
        inputs: ["working copy files"],
        outputs: ["extraction-record/v1"],
        upstream: ["/matter-init"],
      },
      {
        id: "create_listofdates",
        slash: "/create_listofdates",
        title: "Create List of Dates",
        purpose: "Build a cited legal chronology.",
        mode: "AI",
        matter_required: true,
        paid_provider_call: true,
        rerun_guarded: true,
        default_lane: "10_Library",
        runner_key: "/create_listofdates",
        inputs: ["extraction-record/v1"],
        outputs: ["10_Library/List of Dates.md", "10_Library/List of Dates.json"],
        upstream: ["/extract"],
      },
    ],
  };
}

test("skills page renders built-in skill governance metadata and matter artifact status", () => {
  const summary = skillsPageSummary(registryFixture(), {
    matterName: "Mehta vs Skyline",
    stages: [
      {
        slash: "/extract",
        present: true,
        artifacts: ["00_Inbox/Intake 01 - Initial/_extracted (10 records)"],
      },
      {
        slash: "/create_listofdates",
        present: true,
        artifacts: ["10_Library/List of Dates.md"],
        aiRun: {
          provider: "openrouter",
          returnedProvider: "Friendli",
          model: "openai/gpt-4.1",
        },
      },
    ],
  });

  assert.equal(summary.builtins.length, 2);
  assert.equal(summary.paidAi.length, 1);
  assert.equal(summary.deterministic.length, 1);

  const html = renderSkillsPageHtml({
    registry: registryFixture(),
    matterStatus: {
      matterName: "Mehta vs Skyline",
      stages: [
        {
          slash: "/extract",
          present: true,
          artifacts: ["00_Inbox/Intake 01 - Initial/_extracted (10 records)"],
        },
        {
          slash: "/create_listofdates",
          present: true,
          artifacts: ["10_Library/List of Dates.md"],
          aiRun: {
            returnedProvider: "Friendli",
            model: "openai/gpt-4.1",
          },
        },
      ],
    },
    skillIdeas: {
      schema_version: "skill-ideas/v1",
      ideas: [
        {
          id: "idea_test_1",
          text: "create a skill to summarize pleadings",
          createdAt: "2026-05-12T10:00:00.000Z",
          updatedAt: "2026-05-12T10:00:00.000Z",
          status: "proposed",
          matter: {
            matterName: "Mehta vs Skyline",
            folderName: "Mehta vs Skyline",
          },
        },
        {
          id: "idea_test_2",
          text: "new skill bundle exhibits",
          createdAt: "2026-05-12T11:00:00.000Z",
          updatedAt: "2026-05-12T11:05:00.000Z",
          status: "marked_for_future",
          matter: {
            matterName: "",
            folderName: "",
          },
        },
      ],
    },
    activeMatter: { folderName: "Mehta vs Skyline" },
  }, escapeHtml);

  assert.match(html, /Saved Ideas/);
  assert.match(html, /create a skill to summarize pleadings/);
  assert.match(html, /new skill bundle exhibits/);
  assert.match(html, /Mark for future/);
  assert.match(html, /Dismiss/);
  assert.match(html, /Marked for future/);
  assert.match(html, /Built-in Skills/);
  assert.match(html, /Paid AI Skills/);
  assert.match(html, /Deterministic Skills/);
  assert.match(html, /Coming Later: Configurable Skills/);
  assert.match(html, /\/extract/);
  assert.match(html, /\/create_listofdates/);
  assert.match(html, /Paid\/provider-backed/);
  assert.match(html, /Deterministic\/local/);
  assert.match(html, /10_Library\/List of Dates\.md/);
  assert.match(html, /Friendli/);
  assert.match(html, /openai\/gpt-4\.1/);
  assert.doesNotMatch(html, /Create draft skill|Activate draft|API_KEY|\.env/);
});

test("skills page supports no-matter planning mode without an error", () => {
  const html = renderSkillsPageHtml({
    registry: registryFixture(),
    activeMatter: { folderName: "" },
  }, escapeHtml);

  assert.match(html, /planning mode/i);
  assert.match(html, /No matter is selected/);
  assert.match(html, /No saved skill ideas yet/);
  assert.match(html, /\/extract/);
  assert.doesNotMatch(html, /form-error/);
});

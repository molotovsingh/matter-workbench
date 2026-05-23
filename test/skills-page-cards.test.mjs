import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import { setLawyerLabelRegistry } from "../frontend/lawyer-labels.js";
import { renderSkillCards } from "../frontend/views/skills-page-cards.js";

test("skills page cards render built-in skill metadata and escape artifacts", () => {
  setLawyerLabelRegistry([
    {
      slash: "/matter-init",
      display: {
        action: "Set Up Matter",
        artifact: "Matter Setup",
        running: "Setting up matter",
        complete: "Matter set up",
        pill: "Local",
      },
    },
  ]);
  const html = renderSkillCards([
    {
      slash: "/extract",
      title: "Extract <Docs>",
      display: {
        action: "Extract Documents",
        artifact: "Extracted Documents",
        running: "Extracting documents",
        complete: "Documents extracted",
        pill: "Local",
      },
      purpose: "Convert working copies.",
      mode: "deterministic",
      matter_required: true,
      paid_provider_call: false,
      rerun_guarded: false,
      default_lane: "00_Inbox",
      runner_key: "/extract",
      upstream: ["/matter-init"],
      outputs: ["extraction-record/v1"],
      artifactStatus: {
        present: true,
        artifacts: ["00_Inbox/<bad>.md"],
      },
    },
  ], escapeHtml);

  assert.match(html, /Extract Documents/);
  assert.doesNotMatch(html, /Extract &lt;Docs&gt;/);
  assert.match(html, /Present/);
  assert.match(html, /Local/);
  assert.match(html, /Set Up Matter/);
  assert.match(html, /00_Inbox\/&lt;bad&gt;\.md/);
});

test("skills page cards render custom skill version history and improvement tips", () => {
  const html = renderSkillCards([
    {
      id: "skill_v2",
      slash: "/party_map",
      title: "Party Map",
      purpose: "Map parties and officers.",
      mode: "AI",
      configurable: true,
      status: "active",
      primary: true,
      version: 2,
      family_id: "party-map",
      previous_skill_id: "skill_v1",
      source_idea_id: "idea_v2",
      source_sample_id: "sample_v2",
      validation: { status: "passed" },
      activated_at: "2026-05-15T10:00:00.000Z",
      outputs: ["20_Workshop/Party Map.md"],
      default_lane: "20_Workshop",
      runner_key: "/party_map",
      matter_required: true,
      paid_provider_call: true,
      rerun_guarded: true,
    },
  ], escapeHtml, {
    allCustomSkills: [
      {
        id: "skill_v1",
        slash: "/party_map",
        title: "Party Map",
        configurable: true,
        status: "active",
        primary: false,
        version: 1,
        family_id: "party-map",
        replaced_by_skill_id: "skill_v2",
      },
      {
        id: "skill_v2",
        slash: "/party_map",
        title: "Party Map",
        configurable: true,
        status: "active",
        primary: true,
        version: 2,
        family_id: "party-map",
        previous_skill_id: "skill_v1",
      },
    ],
    improvementIdeas: [
      {
        id: "idea_v2",
        text: "Improve /party_map: add aliases",
        status: "ready_for_review",
        createdAt: "2026-05-15T09:00:00.000Z",
        matter: { matterName: "Demo Matter" },
      },
    ],
    configurableSkillRuns: [
      {
        skillId: "skill_v2",
        slash: "/party_map",
        status: "succeeded",
        matterName: "Demo Matter",
        outputPaths: { markdown: "20_Workshop/Party Map.md" },
        startedAt: "2026-05-15T10:30:00.000Z",
        receipt: completedReceipt(),
      },
    ],
  });

  assert.match(html, /Version history/);
  assert.match(html, /v2/);
  assert.match(html, /Suggested improvement/);
  assert.match(html, /add aliases/);
  assert.match(html, /Latest output/);
  assert.match(html, /20_Workshop\/Party Map\.md/);
});

test("skills page cards use receipt state when a completed custom skill output is missing", () => {
  const html = renderSkillCards([
    {
      id: "skill_v1",
      slash: "/party_map",
      title: "Party Map",
      purpose: "Map parties and officers.",
      mode: "AI",
      configurable: true,
      status: "active",
      primary: true,
      version: 1,
      family_id: "party-map",
      outputs: ["20_Workshop/Party Map.md"],
      default_lane: "20_Workshop",
      runner_key: "/party_map",
      matter_required: true,
      paid_provider_call: true,
      rerun_guarded: true,
    },
  ], escapeHtml, {
    allCustomSkills: [
      {
        id: "skill_v1",
        slash: "/party_map",
        title: "Party Map",
        configurable: true,
        status: "active",
        primary: true,
        version: 1,
        family_id: "party-map",
      },
    ],
    configurableSkillRuns: [
      {
        skillId: "skill_v1",
        slash: "/party_map",
        status: "succeeded",
        matterName: "Demo Matter",
        outputPaths: { markdown: "20_Workshop/Party Map.md" },
        outputAvailability: { markdown: "missing" },
        startedAt: "2026-05-15T10:30:00.000Z",
        receipt: receipt({
          receiptState: "output_missing",
          statusLabel: "Output missing",
          statusClass: "warning",
          resultText: "Output file missing from matter folder",
          needsAttention: true,
          outputFileStatus: "missing",
          outputFileStatusLabel: "Missing from matter folder",
        }),
      },
    ],
  });

  assert.match(html, /Latest run<\/dt><dd>Demo Matter - Output missing<\/dd>/);
  assert.match(html, /Latest output<\/dt><dd><span class="muted">Output missing<\/span><\/dd>/);
  assert.doesNotMatch(html, /Demo Matter - Succeeded/);
});

test("skills page cards do not present failed run output paths as latest outputs", () => {
  const html = renderSkillCards([
    {
      id: "skill_v1",
      slash: "/party_map",
      title: "Party Map",
      purpose: "Map parties and officers.",
      mode: "AI",
      configurable: true,
      status: "active",
      primary: true,
      version: 1,
      family_id: "party-map",
      outputs: ["20_Workshop/Party Map.md"],
      default_lane: "20_Workshop",
      runner_key: "/party_map",
      matter_required: true,
      paid_provider_call: true,
      rerun_guarded: true,
    },
  ], escapeHtml, {
    allCustomSkills: [
      {
        id: "skill_v1",
        slash: "/party_map",
        title: "Party Map",
        configurable: true,
        status: "active",
        primary: true,
        version: 1,
        family_id: "party-map",
      },
    ],
    configurableSkillRuns: [
      {
        skillId: "skill_v1",
        slash: "/party_map",
        status: "failed",
        matterName: "Demo Matter",
        outputPaths: { markdown: "20_Workshop/Party Map.md" },
        errorMessage: "provider failed",
        startedAt: "2026-05-15T10:30:00.000Z",
        receipt: receipt({
          receiptState: "failed",
          statusLabel: "Failed",
          statusClass: "failed",
          resultText: "Failed",
          needsAttention: true,
          outputFileStatus: "present",
          outputFileStatusLabel: "Present in matter folder",
        }),
      },
    ],
  });

  assert.match(html, /Latest run<\/dt><dd>Demo Matter - Failed<\/dd>/);
  assert.match(html, /Latest output<\/dt><dd><span class="muted">No completed output<\/span><\/dd>/);
});

function completedReceipt() {
  return receipt({
    receiptState: "completed",
    statusLabel: "Completed",
    statusClass: "present",
    resultText: "Created output document",
    isCompletedWork: true,
    canOpenOutput: true,
    outputFileStatus: "present",
    outputFileStatusLabel: "Present in matter folder",
  });
}

function receipt(overrides = {}) {
  return {
    receiptState: "unknown",
    statusLabel: "Receipt unavailable",
    statusClass: "warning",
    resultText: "Run receipt is unavailable",
    needsAttention: false,
    isCompletedWork: false,
    canOpenOutput: false,
    outputFileStatus: "unknown",
    outputFileStatusLabel: "Not checked",
    ...overrides,
  };
}

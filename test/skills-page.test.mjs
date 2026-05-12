import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  formatSkillIdeaReviewPacket,
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
          status: "incomplete",
          matter: {
            matterName: "Mehta vs Skyline",
            folderName: "Mehta vs Skyline",
          },
          designBrief: {
            intendedUser: "Litigation associate",
            problem: "Turn pleadings into issue-wise review notes.",
            expectedInputs: "Pleadings, replies, and annexures.",
            expectedOutputArtifact: "20_Workshop/Issue-wise Pleadings Summary.md",
            targetLane: "20_Workshop",
            paidPosture: "paid",
            riskLevel: "medium",
            notes: "Design only. Not runnable yet.",
          },
          readiness: {
            state: "ready_for_review",
            ready: true,
            passedCount: 8,
            totalCount: 8,
            items: [
              { key: "intendedUser", label: "Intended user present", passed: true },
              { key: "problem", label: "Problem/job present", passed: true },
              { key: "expectedInputs", label: "Expected inputs present", passed: true },
              { key: "expectedOutputArtifact", label: "Expected output artifact present", passed: true },
              { key: "targetLane", label: "Target lane selected", passed: true },
              { key: "paidPosture", label: "Paid/free posture selected", passed: true },
              { key: "riskLevel", label: "Risk level selected", passed: true },
              { key: "notes", label: "Notes or acceptance criteria present", passed: true },
            ],
          },
        },
        {
          id: "idea_test_2",
          text: "new skill bundle exhibits",
          createdAt: "2026-05-12T11:00:00.000Z",
          updatedAt: "2026-05-12T11:05:00.000Z",
          status: "parked",
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
  assert.match(html, /Design brief/);
  assert.match(html, /Not runnable yet/);
  assert.match(html, /data-skill-idea-brief-form/);
  assert.match(html, /Litigation associate/);
  assert.match(html, /Turn pleadings into issue-wise review notes\./);
  assert.match(html, /20_Workshop\/Issue-wise Pleadings Summary\.md/);
  assert.match(html, /value="20_Workshop" selected/);
  assert.match(html, /value="paid" selected/);
  assert.match(html, /value="medium" selected/);
  assert.match(html, /Save design brief/);
  assert.match(html, /Readiness checklist/);
  assert.match(html, /Ready for review/);
  assert.match(html, /Incomplete 0\/8/);
  assert.match(html, /Copy Review Packet/);
  assert.match(html, /data-skill-idea-copy-packet/);
  assert.match(html, /Mark ready for review/);
  assert.match(html, /Park idea/);
  assert.match(html, /Dismiss/);
  assert.match(html, /Parked/);
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
  assert.doesNotMatch(html, /Create draft skill|Activate draft|API_KEY|\.env|Generate prompt/);
});

test("skill idea review packet includes governance fields without source text or secrets", () => {
  const packet = formatSkillIdeaReviewPacket({
    id: "idea_test_1",
    text: "can list of dates also flag limitation issues",
    createdAt: "2026-05-12T10:00:00.000Z",
    updatedAt: "2026-05-12T10:00:00.000Z",
    status: "ready_for_review",
    matter: {
      matterName: "Mehta vs Skyline",
      folderName: "Mehta vs Skyline",
    },
    designBrief: {
      intendedUser: "Litigation associate",
      problem: "Explore whether Create List of Dates should flag limitation issues.",
      expectedInputs: "Existing Create List of Dates inputs and source-backed matter artifacts.",
      expectedOutputArtifact: "10_Library/List of Dates.md",
      targetLane: "10_Library",
      paidPosture: "unknown",
      riskLevel: "medium",
      notes: [
        "Target skill: /create_listofdates. Not runnable yet.",
        "Interview answers:",
        "- What should change?: Add limitation flags.",
        "- What must stay unchanged?: Preserve raw citations.",
      ].join("\n"),
    },
    readiness: {
      state: "ready_for_review",
      ready: true,
      passedCount: 8,
      totalCount: 8,
      items: [
        { key: "intendedUser", label: "Intended user present", passed: true },
        { key: "problem", label: "Problem/job present", passed: true },
        { key: "expectedInputs", label: "Expected inputs present", passed: true },
        { key: "expectedOutputArtifact", label: "Expected output artifact present", passed: true },
        { key: "targetLane", label: "Target lane selected", passed: true },
        { key: "paidPosture", label: "Paid/free posture selected", passed: true },
        { key: "riskLevel", label: "Risk level selected", passed: true },
        { key: "notes", label: "Notes or acceptance criteria present", passed: true },
      ],
    },
  }, registryFixture());

  assert.match(packet, /^# Skill Idea Review Packet/);
  assert.match(packet, /- Idea id: idea_test_1/);
  assert.match(packet, /- Status: Ready for review/);
  assert.match(packet, /- Checklist: Complete/);
  assert.match(packet, /- Suggested classification: modification candidate \(\/create_listofdates\)/);
  assert.match(packet, /- Matter: Mehta vs Skyline/);
  assert.match(packet, /- Matter folder: Mehta vs Skyline/);
  assert.match(packet, /## Original User Text/);
  assert.match(packet, /can list of dates also flag limitation issues/);
  assert.match(packet, /- Target lane: 10_Library/);
  assert.match(packet, /- Expected output artifact: 10_Library\/List of Dates\.md/);
  assert.match(packet, /- Risk level: medium/);
  assert.match(packet, /Target skill: \/create_listofdates/);
  assert.match(packet, /- \[x\] Intended user present/);
  assert.match(packet, /Confirm whether this should be free\/local or paid\/provider-backed/);
  assert.match(packet, /This is not a runnable skill\. No prompt, code, or provider call has been generated\./);
  assert.doesNotMatch(packet, /API_KEY|OPENAI_API_KEY|MISTRAL_API_KEY|\.env|BEGIN EXTRACTION RECORD|raw document text/i);
});

test("skill idea review packet does not treat background mentions as modifications", () => {
  const packet = formatSkillIdeaReviewPacket({
    id: "idea_test_2",
    text: "make a new skill that summarises the best case pleadings for the lawyer",
    status: "incomplete",
    designBrief: {
      intendedUser: "Legal team",
      problem: "Summarises the best case pleadings for the lawyer.",
      expectedInputs: "Pleadings, replies, annexures, and source-backed extraction records.",
      expectedOutputArtifact: "20_Workshop/Pleadings Summary.md",
      targetLane: "20_Workshop",
      paidPosture: "unknown",
      riskLevel: "medium",
      notes: "Use List of Dates as optional background context, but create a separate review artifact.",
    },
  }, registryFixture());

  assert.match(packet, /- Status: Incomplete - ready to mark for review/);
  assert.match(packet, /- Checklist: Complete/);
  assert.match(packet, /- Suggested classification: new skill idea/);
  assert.doesNotMatch(packet, /modification candidate|adjacent skill improvement/);
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

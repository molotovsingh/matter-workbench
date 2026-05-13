import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  formatSkillIdeaImplementationBrief,
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
  assert.match(html, /Copy Implementation Brief/);
  assert.match(html, /data-skill-idea-copy-implementation-brief/);
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

test("skill idea implementation brief classifies client-update email as a new skill", () => {
  const packet = formatSkillIdeaImplementationBrief({
    id: "idea_client_email",
    text: "new skill: draft a warm client update email after reading List of Dates",
    status: "ready_for_review",
    matter: {
      matterName: "Ayesha vs Japan Airlines",
      folderName: "Ayesha Vs Japan Airlines",
    },
    designBrief: {
      intendedUser: "Lawyer preparing client communication",
      problem: "Draft a warm client update email after reading List of Dates.",
      expectedInputs: "10_Library/List of Dates.md, Source Index, matter metadata.",
      expectedOutputArtifact: "30_Drafts/Client Update Email.md",
      targetLane: "30_Drafts",
      paidPosture: "paid",
      riskLevel: "high",
      notes: "Client-facing draft. Do not send automatically.",
    },
  }, registryFixture());

  assert.match(packet, /^# Skill Idea Implementation Brief/);
  assert.match(packet, /- Proposal type: New skill/);
  assert.match(packet, /- Title: Client Update Email/);
  assert.match(packet, /- Proposed slash command: \/client_update_email/);
  assert.match(packet, /- Output artifact: 30_Drafts\/Client Update Email\.md/);
  assert.match(packet, /- Target lane: 30_Drafts/);
  assert.match(packet, /Client-facing draft; lawyer must review before sending/);
  assert.match(packet, /do not expose raw FILE-NNNN pX\.bY citations/i);
  assert.match(packet, /## Acceptance Tests/);
  assert.match(packet, /A client-update idea is classified as a new skill, not a List of Dates modification/);
  assert.match(packet, /## Non-Goals/);
  assert.match(packet, /Do not send email/);
  assert.doesNotMatch(packet, /Target existing skill: \/create_listofdates/);
  assert.doesNotMatch(packet, /API_KEY|OPENAI_API_KEY|MISTRAL_API_KEY|\.env|BEGIN EXTRACTION RECORD|raw document text/i);
});

test("skill idea implementation brief keeps party and officer mapping as a new skill", () => {
  const packet = formatSkillIdeaImplementationBrief({
    id: "idea_party_map",
    text: "new skill: discover formal party names, officers, aliases, and relationships",
    status: "incomplete",
    designBrief: {
      intendedUser: "Paralegal",
      problem: "Discover formal party names, officers, aliases, and relationships.",
      expectedInputs: "Matter context, pleadings, correspondence, and contracts.",
      expectedOutputArtifact: "20_Workshop/Party and Officer Map.md",
      targetLane: "20_Workshop",
      paidPosture: "paid",
      riskLevel: "high",
      notes: "Every identity claim must cite sources.",
    },
  }, registryFixture());

  assert.match(packet, /- Proposal type: New skill/);
  assert.match(packet, /- Title: Party and Officer Map/);
  assert.match(packet, /- Proposed slash command: \/party_officer_map/);
  assert.match(packet, /20_Workshop\/Party and Officer Map\.md/);
  assert.match(packet, /Every formal name, officer, alias, role, and relationship must cite readable source labels plus raw FILE-NNNN pX\.bY citations/);
  assert.match(packet, /A party\/officer-name idea is classified as a new skill, not a List of Dates modification/);
  assert.doesNotMatch(packet, /Proposal type: Improve existing skill/);
  assert.doesNotMatch(packet, /Target existing skill: \/create_listofdates/);
});

test("skill idea implementation brief classifies limitation flags as a list-of-dates modification", () => {
  const packet = formatSkillIdeaImplementationBrief({
    id: "idea_lod_limitation",
    text: "modify skill: make List of Dates also flag limitation issues",
    status: "ready_for_review",
    designBrief: {
      intendedUser: "Litigation associate",
      problem: "Make List of Dates also flag limitation issues.",
      expectedInputs: "Existing Create List of Dates inputs and current source-backed chronology.",
      expectedOutputArtifact: "10_Library/List of Dates.md",
      targetLane: "10_Library",
      paidPosture: "paid",
      riskLevel: "high",
      notes: [
        "Target skill: /create_listofdates.",
        "What should change: add limitation flags.",
        "What must stay unchanged: preserve raw citations and readable source labels.",
      ].join("\n"),
    },
  }, registryFixture());

  assert.match(packet, /- Proposal type: Improve existing skill/);
  assert.match(packet, /- Target existing skill: \/create_listofdates/);
  assert.match(packet, /### What Should Change/);
  assert.match(packet, /Add limitation-aware review signals/);
  assert.match(packet, /### What Must Stay Unchanged/);
  assert.match(packet, /Raw FILE-NNNN pX\.bY citations remain canonical/);
  assert.match(packet, /### Regression Tests Required/);
  assert.match(packet, /A fixture with no limitation issue does not invent one/);
  assert.match(packet, /## Acceptance Tests/);
  assert.match(packet, /Implementation decision is explicit/);
  assert.match(packet, /## Non-Goals/);
  assert.match(packet, /Do not replace the existing target skill output silently/);
  assert.match(packet, /separate review artifact/i);
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

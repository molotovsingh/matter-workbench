import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../frontend/dom-utils.js";
import {
  formatSkillIdeaReviewPacket,
  renderSavedIdeas,
} from "../frontend/views/skills-page-saved-ideas.js";

test("saved ideas renderer keeps governance actions and escapes content", () => {
  const html = renderSavedIdeas([
    {
      id: "idea_1",
      text: "create <script>bad</script>",
      status: "incomplete",
      createdAt: "2026-05-15T10:00:00.000Z",
      matter: {
        matterName: "Ayesha <Matter>",
        folderName: "Ayesha Folder",
      },
      designBrief: {
        intendedUser: "Lawyer",
        problem: "Problem",
        expectedInputs: "Inputs",
        expectedOutputArtifact: "20_Workshop/Output.md",
        targetLane: "20_Workshop",
        paidPosture: "paid",
        riskLevel: "medium",
        notes: "Acceptance",
      },
      readiness: {
        ready: true,
        passedCount: 8,
        totalCount: 8,
        items: [{ label: "Intended user present", passed: true }],
      },
    },
  ], escapeHtml);

  assert.match(html, /Saved Ideas/);
  assert.match(html, /create &lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /Ayesha &lt;Matter&gt;/);
  assert.match(html, /data-skill-idea-copy-packet/);
  assert.match(html, /data-skill-idea-copy-implementation-brief/);
  assert.match(html, /data-skill-idea-status="ready_for_review"/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
});

test("skill idea review packet keeps clear incomplete-ready wording", () => {
  const packet = formatSkillIdeaReviewPacket({
    id: "idea_1",
    text: "make List of Dates also flag limitation issues",
    status: "incomplete",
    matter: {
      matterName: "Demo Matter",
      folderName: "Demo Matter",
    },
    designBrief: {
      intendedUser: "Lawyer",
      problem: "Improve chronology",
      expectedInputs: "List of Dates",
      expectedOutputArtifact: "10_Library/Case Timeline.md",
      targetLane: "10_Library",
      paidPosture: "paid",
      riskLevel: "high",
      notes: "Target skill: /create_case_timeline",
    },
    readiness: {
      ready: true,
      passedCount: 8,
      totalCount: 8,
      items: [{ label: "Workspace area selected", passed: true }],
    },
  }, {
    skills: [{ slash: "/create_case_timeline" }],
  });

  assert.match(packet, /Status: Draft complete - ready to mark for review/);
  assert.match(packet, /Checklist: Complete/);
  assert.match(packet, /Suggested classification: modification candidate \(\/create_case_timeline\)/);
  assert.match(packet, /This is not yet a usable skill/);
});

test("skill idea review packet redacts secrets from copied user text", () => {
  const packet = formatSkillIdeaReviewPacket({
    id: "idea_1",
    text: "new skill OPENAI_API_KEY=sk-user-secret",
    matter: {
      matterName: "Matter sk-matter-secret",
      folderName: "Matter sk-folder-secret",
    },
    designBrief: {
      intendedUser: "Lawyer",
      problem: "provider rejected Bearer sk-problem-secret",
      expectedInputs: "OPENROUTER_API_KEY=sk-input-secret",
      expectedOutputArtifact: "20_Workshop/sk-output-secret.md",
      targetLane: "20_Workshop",
      paidPosture: "paid",
      riskLevel: "medium",
      notes: "MISTRAL_API_KEY=sk-notes-secret",
    },
  });

  assert.doesNotMatch(packet, /sk-user-secret|sk-matter-secret|sk-folder-secret|sk-problem-secret|sk-input-secret|sk-output-secret|sk-notes-secret/);
  assert.match(packet, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.match(packet, /Bearer \[redacted-secret\]/);
  assert.match(packet, /OPENROUTER_API_KEY=\[redacted-secret\]/);
  assert.match(packet, /MISTRAL_API_KEY=\[redacted-secret\]/);
});

test("saved ideas renderer surfaces generated samples and warnings", () => {
  const html = renderSavedIdeas([
    {
      id: "idea_1",
      text: "create evidence consistency review",
      status: "incomplete",
      createdAt: "2026-05-15T10:00:00.000Z",
      matter: {
        matterName: "Ayesha Vs Japan Airlines",
        folderName: "Ayesha Vs Japan Airlines",
      },
      designBrief: {
        intendedUser: "Lawyer",
        problem: "Review contradictions",
        expectedInputs: "Source records",
        expectedOutputArtifact: "20_Workshop/Evidence Consistency Review.md",
        targetLane: "20_Workshop",
        paidPosture: "paid",
        riskLevel: "medium",
        notes: "Source-backed.",
      },
      readiness: {
        ready: true,
        passedCount: 8,
        totalCount: 8,
        items: [],
      },
    },
  ], escapeHtml, {
    compact: true,
    samplesByIdea: {
      idea_1: [
        {
          id: "sample_1",
          ideaId: "idea_1",
          version: 1,
          sampleMarkdown: "# Flight Disruption Evidence Consistency Review\n\nUseful sample.",
          matter: {
            matter_name: "Ayesha Vs Japan Airlines",
            folder_name: "Ayesha Vs Japan Airlines",
          },
          aiRun: {
            provider: "openai-direct",
            model: "gpt-5.4",
          },
          warnings: ["462 evidence block(s) were omitted from the bounded packet."],
          state: "current",
        },
      ],
    },
  });

  assert.match(html, /Sample generated/);
  assert.match(html, /Sample v1 generated/);
  assert.match(html, /View latest sample/);
  assert.match(html, /Flight Disruption Evidence Consistency Review/);
  assert.match(html, /Sample warnings/);
  assert.match(html, /462 evidence block\(s\) were omitted/);
  assert.match(html, /data-skill-idea-copy-sample/);
});

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
      expectedOutputArtifact: "10_Library/List of Dates.md",
      targetLane: "10_Library",
      paidPosture: "paid",
      riskLevel: "high",
      notes: "Target skill: /create_listofdates",
    },
    readiness: {
      ready: true,
      passedCount: 8,
      totalCount: 8,
      items: [{ label: "Target lane selected", passed: true }],
    },
  }, {
    skills: [{ slash: "/create_listofdates" }],
  });

  assert.match(packet, /Status: Incomplete - ready to mark for review/);
  assert.match(packet, /Checklist: Complete/);
  assert.match(packet, /Suggested classification: modification candidate \(\/create_listofdates\)/);
  assert.match(packet, /This is not a runnable skill/);
});

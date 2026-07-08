import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSkillCreationOverlapRequest,
  hasSkillCreationOverlapOverride,
  isBlockingSkillOverlapDecision,
  isSkillImprovementIdeaSession,
  parseSkillCreationOverlapJustification,
  renderSkillCreationOverlapGateHtml,
} from "../frontend/skill-creation-overlap.js";

test("skill creation overlap helpers build router request from saved idea brief", () => {
  const request = buildSkillCreationOverlapRequest({}, {
    text: "new skill: build a chronology",
    designBrief: {
      problem: "Create a cited timeline.",
      expectedInputs: "Extraction records and Source Index.",
      expectedOutputArtifact: "10_Library/Case Timeline.md",
      targetLane: "10_Library",
    },
  });

  assert.match(request, /new skill: build a chronology/);
  assert.match(request, /Problem: Create a cited timeline/);
  assert.match(request, /Inputs: Extraction records and Source Index/);
  assert.match(request, /Output: 10_Library\/Case Timeline\.md/);
  assert.match(request, /Lane: 10_Library/);
});

test("skill creation overlap helpers distinguish improvement sessions from new skills", () => {
  assert.equal(isSkillImprovementIdeaSession({
    interview: {
      mode: "modify_existing_skill",
    },
  }, {}), true);

  assert.equal(isSkillImprovementIdeaSession({}, {
    text: "Improve /party_officer_map: add aliases",
    designBrief: {
      notes: "Proposal type: Improve existing skill",
    },
  }), true);

  assert.equal(isSkillImprovementIdeaSession({}, {
    text: "new skill: client update email",
    designBrief: {
      notes: "Proposal type: New skill",
    },
  }), false);
});

test("skill creation overlap helpers block duplicate decisions and parse justifications", () => {
  assert.equal(isBlockingSkillOverlapDecision({
    decision: "needs_user_approval",
    matched_skill: "/create_case_timeline",
  }), true);
  assert.equal(isBlockingSkillOverlapDecision({
    decision: "needs_user_approval",
    matched_skill: "/create_case_timeline",
    mece_violation: true,
  }, {
    overrideJustification: "separate workshop artifact and issue structure",
  }), false);
  assert.equal(isBlockingSkillOverlapDecision({
    recommended_action: "modify_existing_skill",
  }), true);
  assert.equal(isBlockingSkillOverlapDecision({
    decision: "adjacent_skill",
    recommended_action: "adjacent_skill",
    matched_skill: "",
  }), false);

  assert.equal(
    parseSkillCreationOverlapJustification("justify new skill: separate output artifact"),
    "separate output artifact",
  );
  assert.equal(
    parseSkillCreationOverlapJustification("distinct because this is court-facing"),
    "this is court-facing",
  );
  assert.equal(
    parseSkillCreationOverlapJustification("create separate skill with reason: workshop issue review, not library chronology"),
    "workshop issue review, not library chronology",
  );
  assert.equal(parseSkillCreationOverlapJustification("ordinary text"), "");
  assert.equal(hasSkillCreationOverlapOverride("too short"), false);
  assert.equal(hasSkillCreationOverlapOverride("distinct issue grouping"), true);
});

test("skill creation overlap gate rendering escapes router fields", () => {
  const html = renderSkillCreationOverlapGateHtml({
    decision: {
      matched_skill: "/create_case_timeline<script>",
      recommended_action: "modify_existing_skill",
      confidence: 0.91,
      reason: "Overlap <script>alert(1)</script>",
      suggested_next_action: "Use existing skill",
    },
    userRequest: "create <b>timeline</b>",
    overrideJustification: "distinct <reason>",
  });

  assert.match(html, /This may already be covered/);
  assert.match(html, /Use existing skill/);
  assert.match(html, /Improve existing skill/);
  assert.match(html, /Create separate skill anyway/);
  assert.match(html, /91%/);
  assert.match(html, /\/create_case_timeline&lt;script&gt;/);
  assert.match(html, /Overlap &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /create &lt;b&gt;timeline&lt;\/b&gt;/);
  assert.match(html, /distinct &lt;reason&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

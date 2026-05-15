import assert from "node:assert/strict";
import test from "node:test";
import {
  customSkillGroupingKey,
  skillsPageSummary,
} from "../frontend/views/skills-page-summary.js";

test("skills page summary promotes only the latest active custom skill", () => {
  const summary = skillsPageSummary({ skills: [] }, null, {
    skills: [
      {
        id: "skill_v1",
        familyId: "party-map",
        slash: "/party_map",
        title: "Party Map",
        status: "active",
        version: 1,
        outputArtifact: "20_Workshop/Party Map.md",
        targetLane: "20_Workshop",
        activatedAt: "2026-05-14T10:00:00.000Z",
      },
      {
        id: "skill_v2",
        familyId: "party-map",
        previousSkillId: "skill_v1",
        slash: "/party_map",
        title: "Party Map",
        status: "active",
        version: 2,
        outputArtifact: "20_Workshop/Party Map.md",
        targetLane: "20_Workshop",
        activatedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        id: "skill_draft",
        slash: "/draft_skill",
        title: "Draft Skill",
        status: "draft",
        version: 1,
      },
    ],
  });

  assert.equal(summary.allCustom.length, 3);
  assert.deepEqual(summary.custom.map((skill) => skill.id), ["skill_v2"]);
  assert.equal(summary.allCustom.find((skill) => skill.id === "skill_v1").primary, false);
  assert.equal(summary.allCustom.find((skill) => skill.id === "skill_v2").primary, true);
  assert.equal(summary.allCustom.find((skill) => skill.id === "skill_draft").primary, false);
});

test("custom skill grouping falls back to stable signature without lineage", () => {
  assert.equal(
    customSkillGroupingKey({
      title: " Party   Map ",
      outputs: ["20_Workshop/Party Map.md"],
      default_lane: "20_Workshop",
    }),
    "signature:party map:20_workshop/party map.md:20_workshop",
  );
  assert.equal(
    customSkillGroupingKey({
      id: "skill_v2",
      family_id: "party-map",
      previous_skill_id: "skill_v1",
    }),
    "family:party-map",
  );
});

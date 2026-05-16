import assert from "node:assert/strict";
import test from "node:test";
import {
  activateDraftConfigurableSkillVersion,
  buildDraftConfigurableSkill,
} from "../services/configurable-skill-lifecycle.mjs";

const authored = {
  title: "Party and Officer Map",
  slash: "/party_officer_map",
  description: "Map parties and officers.",
  target_lane: "20_Workshop",
  output_artifact: "Party and Officer Map.md",
  matter_required: true,
  paid_provider_call: true,
  source_backed: true,
  prompt: "Create the map.",
  citation_policy: "raw citations required",
};

const idea = { id: "idea_1" };
const sample = {
  id: "sample_1",
  designBriefHash: "hash_1",
};
const runProviderConfig = {
  provider: "openai-direct",
  model: "gpt-5.4",
};

test("configurable skill lifecycle builds a first draft from authored output", () => {
  const draft = buildDraftConfigurableSkill({
    authored,
    idea,
    sample,
    runProviderConfig,
    timestamp: "2026-05-16T10:00:00.000Z",
    skillId: "skill_1",
  });

  assert.equal(draft.id, "skill_1");
  assert.equal(draft.status, "draft");
  assert.equal(draft.version, 1);
  assert.equal(draft.familyId, "skill_1");
  assert.equal(draft.previousSkillId, "");
  assert.equal(draft.slash, "/party_officer_map");
  assert.equal(draft.sourceIdeaId, "idea_1");
  assert.equal(draft.sourceSampleId, "sample_1");
  assert.equal(draft.modelPolicy.task, "configurable_skill_run");
  assert.equal(draft.modelPolicy.provider, "openai-direct");
  assert.equal(draft.validation.status, "pending");
});

test("configurable skill lifecycle activates a new version and disables the previous active skill", () => {
  const previous = {
    id: "skill_old",
    status: "active",
    version: 1,
    familyId: "family_1",
    slash: "/party_officer_map",
    title: "Party and Officer Map",
    targetLane: "20_Workshop",
    outputArtifact: "Party and Officer Map.md",
  };
  const store = { skills: [previous] };
  const draft = buildDraftConfigurableSkill({
    authored: {
      ...authored,
      title: "Party and Officer Map Improved",
    },
    idea,
    sample,
    targetSkill: previous,
    runProviderConfig,
    timestamp: "2026-05-16T10:00:00.000Z",
    skillId: "skill_new",
  });

  const activated = activateDraftConfigurableSkillVersion({
    store,
    draft,
    targetSkill: previous,
    timestamp: "2026-05-16T10:05:00.000Z",
  });

  assert.equal(activated.status, "active");
  assert.equal(activated.version, 2);
  assert.equal(activated.familyId, "family_1");
  assert.equal(activated.previousSkillId, "skill_old");
  assert.equal(activated.activatedAt, "2026-05-16T10:05:00.000Z");
  assert.equal(store.skills.length, 2);
  assert.equal(store.skills[0].status, "disabled");
  assert.equal(store.skills[0].replacedBySkillId, "skill_new");
  assert.equal(store.skills[0].supersededAt, "2026-05-16T10:05:00.000Z");
  assert.equal(store.skills[1].id, "skill_new");
});

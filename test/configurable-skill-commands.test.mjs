import assert from "node:assert/strict";
import test from "node:test";
import {
  findActiveConfigurableSkillBySlash,
  isConfigurableSkillOutputReplacementCommand,
  parseConfigurableSkillRevisionCommand,
} from "../frontend/configurable-skill-commands.js";

const SKILLS = [
  {
    slash: "/party_officer_map",
    title: "Party and Officer Map",
    configurable: true,
    status: "active",
  },
  {
    slash: "/party_officer_map_2",
    title: "Party and Officer Map",
    configurable: true,
    status: "draft",
  },
  {
    slash: "/extract",
    title: "Extract",
    configurable: false,
    status: "active",
  },
];

test("findActiveConfigurableSkillBySlash returns only active configurable skills", () => {
  assert.equal(findActiveConfigurableSkillBySlash(SKILLS, "/party_officer_map")?.title, "Party and Officer Map");
  assert.equal(findActiveConfigurableSkillBySlash(SKILLS, "  /PARTY_OFFICER_MAP  ")?.slash, "/party_officer_map");
  assert.equal(findActiveConfigurableSkillBySlash(SKILLS, "/party_officer_map_2"), null);
  assert.equal(findActiveConfigurableSkillBySlash(SKILLS, "/extract"), null);
  assert.equal(findActiveConfigurableSkillBySlash(SKILLS, "party_officer_map"), null);
});

test("parseConfigurableSkillRevisionCommand accepts slash-first and action-first wording", () => {
  assert.deepEqual(parseConfigurableSkillRevisionCommand("/party_officer_map modify include confidence levels"), {
    targetSlash: "/party_officer_map",
    revisionText: "include confidence levels",
  });
  assert.deepEqual(parseConfigurableSkillRevisionCommand("improve /party_officer_map to include unresolved aliases"), {
    targetSlash: "/party_officer_map",
    revisionText: "include unresolved aliases",
  });
  assert.deepEqual(parseConfigurableSkillRevisionCommand("revise /party_officer_map because it missed directors"), {
    targetSlash: "/party_officer_map",
    revisionText: "it missed directors",
  });
  assert.equal(parseConfigurableSkillRevisionCommand("modify party officer map"), null);
});

test("isConfigurableSkillOutputReplacementCommand keeps legacy and lawyer-facing aliases", () => {
  for (const input of [
    "run again",
    "overwrite",
    "overwrite artifact",
    "replace output",
    "replace output document",
    "replace document",
  ]) {
    assert.equal(isConfigurableSkillOutputReplacementCommand(input), true, input);
  }
  assert.equal(isConfigurableSkillOutputReplacementCommand("improve this skill"), false);
  assert.equal(isConfigurableSkillOutputReplacementCommand("keep existing document"), false);
});

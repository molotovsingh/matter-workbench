import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createConfigurableSkillsService } from "../services/configurable-skills-service.mjs";

const baseSkill = Object.freeze({
  id: "skill_1",
  slash: "/demo_skill",
  title: "Demo Skill",
  description: "Demo skill.",
  status: "active",
  version: 1,
  familyId: "skill_1",
  targetLane: "20_Workshop",
  outputArtifact: "20_Workshop/Demo Skill.md",
  promptConfig: {
    prompt: "Run the demo skill.",
    citationPolicy: "Use source labels.",
  },
});

test("configurable skill lifecycle service exposes stable diagnostic codes", async () => {
  await assertRejectsWithCode(
    () => makeService([baseSkill]).updateSkillLifecycle({ action: "suspend" }),
    400,
    "configurable_skill_lifecycle.skill_id_required",
  );
  await assertRejectsWithCode(
    () => makeService([baseSkill]).updateSkillLifecycle({ skillId: "skill_1" }),
    400,
    "configurable_skill_lifecycle.action_required",
  );
  await assertRejectsWithCode(
    () => makeService([baseSkill]).updateSkillLifecycle({ skillId: "missing", action: "suspend" }),
    404,
    "configurable_skill_lifecycle.not_found",
  );
  await assertRejectsWithCode(
    () => makeService([{ ...baseSkill, status: "disabled" }]).updateSkillLifecycle({ skillId: "skill_1", action: "suspend" }),
    409,
    "configurable_skill_lifecycle.previous_version_read_only",
  );
  await assertRejectsWithCode(
    () => makeService([{ ...baseSkill, status: "deleted" }]).updateSkillLifecycle({ skillId: "skill_1", action: "resume" }),
    409,
    "configurable_skill_lifecycle.deleted_read_only",
  );
  await assertRejectsWithCode(
    () => makeService([baseSkill]).updateSkillLifecycle({ skillId: "skill_1", action: "restore" }),
    409,
    "configurable_skill_lifecycle.invalid_transition",
  );
  await assertRejectsWithCode(
    () => makeService([
      { ...baseSkill, status: "suspended" },
      { ...baseSkill, id: "skill_2", status: "active", familyId: "skill_2" },
    ]).updateSkillLifecycle({ skillId: "skill_1", action: "resume" }),
    409,
    "configurable_skill_lifecycle.slash_collision",
  );
});

test("configurable skill run service exposes stable diagnostic codes", async () => {
  await assertRejectsWithCode(
    () => makeService([{ ...baseSkill, status: "suspended" }]).runSkill({ slash: "/demo_skill" }),
    409,
    "configurable_skill_run.suspended",
  );
  await assertRejectsWithCode(
    () => makeService([{ ...baseSkill, status: "archived" }]).runSkill({ slash: "/demo_skill" }),
    409,
    "configurable_skill_run.archived",
  );
  await assertRejectsWithCode(
    () => makeService([{ ...baseSkill, status: "deleted" }]).runSkill({ slash: "/demo_skill" }),
    409,
    "configurable_skill_run.deleted",
  );
  await assertRejectsWithCode(
    () => makeService([]).runSkill({ slash: "/demo_skill" }),
    404,
    "configurable_skill_run.not_found",
  );

  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "mwb-configurable-skill-run-diagnostics-"));
  await assertRejectsWithCode(
    () => makeService([baseSkill], { env: { CONFIGURABLE_SKILL_RUN_PROVIDER: "openrouter" } }).runSkill({
      slash: "/demo_skill",
      matterRootOverride: matterRoot,
    }),
    409,
    "configurable_skill_run.model_not_configured",
  );
});

function makeService(skills = [], { env = {} } = {}) {
  const store = { schema_version: "configurable-skills/v1", skills: skills.map((skill) => ({ ...skill })) };
  return createConfigurableSkillsService({
    matterStore: {
      ensureMatterRoot: () => "/tmp/mwb-configurable-skill-diagnostics",
      resolveExistingMatter: async (name) => ({ matterPath: `/tmp/${name}` }),
    },
    skillIdeasService: {},
    skillSamplesService: {},
    skillStore: {
      storePath: "memory:configurable-skills",
      readStore: async () => store,
      updateStore: async (mutator) => mutator(store),
    },
    env,
  });
}

async function assertRejectsWithCode(fn, statusCode, code) {
  await assert.rejects(
    fn,
    (error) => error.statusCode === statusCode && error.code === code,
  );
}

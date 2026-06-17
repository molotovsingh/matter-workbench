import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CONFIGURABLE_SKILLS_SCHEMA_VERSION,
  createConfigurableSkillStore,
} from "../services/configurable-skill-store.mjs";

test("filesystem configurable skill store writes replacement store returned by mutator", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "mwb-configurable-skill-store-"));
  const store = createConfigurableSkillStore({ appDir });

  await store.updateStore(() => ({
    schema_version: "configurable-skills/v1",
    skills: [{
      id: "skill_replacement",
      title: "Replacement Skill",
      slash: "/replacement_skill",
      description: "Persisted from returned store.",
      status: "active",
      version: 1,
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Replacement Skill.md",
      matterRequired: true,
      paidProviderCall: false,
      sourceBacked: "required",
      promptConfig: { prompt: "Return replacement.", citationPolicy: "Use sources." },
      modelPolicy: { task: "configurable_skill_run", policyPromptVersion: "legal-workbench-policy/v1" },
      validation: { status: "passed", messages: [] },
      createdAt: "2026-06-06T02:00:00.000Z",
      updatedAt: "2026-06-06T02:00:00.000Z",
    }],
  }));

  const persisted = JSON.parse(await readFile(store.storePath, "utf8"));
  assert.equal(persisted.skills.length, 1);
  assert.equal(persisted.skills[0].id, "skill_replacement");
  assert.equal(persisted.skills[0].title, "Replacement Skill");
});

test("filesystem configurable skill store emits stable local-store diagnostic codes", async () => {
  const invalidJsonDir = await mkdtemp(path.join(os.tmpdir(), "mwb-configurable-skill-store-invalid-json-"));
  await writeFile(path.join(invalidJsonDir, "configurable-skills.json"), "{not json\n");
  await assertRejectsCode(
    () => createConfigurableSkillStore({ appDir: invalidJsonDir }).readStore(),
    "configurable_skill_store.invalid_json",
    500,
  );

  const invalidSchemaDir = await mkdtemp(path.join(os.tmpdir(), "mwb-configurable-skill-store-invalid-schema-"));
  await writeFile(path.join(invalidSchemaDir, "configurable-skills.json"), `${JSON.stringify({ schema_version: "old", skills: [] })}\n`);
  await assertRejectsCode(
    () => createConfigurableSkillStore({ appDir: invalidSchemaDir }).readStore(),
    "configurable_skill_store.invalid_schema",
    500,
  );

  const invalidStoreDir = await mkdtemp(path.join(os.tmpdir(), "mwb-configurable-skill-store-invalid-store-"));
  await writeFile(path.join(invalidStoreDir, "configurable-skills.json"), `${JSON.stringify({ schema_version: CONFIGURABLE_SKILLS_SCHEMA_VERSION, skills: {} })}\n`);
  await assertRejectsCode(
    () => createConfigurableSkillStore({ appDir: invalidStoreDir }).readStore(),
    "configurable_skill_store.invalid_store",
    500,
  );
});

async function assertRejectsCode(operation, code, statusCode) {
  let thrown;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `expected ${code} to be thrown`);
  assert.equal(thrown.code, code);
  assert.equal(thrown.statusCode, statusCode);
}

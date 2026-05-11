import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSkillRegistryService } from "../services/skill-registry-service.mjs";

const EXPECTED_SLASHES = [
  "/matter-init",
  "/extract",
  "/describe_sources",
  "/create_listofdates",
  "/doctor",
];

test("skill registry reads all built-in skill stubs", async () => {
  const registry = await createSkillRegistryService({ appDir: process.cwd() }).readRegistry();

  assert.equal(registry.schema_version, "skill-registry/v1");
  assert.deepEqual(registry.skills.map((skill) => skill.slash), EXPECTED_SLASHES);
  assert.deepEqual(registry.skills.map((skill) => skill.runner_key), EXPECTED_SLASHES);
  assert.deepEqual(registry.skills.map((skill) => skill.schema_version), [
    "built-in-skill/v1",
    "built-in-skill/v1",
    "built-in-skill/v1",
    "built-in-skill/v1",
    "built-in-skill/v1",
  ]);

  const sourceLabels = registry.skills.find((skill) => skill.slash === "/describe_sources");
  const listOfDates = registry.skills.find((skill) => skill.slash === "/create_listofdates");
  assert.equal(sourceLabels.paid_provider_call, true);
  assert.equal(sourceLabels.rerun_guarded, true);
  assert.equal(sourceLabels.default_lane, "10_Library");
  assert.equal(listOfDates.category, "Analyze");
  assert.equal(listOfDates.mode, "AI");
  assert.equal(listOfDates.markdown_first, true);
  assert.deepEqual(listOfDates.outputs, [
    "10_Library/List of Dates.md",
    "10_Library/List of Dates.csv",
    "10_Library/List of Dates.json",
  ]);
});

test("skill registry response shape remains API-compatible", async () => {
  const registry = await createSkillRegistryService({ appDir: process.cwd() }).readRegistry();

  assert.ok(Array.isArray(registry.categories));
  assert.equal(typeof registry.principles, "object");
  assert.ok(Array.isArray(registry.skills));
  assert.equal(registry.builtins, undefined);
  assert.ok(registry.skills.every((skill) => typeof skill.purpose === "string" && skill.purpose.length > 0));
  assert.ok(registry.skills.every((skill) => Array.isArray(skill.inputs)));
  assert.ok(registry.skills.every((skill) => Array.isArray(skill.outputs)));
});

test("skill registry validation fails clearly for invalid built-in stubs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-skill-registry-"));
  const registryPath = path.join(root, "skills", "registry.json");
  const builtinsDir = path.join(root, "skills", "builtins");
  await mkdir(path.join(builtinsDir, "bad"), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify({
    schema_version: "skill-registry/v1",
    categories: ["Analyze"],
    principles: {},
    builtins: ["bad"],
    skills: [],
  }, null, 2)}\n`);
  await writeFile(path.join(builtinsDir, "bad", "skill.json"), `${JSON.stringify({
    schema_version: "built-in-skill/v1",
    id: "bad",
    slash: "/bad",
    title: "Bad",
    category: "Analyze",
    mode: "AI",
    matter_required: true,
    paid_provider_call: "yes",
    rerun_guarded: false,
    source_backed: "required",
    inputs: [],
    outputs: [],
    upstream: [],
    downstream: [],
    default_lane: "10_Library",
    runner_key: "/bad",
    version: 1,
  }, null, 2)}\n`);

  await assert.rejects(
    () => createSkillRegistryService({ registryPath, builtinsDir }).readRegistry(),
    /paid_provider_call must be boolean for \/bad/,
  );
});

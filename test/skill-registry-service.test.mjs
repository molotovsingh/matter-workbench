import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSkillRegistryService } from "../services/skill-registry-service.mjs";

const EXPECTED_SLASHES = [
  "/matter-init",
  "/prepare_matter",
  "/extract",
  "/describe_sources",
  "/context_preview",
  "/context_search",
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
    "built-in-skill/v1",
    "built-in-skill/v1",
    "built-in-skill/v1",
  ]);

  const prepareMatter = registry.skills.find((skill) => skill.slash === "/prepare_matter");
  const sourceLabels = registry.skills.find((skill) => skill.slash === "/describe_sources");
  const listOfDates = registry.skills.find((skill) => skill.slash === "/create_listofdates");
  assert.equal(prepareMatter.category, "Prepare");
  assert.equal(prepareMatter.paid_provider_call, true);
  assert.equal(prepareMatter.rerun_guarded, true);
  assert.equal(prepareMatter.source_backed, "optional");
  assert.equal(sourceLabels.paid_provider_call, true);
  assert.equal(sourceLabels.rerun_guarded, true);
  assert.equal(sourceLabels.default_lane, "10_Library");
  const contextPreview = registry.skills.find((skill) => skill.slash === "/context_preview");
  assert.equal(contextPreview.paid_provider_call, false);
  assert.equal(contextPreview.rerun_guarded, false);
  assert.equal(contextPreview.category, "Review");
  const contextSearch = registry.skills.find((skill) => skill.slash === "/context_search");
  assert.equal(contextSearch.paid_provider_call, false);
  assert.equal(contextSearch.rerun_guarded, false);
  assert.equal(contextSearch.category, "Review");
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

test("skill registry merges active configurable skill cards without mutating built-ins", async () => {
  const registry = await createSkillRegistryService({
    appDir: process.cwd(),
    configurableSkillsService: {
      activeSkillCards: async () => [{
        schema_version: "configurable-skill/v1",
        id: "skill_party_officer_map",
        slash: "/party_officer_map",
        title: "Party and Officer Map",
        category: "Analyze",
        mode: "AI",
        purpose: "Map formal party names and officers.",
        matter_required: true,
        paid_provider_call: true,
        rerun_guarded: true,
        source_backed: "required",
        inputs: ["matter-context-packet/v1"],
        outputs: ["20_Workshop/Party and Officer Map.md"],
        upstream: ["idea_party", "sample_party"],
        downstream: [],
        default_lane: "20_Workshop",
        runner_key: "/party_officer_map",
        version: 1,
        configurable: true,
        status: "active",
      }],
    },
  }).readRegistry();

  assert.equal(registry.skills.length, EXPECTED_SLASHES.length + 1);
  const custom = registry.skills.find((skill) => skill.slash === "/party_officer_map");
  assert.equal(custom.configurable, true);
  assert.equal(custom.status, "active");
  assert.deepEqual(registry.skills.filter((skill) => !skill.configurable).map((skill) => skill.slash), EXPECTED_SLASHES);
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

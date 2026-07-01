import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSkillRegistryService } from "../services/skill-registry-service.mjs";
import { BUILTIN_SKILL_COMMANDS } from "../shared/builtin-skill-commands.mjs";

const EXPECTED_SLASHES = BUILTIN_SKILL_COMMANDS;

test("skill registry reads all built-in skill stubs", async () => {
  const registry = await createSkillRegistryService({ appDir: process.cwd() }).readRegistry();

  assert.equal(registry.schema_version, "skill-registry/v1");
  assert.deepEqual(registry.skills.map((skill) => skill.slash), EXPECTED_SLASHES);
  assert.deepEqual(registry.skills.map((skill) => skill.runner_key), EXPECTED_SLASHES);
  assert.deepEqual(
    registry.skills.map((skill) => skill.schema_version),
    EXPECTED_SLASHES.map(() => "built-in-skill/v1"),
  );

  const prepareMatter = registry.skills.find((skill) => skill.slash === "/prepare_matter");
  const sourceLabels = registry.skills.find((skill) => skill.slash === "/describe_sources");
  const listOfDates = registry.skills.find((skill) => skill.slash === "/create_listofdates");
  const matterStory = registry.skills.find((skill) => skill.slash === "/the_story");
  const proceduralPosture = registry.skills.find((skill) => skill.slash === "/procedural_posture_diagnosis");
  assert.equal(prepareMatter.category, "Prepare");
  assert.equal(prepareMatter.product_surface, "readiness");
  assert.equal(prepareMatter.paid_provider_call, true);
  assert.equal(prepareMatter.rerun_guarded, true);
  assert.equal(prepareMatter.source_backed, "optional");
  assert.equal(sourceLabels.paid_provider_call, true);
  assert.equal(sourceLabels.title, "Source Labels / Document Index");
  assert.equal(sourceLabels.display.action, "Label Sources");
  assert.equal(sourceLabels.display.artifact, "Source Labels");
  assert.equal(sourceLabels.display.pill, "Uses AI");
  assert.equal(sourceLabels.product_surface, "native_legal");
  assert.equal(sourceLabels.rerun_guarded, true);
  assert.equal(sourceLabels.default_lane, "10_Library");
  const contextPreview = registry.skills.find((skill) => skill.slash === "/context_preview");
  assert.equal(contextPreview.paid_provider_call, false);
  assert.equal(contextPreview.product_surface, "utility");
  assert.equal(contextPreview.rerun_guarded, false);
  assert.equal(contextPreview.category, "Review");
  const contextSearch = registry.skills.find((skill) => skill.slash === "/context_search");
  assert.equal(contextSearch.paid_provider_call, false);
  assert.equal(contextSearch.rerun_guarded, false);
  assert.equal(contextSearch.category, "Review");
  assert.equal(listOfDates.category, "Analyze");
  assert.equal(listOfDates.product_surface, "native_legal");
  assert.equal(listOfDates.display.action, "Build Case Timeline");
  assert.equal(listOfDates.display.artifact, "Case Timeline");
  assert.equal(listOfDates.display.running, "Building Case Timeline");
  assert.equal(listOfDates.mode, "AI");
  assert.deepEqual(listOfDates.downstream, []);
  assert.equal(listOfDates.markdown_first, true);
  assert.deepEqual(listOfDates.outputs, [
    "10_Library/List of Dates.md",
    "10_Library/List of Dates.csv",
    "10_Library/List of Dates.json",
  ]);
  assert.equal(matterStory.category, "Analyze");
  assert.equal(matterStory.product_surface, "native_legal");
  assert.equal(matterStory.display.action, "Write Matter Story");
  assert.equal(matterStory.display.artifact, "Matter Story");
  assert.equal(matterStory.default_lane, "20_Workshop");
  assert.deepEqual(matterStory.upstream, ["/create_listofdates"]);
  assert.deepEqual(matterStory.outputs, [
    "20_Workshop/The Story.md",
    "20_Workshop/The Story.json",
    "matter.json.brief_description",
  ]);
  assert.equal(proceduralPosture.category, "Analyze");
  assert.equal(proceduralPosture.product_surface, "case_analysis");
  assert.notEqual(proceduralPosture.configurable, true);
  assert.equal(proceduralPosture.display.action, "Diagnose procedural posture");
  assert.equal(proceduralPosture.display.artifact, "Filing and Procedural Posture Diagnosis");
  assert.equal(proceduralPosture.paid_provider_call, true);
  assert.equal(proceduralPosture.rerun_guarded, true);
  assert.equal(proceduralPosture.source_backed, "required");
  assert.deepEqual(proceduralPosture.upstream, ["/create_listofdates", "/the_story"]);
  assert.deepEqual(proceduralPosture.outputs, [
    "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md",
    "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.json",
    "20_Workshop/Case Analysis/Case Analysis Q&A.md",
  ]);
});

test("skill registry response shape remains API-compatible", async () => {
  const source = JSON.parse(await readFile(path.join(process.cwd(), "skills", "registry.json"), "utf8"));
  const registry = await createSkillRegistryService({ appDir: process.cwd() }).readRegistry();

  assert.deepEqual(source.builtins.map((id) => `/${id}`), BUILTIN_SKILL_COMMANDS);
  assert.equal(source.skills, undefined);
  assert.ok(Array.isArray(registry.categories));
  assert.equal(typeof registry.principles, "object");
  assert.ok(Array.isArray(registry.skills));
  assert.equal(registry.builtins, undefined);
  assert.ok(registry.skills.every((skill) => typeof skill.purpose === "string" && skill.purpose.length > 0));
  assert.ok(registry.skills.every((skill) => Array.isArray(skill.inputs)));
  assert.ok(registry.skills.every((skill) => Array.isArray(skill.outputs)));
  assert.ok(registry.skills
    .filter((skill) => !skill.configurable)
    .every((skill) => ["action", "artifact", "running", "complete", "pill"]
      .every((field) => typeof skill.display?.[field] === "string" && skill.display[field].length > 0)));
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
  await mkdir(builtinsDir, { recursive: true });
  await writeFile(registryPath, `${JSON.stringify({
    schema_version: "skill-registry/v1",
    categories: ["Analyze"],
    principles: {},
    builtins: BUILTIN_SKILL_COMMANDS.map((slash) => slash.slice(1)),
  }, null, 2)}\n`);
  for (const slash of BUILTIN_SKILL_COMMANDS) {
    const id = slash.slice(1);
    await mkdir(path.join(builtinsDir, id), { recursive: true });
    await writeFile(path.join(builtinsDir, id, "skill.json"), `${JSON.stringify({
      schema_version: "built-in-skill/v1",
      id,
      slash,
      title: id,
      category: "Analyze",
      mode: "AI",
      matter_required: true,
      paid_provider_call: slash === "/matter-init" ? "yes" : false,
      rerun_guarded: false,
      source_backed: "required",
      inputs: [],
      outputs: [],
      upstream: [],
      downstream: [],
      default_lane: "10_Library",
      runner_key: slash,
      version: 1,
    }, null, 2)}\n`);
  }

  await assert.rejects(
    () => createSkillRegistryService({ registryPath, builtinsDir }).readRegistry(),
    /paid_provider_call must be boolean for \/matter-init/,
  );
});

test("skill registry rejects built-in manifest drift from shared commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-skill-registry-"));
  const registryPath = path.join(root, "skills", "registry.json");
  const builtinsDir = path.join(root, "skills", "builtins");
  await mkdir(builtinsDir, { recursive: true });
  await writeFile(registryPath, `${JSON.stringify({
    schema_version: "skill-registry/v1",
    categories: ["Analyze"],
    principles: {},
    builtins: ["extract"],
  }, null, 2)}\n`);

  await assert.rejects(
    () => createSkillRegistryService({ registryPath, builtinsDir }).readRegistry(),
    /must match shared\/builtin-skill-commands\.mjs/,
  );
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createConfigurableSkillsService,
  createOpenAiAuthoringProvider,
} from "../services/configurable-skills-service.mjs";

const PARTY_BRIEF = Object.freeze({
  intendedUser: "Litigation team",
  problem: "Map formal parties, officers, aliases, and relationships.",
  expectedInputs: "Matter context and extracted source-backed records.",
  expectedOutputArtifact: "20_Workshop/Party and Officer Map.md",
  targetLane: "20_Workshop",
  paidPosture: "paid",
  riskLevel: "medium",
  notes: "Every factual entry needs readable source labels and raw citations.",
});

test("configurable skills create active skills from approved samples and allocate unique slashes", async () => {
  const { service } = await makeServiceHarness();

  const first = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });
  const second = await service.createSkillFromApprovedSample({ ideaId: "idea_party_2" });

  assert.equal(first.skill.status, "active");
  assert.equal(first.skill.slash, "/party_officer_map");
  assert.equal(first.skill.outputArtifact, "20_Workshop/Party and Officer Map.md");
  assert.equal(second.skill.status, "active");
  assert.equal(second.skill.slash, "/party_officer_map_2");

  const cards = await service.activeSkillCards();
  assert.deepEqual(cards.map((card) => card.slash), ["/party_officer_map", "/party_officer_map_2"]);
  assert.ok(cards.every((card) => card.configurable));
});

test("configurable skills canonicalize authored slash commands to underscores", async () => {
  const { service } = await makeServiceHarness({
    authoredSlash: "/party-officer-map",
  });

  const created = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });

  assert.equal(created.skill.slash, "/party_officer_map");
});

test("configurable skill authoring fails closed on malformed OpenAI JSON", async () => {
  const provider = createOpenAiAuthoringProvider({
    apiKey: "sk-test",
    endpoint: "https://example.test/responses",
    model: "gpt-5.4",
    maxOutputTokens: 1000,
    timeoutMs: 1000,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ output_text: "not json" }),
    }),
  });

  await assert.rejects(
    () => provider({
      idea: { id: "idea", text: "party map" },
      sample: { id: "sample", sampleMarkdown: "# Sample" },
      existingSlashes: [],
      schema: { type: "object" },
    }),
    /OpenAI skill authoring response was not valid JSON/,
  );
});

test("configurable skill validation blocks bad source-backed samples and keeps draft non-runnable", async () => {
  const { service } = await makeServiceHarness({
    sampleMarkdown: "# Party and Officer Map\n\nNo raw citation here.",
  });

  await assert.rejects(
    () => service.createSkillFromApprovedSample({ ideaId: "idea_party_1" }),
    /Approved source-backed sample must include raw FILE citations/,
  );
  await assert.rejects(
    () => service.runSkill({ slash: "/party_officer_map" }),
    /No active configurable skill/,
  );
});

test("configurable skill validation blocks bad draft run output", async () => {
  const { service } = await makeServiceHarness({
    runMarkdown: "# Party and Officer Map\n\nGeneric output without source citations.",
  });

  await assert.rejects(
    () => service.createSkillFromApprovedSample({ ideaId: "idea_party_1" }),
    /Validation run output must include raw FILE citations/,
  );
  await assert.rejects(
    () => service.runSkill({ slash: "/party_officer_map" }),
    /No active configurable skill/,
  );
});

test("active configurable skill runs write only configured markdown and JSON artifacts", async () => {
  const { service, matterRoot } = await makeServiceHarness();
  await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });

  const firstRun = await service.runSkill({ slash: "/party_officer_map" });

  assert.equal(firstRun.state, "written");
  assert.equal(firstRun.outputPaths.markdown, "20_Workshop/Party and Officer Map.md");
  assert.equal(firstRun.outputPaths.json, "20_Workshop/Party and Officer Map.json");
  assert.match(firstRun.markdown, /FILE-0001 p1\.b1/);

  const markdown = await readFile(path.join(matterRoot, "20_Workshop", "Party and Officer Map.md"), "utf8");
  const metadata = JSON.parse(await readFile(path.join(matterRoot, "20_Workshop", "Party and Officer Map.json"), "utf8"));
  assert.match(markdown, /^# Party and Officer Map/);
  assert.equal(metadata.skill.slash, "/party_officer_map");

  const blocked = await service.runSkill({ slash: "/party_officer_map" });
  assert.equal(blocked.state, "requires_overwrite");
  const overwritten = await service.runSkill({ slash: "/party_officer_map", overwrite: true });
  assert.equal(overwritten.state, "written");
});

async function makeServiceHarness({ sampleMarkdown, runMarkdown, authoredSlash = "/party_officer_map" } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "configurable-skills-test-"));
  const appDir = path.join(tmp, "app");
  const matterRoot = path.join(tmp, "matter");
  await mkdir(appDir, { recursive: true });
  await mkdir(matterRoot, { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify({
    matter_name: "Ayesha Vs Japan Airlines",
    client_name: "Ayesha",
    opposite_party: "Japan Airlines",
    matter_type: "consumer dispute",
    jurisdiction: "India",
    intakes: [],
  }, null, 2)}\n`);

  const ideas = new Map([
    ["idea_party_1", makeIdea("idea_party_1")],
    ["idea_party_2", makeIdea("idea_party_2")],
  ]);
  const samples = new Map([
    ["idea_party_1", makeSample("sample_party_1", sampleMarkdown)],
    ["idea_party_2", makeSample("sample_party_2", sampleMarkdown)],
  ]);
  const service = createConfigurableSkillsService({
    appDir,
    matterStore: {
      ensureMatterRoot: () => matterRoot,
    },
    skillIdeasService: {
      getIdea: async (id) => {
        const idea = ideas.get(id);
        if (!idea) throw new Error(`missing idea ${id}`);
        return idea;
      },
    },
    skillSamplesService: {
      getApprovedCurrentSample: async ({ ideaId }) => {
        const sample = samples.get(ideaId);
        if (!sample) throw new Error(`missing sample ${ideaId}`);
        return sample;
      },
    },
    env: {},
    idFactory: (() => {
      let index = 0;
      return () => `skill_${index += 1}`;
    })(),
    now: () => new Date("2026-05-13T08:30:00.000Z"),
    authoringProvider: async () => ({
      title: "Party and Officer Map",
      slash: authoredSlash,
      description: "Map formal party names, officers, aliases, and relationships.",
      target_lane: "20_Workshop",
      output_artifact: "20_Workshop/Party and Officer Map.md",
      matter_required: true,
      paid_provider_call: true,
      source_backed: "required",
      prompt: "Build a source-backed party and officer map for the active matter. Identify formal party names, officers, aliases, and relationships. Every factual statement must cite readable source labels and raw FILE-NNNN pX.bY citations. Mark missing or uncertain evidence clearly.",
      citation_policy: "Every factual statement must cite readable source labels and raw FILE-NNNN pX.bY citations.",
    }),
    runProvider: async () => runMarkdown || [
      "# Party and Officer Map",
      "",
      "| Name | Role | Evidence |",
      "| --- | --- | --- |",
      "| Ayesha | Client | Matter context (FILE-0001 p1.b1) |",
    ].join("\n"),
  });
  return { service, matterRoot };
}

function makeIdea(id) {
  return {
    id,
    text: "new skill: discover formal party names, officers, aliases, and relationships",
    designBrief: PARTY_BRIEF,
  };
}

function makeSample(id, markdown = null) {
  return {
    id,
    ideaId: id === "sample_party_1" ? "idea_party_1" : "idea_party_2",
    approved: true,
    designBriefHash: "hash",
    matter: {
      matter_name: "Ayesha Vs Japan Airlines",
      folder_name: "Ayesha Vs Japan Airlines",
    },
    sampleMarkdown: markdown || "# Party and Officer Map\n\n| Name | Role | Evidence |\n| --- | --- | --- |\n| Ayesha | Client | Matter metadata (FILE-0001 p1.b1) |",
    aiRun: {
      provider: "openai-direct",
      model: "gpt-5.4",
      task: "skill_sample_output",
    },
  };
}

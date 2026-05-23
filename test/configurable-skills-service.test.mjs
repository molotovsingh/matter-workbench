import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createConfigurableSkillRunsService,
} from "../services/configurable-skill-runs-service.mjs";
import {
  createConfigurableSkillsService,
  createOpenAiAuthoringProvider,
  createOpenAiRunProvider,
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
  assert.match(first.skill.promptConfig.prompt, /raw FILE-NNNN pX\.bY citations/);
  assert.match(first.skill.promptConfig.citationPolicy, /raw FILE-NNNN pX\.bY citations/);
  assert.equal(second.skill.status, "active");
  assert.equal(second.skill.slash, "/party_officer_map_2");

  const listed = await service.listSkills();
  assert.deepEqual(listed.skills.map((skill) => skill.slash), ["/party_officer_map", "/party_officer_map_2"]);

  const cards = await service.activeSkillCards();
  assert.deepEqual(cards.map((card) => card.slash), ["/party_officer_map_2"]);
  assert.ok(cards.every((card) => card.configurable));
});

test("failed new skill drafts do not reserve the clean slash on retry", async () => {
  const { service } = await makeServiceHarness({
    runMarkdownSequence: [
      "# Party and Officer Map\n\nGeneric output without raw citations.",
      [
        "# Party and Officer Map",
        "",
        "| Name | Role | Evidence |",
        "| --- | --- | --- |",
        "| Ayesha | Client | Matter context (FILE-0001 p1.b1) |",
      ].join("\n"),
    ],
  });

  await assert.rejects(
    () => service.createSkillFromApprovedSample({ ideaId: "idea_party_1" }),
    /Validation run output must include raw FILE citations/,
  );
  const retry = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });

  assert.equal(retry.skill.status, "active");
  assert.equal(retry.skill.slash, "/party_officer_map");
  const listed = await service.listSkills();
  assert.deepEqual(listed.skills.map((skill) => [skill.slash, skill.status]), [
    ["/party_officer_map_failed_validation", "draft"],
    ["/party_officer_map", "active"],
  ]);
  const cards = await service.activeSkillCards();
  assert.deepEqual(cards.map((card) => card.slash), ["/party_officer_map"]);
});

test("configurable skills create validated new versions without silently overwriting the active skill", async () => {
  const { service } = await makeServiceHarness();

  const first = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });
  const second = await service.createSkillFromApprovedSample({ ideaId: "idea_party_improve" });

  assert.equal(first.skill.status, "active");
  assert.equal(second.skill.status, "active");
  assert.equal(second.skill.slash, "/party_officer_map");
  assert.equal(second.skill.version, 2);
  assert.equal(second.skill.previousSkillId, first.skill.id);
  assert.equal(second.skill.familyId, first.skill.id);

  const listed = await service.listSkills();
  const versions = listed.skills.filter((skill) => skill.slash === "/party_officer_map");
  assert.deepEqual(versions.map((skill) => [skill.version, skill.status]), [
    [1, "disabled"],
    [2, "active"],
  ]);
  assert.equal(versions[0].replacedBySkillId, second.skill.id);

  const cards = await service.activeSkillCards();
  assert.deepEqual(cards.filter((card) => card.slash === "/party_officer_map").map((card) => card.version), [2]);
});

test("configurable skill version validation failure keeps the previous version active", async () => {
  const goodOutput = [
    "# Party and Officer Map",
    "",
    "| Name | Role | Evidence |",
    "| --- | --- | --- |",
    "| Ayesha | Client | Matter context (FILE-0001 p1.b1) |",
  ].join("\n");
  const { service } = await makeServiceHarness({
    runMarkdownSequence: [
      goodOutput,
      "# Party and Officer Map\n\nGeneric output without raw citations.",
    ],
  });

  const first = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });
  await assert.rejects(
    () => service.createSkillFromApprovedSample({ ideaId: "idea_party_improve" }),
    /Validation run output must include raw FILE citations/,
  );

  const listed = await service.listSkills();
  const versions = listed.skills.filter((skill) => skill.slash === "/party_officer_map");
  assert.deepEqual(versions.map((skill) => [skill.version, skill.status]), [
    [1, "active"],
    [2, "draft"],
  ]);
  assert.equal(versions[0].id, first.skill.id);
  const cards = await service.activeSkillCards();
  assert.deepEqual(cards.filter((card) => card.slash === "/party_officer_map").map((card) => card.version), [1]);
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

test("configurable skill authoring and run providers carry the shared legal workbench policy prompt", async () => {
  const authoringBodies = [];
  const authoringProvider = createOpenAiAuthoringProvider({
    apiKey: "sk-test",
    endpoint: "https://example.test/responses",
    model: "gpt-5.4",
    maxOutputTokens: 1000,
    fetchImpl: async (_endpoint, options) => {
      authoringBodies.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            title: "Party Map",
            slash: "/party_map",
            description: "Map parties.",
            target_lane: "20_Workshop",
            output_artifact: "20_Workshop/Party Map.md",
            matter_required: true,
            paid_provider_call: true,
            source_backed: "required",
            prompt: "Map parties from source-backed context.",
            citation_policy: "Use lawyer-readable labels.",
          }),
        }),
      };
    },
  });
  const runBodies = [];
  const runProvider = createOpenAiRunProvider({
    apiKey: "sk-test",
    endpoint: "https://example.test/responses",
    model: "gpt-5.4",
    maxOutputTokens: 1000,
    fetchImpl: async (_endpoint, options) => {
      runBodies.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ output_text: "# Party Map\n\nSource-backed." }),
      };
    },
  });

  await authoringProvider({
    idea: { id: "idea", text: "party map" },
    sample: { id: "sample", matter: { matter_name: "Demo" }, sampleMarkdown: "# Sample" },
    existingSlashes: [],
    schema: { type: "object" },
  });
  await runProvider({
    skill: {
      title: "Party Map",
      slash: "/party_map",
      description: "Map parties.",
      outputArtifact: "20_Workshop/Party Map.md",
      sourceBacked: "required",
      promptConfig: {
        prompt: "Map parties from source-backed context.",
        citationPolicy: "Use lawyer-readable labels.",
      },
    },
    matterContext: { matter: { matter_name: "Demo" }, evidenceBlocks: [] },
  });

  assert.match(authoringBodies[0].input[0].content, /Policy prompt version: legal-workbench-policy\/v1/);
  assert.match(authoringBodies[0].input[0].content, /Custom skill policy/);
  assert.match(runBodies[0].input[0].content, /Policy prompt version: legal-workbench-policy\/v1/);
  assert.match(authoringBodies[0].input[0].content, /raw FILE-NNNN pX\.bY audit citations/);
  assert.match(runBodies[0].input[0].content, /include raw FILE-NNNN pX\.bY citations in a clearly marked internal audit/);
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
  const { service, matterRoot, runLedger } = await makeServiceHarness();
  const created = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });
  assert.equal(created.skill.modelPolicy.policyPromptVersion, "legal-workbench-policy/v1");

  const firstRun = await service.runSkill({ slash: "/party_officer_map" });

  assert.equal(firstRun.state, "written");
  assert.equal(firstRun.runRecord.status, "succeeded");
  assert.equal(firstRun.runRecord.receipt.receiptState, "completed");
  assert.equal(firstRun.runRecord.receipt.canOpenOutput, true);
  assert.equal(firstRun.runRecord.outputAvailability.markdown, "present");
  assert.equal(firstRun.runRecord.overwrite, "not_needed");
  assert.equal(firstRun.runRecord.aiRun.policyPromptVersion, "legal-workbench-policy/v1");
  assert.equal(firstRun.outputPaths.markdown, "20_Workshop/Party and Officer Map.md");
  assert.equal(firstRun.outputPaths.json, "20_Workshop/Party and Officer Map.json");
  assert.match(firstRun.markdown, /FILE-0001 p1\.b1/);

  const markdown = await readFile(path.join(matterRoot, "20_Workshop", "Party and Officer Map.md"), "utf8");
  const metadata = JSON.parse(await readFile(path.join(matterRoot, "20_Workshop", "Party and Officer Map.json"), "utf8"));
  assert.match(markdown, /^# Party and Officer Map/);
  assert.equal(metadata.skill.slash, "/party_officer_map");
  assert.equal(metadata.aiRun.policyPromptVersion, "legal-workbench-policy/v1");

  const blocked = await service.runSkill({ slash: "/party_officer_map" });
  assert.equal(blocked.state, "requires_overwrite");
  const overwritten = await service.runSkill({ slash: "/party_officer_map", overwrite: true });
  assert.equal(overwritten.state, "written");
  assert.equal(overwritten.runRecord.overwrite, "approved");
  assert.equal(overwritten.runRecord.receipt.receiptState, "completed");
  const runs = await runLedger.listRuns({ slash: "/party_officer_map" });
  assert.deepEqual(runs.runs.map((run) => run.status), ["succeeded", "succeeded"]);
  assert.deepEqual(runs.runs.map((run) => run.title), ["Party and Officer Map v1", "Party and Officer Map v1"]);
  assert.deepEqual(runs.runs.map((run) => run.overwrite), ["approved", "not_needed"]);
});

test("active configurable skill run failures update the ledger without writing success metadata", async () => {
  const { service, runLedger } = await makeServiceHarness({ failRuntimeAfterValidation: true });
  await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });

  await assert.rejects(
    () => service.runSkill({ slash: "/party_officer_map" }),
    /runtime failed/,
  );

  const runs = await runLedger.listRuns({ slash: "/party_officer_map" });
  assert.equal(runs.runs.length, 1);
  assert.equal(runs.runs[0].status, "failed");
  assert.match(runs.runs[0].errorMessage, /runtime failed/);
  assert.equal(runs.runs[0].outputPaths.markdown, "20_Workshop/Party and Officer Map.md");
});

test("configurable skill service records overwrite cancellations", async () => {
  const { service, runLedger } = await makeServiceHarness();
  await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });

  const cancelled = await service.recordCancelledRun({
    slash: "/party_officer_map",
    artifactPath: "20_Workshop/Party and Officer Map.md",
  });

  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.runRecord.status, "cancelled");
  assert.equal(cancelled.runRecord.title, "Party and Officer Map v1");
  assert.equal(cancelled.runRecord.overwrite, "cancelled");
  assert.equal(cancelled.runRecord.receipt.receiptState, "cancelled");
  assert.equal(cancelled.runRecord.receipt.canOpenOutput, false);
  const runs = await runLedger.listRuns({ slash: "/party_officer_map" });
  assert.equal(runs.runs[0].status, "cancelled");
});

async function makeServiceHarness({ sampleMarkdown, runMarkdown, runMarkdownSequence = null, authoredSlash = "/party_officer_map", failRuntimeAfterValidation = false } = {}) {
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
    ["idea_party_improve", makeImprovementIdea("idea_party_improve")],
  ]);
  const samples = new Map([
    ["idea_party_1", makeSample("sample_party_1", sampleMarkdown)],
    ["idea_party_2", makeSample("sample_party_2", sampleMarkdown)],
    ["idea_party_improve", makeSample("sample_party_improve", sampleMarkdown)],
  ]);
  const runLedger = createConfigurableSkillRunsService({
    appDir,
    idFactory: (() => {
      let index = 0;
      return () => `run_${index += 1}`;
    })(),
    now: () => new Date("2026-05-13T08:45:00.000Z"),
  });
  let runProviderCalls = 0;
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
    configurableSkillRunsService: runLedger,
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
    runProvider: async () => {
      runProviderCalls += 1;
      if (failRuntimeAfterValidation && runProviderCalls > 1) throw new Error("runtime failed");
      if (Array.isArray(runMarkdownSequence) && runMarkdownSequence.length) {
        return runMarkdownSequence[Math.min(runProviderCalls - 1, runMarkdownSequence.length - 1)];
      }
      return runMarkdown || [
        "# Party and Officer Map",
        "",
        "| Name | Role | Evidence |",
        "| --- | --- | --- |",
        "| Ayesha | Client | Matter context (FILE-0001 p1.b1) |",
      ].join("\n");
    },
  });
  return { service, matterRoot, runLedger };
}

function makeIdea(id) {
  return {
    id,
    text: "new skill: discover formal party names, officers, aliases, and relationships",
    designBrief: PARTY_BRIEF,
  };
}

function makeImprovementIdea(id) {
  return {
    id,
    text: "Improve /party_officer_map: include relationship confidence and unresolved aliases",
    designBrief: {
      ...PARTY_BRIEF,
      problem: "Improve Party and Officer Map based on real use: include relationship confidence and unresolved aliases",
      notes: [
        "Proposal type: Improve existing skill",
        "Target skill: /party_officer_map",
        "What should change: include relationship confidence and unresolved aliases",
        "What must stay unchanged: Do not change the active skill until a revised sample is generated, approved, validated, and activated as a new version.",
      ].join("\n"),
    },
  };
}

function makeSample(id, markdown = null) {
  const ideaId = id === "sample_party_1"
    ? "idea_party_1"
    : id === "sample_party_improve"
      ? "idea_party_improve"
      : "idea_party_2";
  return {
    id,
    ideaId,
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

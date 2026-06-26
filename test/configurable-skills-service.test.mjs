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

test("configurable skills mark the source idea created after successful activation", async () => {
  const { service, statusUpdates } = await makeServiceHarness();

  const created = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });

  assert.equal(created.skill.status, "active");
  assert.deepEqual(statusUpdates, [{ id: "idea_party_1", status: "created" }]);
});

test("configurable skills append a local custom_skill.created matter event after activation", async () => {
  const events = [];
  const { service } = await makeServiceHarness({
    matterEventsService: {
      appendEvent: async (event) => {
        events.push(event);
        return event;
      },
    },
  });

  const created = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });

  assert.equal(created.skill.status, "active");
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "custom_skill.created");
  assert.equal(events[0].matterName, "Ayesha Vs Japan Airlines");
  assert.deepEqual(events[0].object, { type: "custom_skill", id: "skill_1", label: "Party and Officer Map" });
  assert.equal(events[0].payload.source_idea_id, "idea_party_1");
  assert.equal(events[0].payload.source_sample_id, "sample_party_1");
  assert.equal(events[0].payload.slash, "/party_officer_map");
  assert.equal(events[0].idempotencyKey, "custom_skill.created:skill_1:v1");
  assert.doesNotMatch(JSON.stringify(events[0]), /FILE-0001|sampleMarkdown|evidence_blocks/i);
});

test("configurable skills provide custom_skill.created SQL for runtime DB activation transactions", async () => {
  const sqlEvents = [];
  const storeState = { schema_version: "configurable-skills/v1", skills: [] };
  const skillStore = {
    readStore: async () => storeState,
    updateStore: async (mutator, options = {}) => {
      const result = await mutator(storeState);
      if (typeof options.afterWriteSql === "function") {
        sqlEvents.push(options.afterWriteSql({ result, store: storeState }));
      }
      return result;
    },
  };
  const appendedEvents = [];
  const { service } = await makeServiceHarness({
    skillStore,
    matterEventsService: {
      appendEventMutationSql: (event) => {
        sqlEvents.push(event);
        return "insert into matter_events (...) values (...);";
      },
      appendEvent: async (event) => {
        appendedEvents.push(event);
      },
    },
  });

  const created = await service.createSkillFromApprovedSample({
    ideaId: "idea_party_1",
    matterRecordOverride: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Runtime Matter",
    },
  });

  assert.equal(created.skill.status, "active");
  assert.equal(appendedEvents.length, 0);
  const event = sqlEvents.find((entry) => entry && typeof entry === "object" && entry.eventType === "custom_skill.created");
  assert.ok(event, "expected custom_skill.created event to be passed to appendEventMutationSql");
  assert.equal(event.matterId, "22222222-2222-4222-8222-222222222222");
  assert.equal(event.matterName, "Runtime Matter");
  assert.equal(event.object.id, "skill_1");
  assert.equal(event.payload.source_idea_id, "idea_party_1");
  assert.equal(event.idempotencyKey, "custom_skill.created:skill_1:v1");
  assert.ok(sqlEvents.includes("insert into matter_events (...) values (...);"));
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

test("active configurable skill runs can use a materialized runtime DB matter root", async () => {
  const { service, matterRoot } = await makeServiceHarness();
  await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });
  const materializedMatterRoot = await mkdtemp(path.join(os.tmpdir(), "configurable-skill-db-materialized-"));
  await writeFile(path.join(materializedMatterRoot, "matter.json"), `${JSON.stringify({
    matter_name: "Runtime DB Matter",
    client_name: "Runtime Client",
    opposite_party: "Runtime Opposite",
    matter_type: "consumer dispute",
    jurisdiction: "India",
    intakes: [],
  }, null, 2)}\n`);

  const result = await service.runSkill({
    slash: "/party_officer_map",
    matterName: "Runtime DB Matter",
    matterRootOverride: materializedMatterRoot,
    matterRecordOverride: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Runtime DB Matter",
      matterName: "Runtime DB Matter",
      runtimeStorageMode: "postgres",
    },
  });

  assert.equal(result.state, "written");
  assert.equal(result.runRecord.matterFolder, "Runtime DB Matter");
  assert.equal(result.runRecord.matterRoot, "postgres:Runtime DB Matter");
  assert.equal(result.runRecord.receipt.receiptState, "completed");
  assert.notEqual(matterRoot, materializedMatterRoot);
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

test("configurable skill lifecycle pauses, archives, restores, and soft-deletes custom skills", async () => {
  const { service, runLedger, matterRoot } = await makeServiceHarness();
  const created = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });
  const firstRun = await service.runSkill({ slash: "/party_officer_map" });

  const paused = await service.updateSkillLifecycle({
    skillId: created.skill.id,
    action: "suspend",
    reason: "Pause during beta cleanup.",
  });
  assert.equal(paused.skill.status, "suspended");
  assert.equal(paused.skill.lifecycle.reason, "Pause during beta cleanup.");
  await assert.rejects(
    () => service.runSkill({ slash: "/party_officer_map" }),
    /paused/i,
  );
  assert.deepEqual((await service.activeSkillCards()).map((skill) => skill.slash), []);

  const resumed = await service.updateSkillLifecycle({ skillId: created.skill.id, action: "resume" });
  assert.equal(resumed.skill.status, "active");
  assert.deepEqual((await service.activeSkillCards()).map((skill) => skill.slash), ["/party_officer_map"]);

  const archived = await service.updateSkillLifecycle({ skillId: created.skill.id, action: "archive" });
  assert.equal(archived.skill.status, "archived");
  await assert.rejects(
    () => service.runSkill({ slash: "/party_officer_map" }),
    /archived/i,
  );

  const restored = await service.updateSkillLifecycle({ skillId: created.skill.id, action: "restore" });
  assert.equal(restored.skill.status, "suspended");

  const deleted = await service.updateSkillLifecycle({ skillId: created.skill.id, action: "delete" });
  assert.equal(deleted.skill.status, "deleted");
  assert.deepEqual((await service.listSkills()).skills, []);
  const runs = await runLedger.listRuns({ slash: "/party_officer_map" });
  assert.equal(runs.runs.length, 1);
  assert.equal(runs.runs[0].id, firstRun.runRecord.id);
  const markdown = await readFile(path.join(matterRoot, "20_Workshop", "Party and Officer Map.md"), "utf8");
  assert.match(markdown, /^# Party and Officer Map/);
});

test("configurable skill lifecycle rejects previous versions and resume slash collisions", async () => {
  const { service } = await makeServiceHarness();
  const first = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });
  await service.createSkillFromApprovedSample({ ideaId: "idea_party_improve" });
  const listed = await service.listSkills({ includeDeleted: true });
  const previous = listed.skills.find((skill) => skill.id === first.skill.id);
  const active = listed.skills.find((skill) => skill.status === "active" && skill.slash === "/party_officer_map");

  assert.equal(previous.status, "disabled");
  await assert.rejects(
    () => service.updateSkillLifecycle({ skillId: previous.id, action: "suspend" }),
    /previous versions/i,
  );

  await service.updateSkillLifecycle({ skillId: active.id, action: "suspend" });
  const store = JSON.parse(await readFile(service.storePath, "utf8"));
  store.skills.push({
    ...store.skills.find((skill) => skill.id === active.id),
    id: "skill_collision",
    status: "active",
    version: 99,
    familyId: "skill_collision",
  });
  await writeFile(service.storePath, `${JSON.stringify(store, null, 2)}\n`);

  await assert.rejects(
    () => service.updateSkillLifecycle({ skillId: active.id, action: "resume" }),
    /already uses \/party_officer_map/i,
  );
});

test("configurable skill lifecycle rejects invalid transitions without mutating status", async () => {
  const { service } = await makeServiceHarness();
  const created = await service.createSkillFromApprovedSample({ ideaId: "idea_party_1" });

  await assert.rejects(
    () => service.updateSkillLifecycle({ skillId: created.skill.id, action: "restore" }),
    /Cannot restore a custom skill with status active/i,
  );
  assert.equal((await service.listSkills()).skills.find((skill) => skill.id === created.skill.id).status, "active");

  await service.updateSkillLifecycle({ skillId: created.skill.id, action: "suspend" });
  await assert.rejects(
    () => service.updateSkillLifecycle({ skillId: created.skill.id, action: "restore" }),
    /Cannot restore a custom skill with status suspended/i,
  );
  assert.equal((await service.listSkills()).skills.find((skill) => skill.id === created.skill.id).status, "suspended");

  await service.updateSkillLifecycle({ skillId: created.skill.id, action: "delete" });
  await assert.rejects(
    () => service.updateSkillLifecycle({ skillId: created.skill.id, action: "resume" }),
    /Deleted custom skills cannot be changed/i,
  );
  const withDeleted = await service.listSkills({ includeDeleted: true });
  assert.equal(withDeleted.skills.find((skill) => skill.id === created.skill.id).status, "deleted");
});

async function makeServiceHarness({ sampleMarkdown, runMarkdown, runMarkdownSequence = null, authoredSlash = "/party_officer_map", failRuntimeAfterValidation = false, matterEventsService = null, skillStore = null } = {}) {
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
  const statusUpdates = [];
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
      updateIdeaStatus: async (id, status) => {
        statusUpdates.push({ id, status });
        return { idea: { ...ideas.get(id), status } };
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
    matterEventsService,
    skillStore,
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
  return { service, matterRoot, runLedger, statusUpdates };
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

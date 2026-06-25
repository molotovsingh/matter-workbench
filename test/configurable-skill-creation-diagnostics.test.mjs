import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { handleSkillFactoryApiRequest } from "../routes/skill-factory-routes.mjs";
import { createSkillFromApprovedSampleInStore } from "../services/configurable-skill-creation-pipeline.mjs";

test("configurable skill creation pipeline exposes stable validation and target codes", async () => {
  await assertRejectsWithCode(
    () => createSkillFromApprovedSampleInStore({ store: { skills: [] }, sample: sample() }),
    400,
    "configurable_skill_creation.idea_required",
  );
  await assertRejectsWithCode(
    () => createSkillFromApprovedSampleInStore({ store: { skills: [] }, idea: idea() }),
    400,
    "configurable_skill_creation.approved_sample_required",
  );
  await assertRejectsWithCode(
    () => createSkillFromApprovedSampleInStore({
      store: { skills: [] },
      idea: idea({ text: "Improve /missing_skill: add confidence notes" }),
      sample: sample(),
    }),
    409,
    "configurable_skill_creation.target_skill_not_found",
  );
  const failedDraft = await createSkillFromApprovedSampleInStore({
    store: { skills: [] },
    idea: idea(),
    sample: sample({ sampleMarkdown: "# Party Map\n\nNo raw citation here." }),
    matterStore: {},
    authoringProvider,
    runProvider: async () => "# Party Map\n\nAyesha evidence (FILE-0001 p1.b1)",
    idFactory: () => "skill_1",
  });
  assert.equal(failedDraft.validationError.statusCode, 422);
  assert.equal(failedDraft.validationError.code, "configurable_skill_creation.draft_validation_failed");
});

test("Skill Factory route guards expose stable diagnostic codes", async () => {
  await assertRejectsWithCode(
    () => dispatchSkillFactoryRoute({
      method: "POST",
      path: "/api/configurable-skills/run",
      body: { slash: "/demo_skill" },
      services: runtimeDbRouteServices(),
    }),
    409,
    "skill_factory.matter_required",
  );

  await assertRejectsWithCode(
    () => dispatchSkillFactoryRoute({
      method: "POST",
      path: "/api/skill-ideas/idea_1/create-skill",
      body: {},
      services: runtimeDbRouteServices({
        skillIdeasService: {
          getIdea: async () => idea({
            text: "new skill: map parties and officers",
            designBrief: {
              problem: "Map parties and officers.",
              expectedOutputArtifact: "20_Workshop/Party Map.md",
              targetLane: "20_Workshop",
            },
          }),
        },
        skillRouterService: {
          checkIntent: async () => ({ user_gate_required: true, matched_skill: "/party_map" }),
        },
      }),
    }),
    409,
    "skill_factory.overlap_not_cleared",
  );
});

test("configurable skill creation pipeline exposes stable provider key codes", async () => {
  await assertRejectsWithCode(
    () => createSkillFromApprovedSampleInStore({
      store: { skills: [] },
      idea: idea(),
      sample: sample(),
      env: { SKILL_AUTHORING_PROVIDER: "openrouter" },
      idFactory: () => "skill_1",
    }),
    409,
    "configurable_skill_provider.api_key_required",
  );
  const runProviderResult = await createSkillFromApprovedSampleInStore({
    store: { skills: [] },
    idea: idea(),
    sample: sample(),
    authoringProvider,
    matterContextPacketOverride: {
      matter: { matter_name: "Ayesha Vs Japan Airlines", client_name: "Ayesha", opposite_party: "Japan Airlines" },
      warnings: [],
      sources: [],
      evidence_blocks: [],
    },
    env: { CONFIGURABLE_SKILL_RUN_PROVIDER: "openrouter" },
    idFactory: () => "skill_1",
  });
  assert.equal(runProviderResult.validationError.statusCode, 422);
  assert.equal(runProviderResult.validationError.code, "configurable_skill_creation.draft_validation_failed");
  assert.match(runProviderResult.validationError.message, /OPENROUTER_API_KEY is required/);
});

async function dispatchSkillFactoryRoute({ method, path: routePath, body = {}, services = {} } = {}) {
  const request = Readable.from([JSON.stringify(body)]);
  request.method = method;
  const response = {
    writeHead() {},
    end() {},
  };
  return handleSkillFactoryApiRequest({
    request,
    requestUrl: new URL(routePath, "http://localhost"),
    response,
    services,
  });
}

function runtimeDbRouteServices(overrides = {}) {
  return {
    configurableSkillsService: {},
    configurableSkillRunsService: {},
    jobStatusService: null,
    matterStore: {
      hasRuntimeDbStorageMode: () => true,
      activeMatterNameWithinHome: () => "",
      resolveExistingMatter: async (name) => ({ name, matterName: name }),
    },
    runtimeDbStorageService: {
      enabled: true,
      runMaterializedMatterRead: async (_matter, operation) => operation({ matterRoot: "/tmp/matter" }),
      runMaterializedMatterWrite: async (_matter, operation) => ({
        operationResult: await operation({ matterRoot: "/tmp/matter" }),
      }),
    },
    privateBetaSignalService: null,
    skillFactoryHealthService: {},
    skillIdeasService: { getIdea: async () => idea() },
    skillInterviewPlannerService: {},
    skillRegistryService: {},
    skillRouterService: { checkIntent: async () => ({}) },
    skillSamplesService: {},
    skillSampleOutputService: {},
    ...overrides,
  };
}

function idea(overrides = {}) {
  return {
    id: "idea_1",
    text: "new skill: map parties and officers",
    designBrief: {
      intendedUser: "Litigation team",
      problem: "Map parties and officers.",
      expectedOutputArtifact: "20_Workshop/Party Map.md",
      targetLane: "20_Workshop",
    },
    ...overrides,
  };
}

function sample(overrides = {}) {
  return {
    id: "sample_1",
    ideaId: "idea_1",
    approved: true,
    designBriefHash: "hash_1",
    matter: { matter_name: "Ayesha Vs Japan Airlines", folder_name: "Ayesha Vs Japan Airlines" },
    sampleMarkdown: "# Party Map\n\nAyesha appears in the matter metadata (FILE-0001 p1.b1).",
    ...overrides,
  };
}

async function authoringProvider() {
  return {
    title: "Party Map",
    slash: "/party_map",
    description: "Map parties and officers.",
    target_lane: "20_Workshop",
    output_artifact: "20_Workshop/Party Map.md",
    matter_required: true,
    paid_provider_call: true,
    source_backed: "required",
    prompt: "Build a source-backed party and officer map for the active matter. Every factual statement must cite readable source labels and raw FILE-NNNN pX.bY citations. Mark uncertainty clearly.",
    citation_policy: "Every factual statement must cite readable source labels and raw FILE-NNNN pX.bY citations.",
  };
}

async function assertRejectsWithCode(fn, statusCode, code) {
  await assert.rejects(
    fn,
    (error) => error.statusCode === statusCode && error.code === code,
  );
}

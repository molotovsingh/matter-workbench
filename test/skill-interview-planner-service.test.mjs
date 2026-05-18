import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenAiSkillInterviewPlannerProvider,
  createOpenRouterSkillInterviewPlannerProvider,
  createSkillInterviewPlannerService,
  SKILL_INTERVIEW_PLAN_SCHEMA,
} from "../services/skill-interview-planner-service.mjs";

function fakeRegistryService() {
  return {
    async readRegistry() {
      return {
        skills: [{
          slash: "/create_listofdates",
          title: "Create List of Dates",
          purpose: "Create a lawyer-facing chronology.",
          inputs: ["extraction records", "Source Index.json"],
          outputs: ["10_Library/List of Dates.md"],
          default_lane: "10_Library",
          source_backed: "required",
          paid_provider_call: true,
        }],
      };
    },
  };
}

function fakeMatterStore() {
  return {
    getMatterRoot: () => "/tmp/matter",
    activeMatterNameWithinHome: () => "Demo Matter",
    async resolveExistingMatter(name) {
      return { matterPath: `/tmp/${name.replaceAll(" ", "-")}` };
    },
    async readMatterMetadata(root = "/tmp/matter") {
      if (root.endsWith("Other-Matter")) {
        return {
          matterName: "Other Matter",
          matterType: "Arbitration",
          jurisdiction: "Delhi",
          clientName: "Other Client",
          oppositeParty: "Other Opponent",
        };
      }
      return {
        matterName: "Demo Matter",
        matterType: "Civil recovery",
        jurisdiction: "India",
        clientName: "Client A",
        oppositeParty: "Opponent B",
        ignoredRawText: "This should not be sent.",
      };
    },
  };
}

test("skill interview planner returns deterministic fallback when disabled", async () => {
  let providerCalled = false;
  const service = createSkillInterviewPlannerService({
    registryService: fakeRegistryService(),
    matterStore: fakeMatterStore(),
    env: {},
    plannerProvider: async () => {
      providerCalled = true;
      return {};
    },
  });

  const result = await service.planInterview({
    userRequest: "draft a client update email",
    skillIdea: { text: "draft a client update email", mode: "new_skill" },
  });

  assert.equal(providerCalled, false);
  assert.equal(result.schema_version, "skill-interview-plan/v1");
  assert.equal(result.planner.used, false);
  assert.equal(result.plan, null);
});

test("skill interview planner can use an explicit matter without active-matter drift", async () => {
  let received = null;
  const service = createSkillInterviewPlannerService({
    registryService: fakeRegistryService(),
    matterStore: fakeMatterStore(),
    env: {
      SKILL_INTERVIEW_PLANNER_ENABLED: "1",
      SKILL_INTERVIEW_PLANNER_PROVIDER: "openrouter",
      OPENROUTER_SKILL_INTERVIEW_PLANNER_MODEL: "openai/gpt-4.1",
    },
    plannerProvider: async (payload) => {
      received = payload;
      return {
        mode: "new_skill",
        target_skill: "",
        understood_summary: "You want a matter-specific skill.",
        inferred_design_brief: {},
        default_assumptions: [],
        questions: [],
        open_questions: [],
        risk_flags: [],
      };
    },
  });

  await service.planInterview({
    userRequest: "create a skill for this matter",
    skillIdea: { text: "create a skill for this matter" },
    matterName: "Other Matter",
  });

  assert.deepEqual(received.activeMatter, {
    matterName: "Other Matter",
    matterType: "Arbitration",
    jurisdiction: "Delhi",
    client: "Other Client",
    oppositeParty: "Other Opponent",
  });
});

test("skill interview planner sends only idea, matter metadata, and skill summaries", async () => {
  let received = null;
  const service = createSkillInterviewPlannerService({
    registryService: fakeRegistryService(),
    matterStore: fakeMatterStore(),
    env: {
      SKILL_INTERVIEW_PLANNER_ENABLED: "1",
      SKILL_INTERVIEW_PLANNER_PROVIDER: "openrouter",
      OPENROUTER_SKILL_INTERVIEW_PLANNER_MODEL: "openai/gpt-4.1",
    },
    plannerProvider: async (payload) => {
      received = payload;
      return {
        mode: "new_skill",
        target_skill: "",
        understood_summary: "You want a client update email skill.",
        inferred_design_brief: {
          intendedUser: "Lawyer",
          problem: "Draft careful client updates from reviewed matter artifacts.",
          expectedInputs: "List of Dates and lawyer instructions.",
          expectedOutputArtifact: "30_Drafts/Client Update Email.md",
          targetLane: "30_Drafts",
          paidPosture: "paid",
          riskLevel: "high",
          notes: "Do not expose raw FILE citations in the client-facing email.",
        },
        default_assumptions: ["Source-backed reasoning remains internal."],
        questions: [{
          id: "emailPurpose",
          label: "What should the email accomplish?",
          help: "Choose the communication goal.",
          examples: ["reassure client", "request documents", "explain next steps"],
        }],
        open_questions: [],
        risk_flags: ["External-facing draft requires lawyer review."],
      };
    },
  });

  const result = await service.planInterview({
    userRequest: "it should read list of dates and draft a warm client email",
    skillIdea: {
      type: "skill_idea",
      mode: "new_skill",
      text: "it should read list of dates and draft a warm client email",
      idea: "it should read list of dates and draft a warm client email",
    },
  });

  assert.equal(result.planner.used, true);
  assert.equal(result.plan.inferred_design_brief.expectedOutputArtifact, "30_Drafts/Client Update Email.md");
  assert.equal(received.userRequest, "it should read list of dates and draft a warm client email");
  assert.equal(received.schema.properties.questions.minItems, 0);
  assert.equal(received.schema.properties.questions.maxItems, 10);
  assert.ok(received.schema === SKILL_INTERVIEW_PLAN_SCHEMA);
  assert.deepEqual(received.activeMatter, {
    matterName: "Demo Matter",
    matterType: "Civil recovery",
    jurisdiction: "India",
    client: "Client A",
    oppositeParty: "Opponent B",
  });
  assert.deepEqual(received.skillRegistry, [{
    slash: "/create_listofdates",
    title: "Create List of Dates",
    purpose: "Create a lawyer-facing chronology.",
    inputs: ["extraction records", "Source Index.json"],
    outputs: ["10_Library/List of Dates.md"],
    lane: "10_Library",
    sourceBacked: "required",
    paidProviderCall: true,
  }]);
  assert.doesNotMatch(JSON.stringify(received), /ignoredRawText|Source Index body|List of Dates body|API_KEY/);
});

test("OpenRouter skill interview planner sends strict no-fallback JSON-schema request", async () => {
  const requests = [];
  const provider = createOpenRouterSkillInterviewPlannerProvider({
    apiKey: "or-key",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "openai/gpt-4.1",
    maxOutputTokens: 1800,
    timeoutMs: 45000,
    fetchImpl: async (endpoint, options) => {
      requests.push({ endpoint, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  mode: "new_skill",
                  target_skill: "",
                  understood_summary: "You want a client email skill.",
                  inferred_design_brief: {
                    intendedUser: "Lawyer",
                    problem: "Draft client update email.",
                    expectedInputs: "List of Dates.",
                    expectedOutputArtifact: "30_Drafts/Client Update Email.md",
                    targetLane: "30_Drafts",
                    paidPosture: "paid",
                    riskLevel: "high",
                    notes: "Client-facing draft.",
                  },
                  default_assumptions: [],
                  questions: [{
                    id: "tone",
                    label: "What tone should it use?",
                    help: "Choose the client-facing tone.",
                    examples: ["warm", "formal"],
                  }],
                  open_questions: [],
                  risk_flags: [],
                }),
              },
            }],
          };
        },
      };
    },
  });

  const plan = await provider({
    userRequest: "draft client update email",
    skillIdea: { mode: "new_skill", text: "draft client update email" },
    activeMatter: { matterName: "Demo" },
    skillRegistry: [{ slash: "/create_listofdates" }],
    designBrief: {},
    schema: { type: "object", properties: {}, additionalProperties: true },
  });

  assert.equal(plan.inferred_design_brief.expectedOutputArtifact, "30_Drafts/Client Update Email.md");
  assert.equal(requests[0].endpoint, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(requests[0].body.model, "openai/gpt-4.1");
  assert.equal(requests[0].body.max_tokens, 1800);
  assert.equal(requests[0].body.provider.require_parameters, true);
  assert.equal(requests[0].body.provider.allow_fallbacks, false);
  assert.equal(requests[0].body.response_format.type, "json_schema");
  assert.equal(requests[0].body.response_format.json_schema.strict, true);
  assert.match(requests[0].body.messages[0].content, /Policy prompt version: legal-workbench-policy\/v1/);
  assert.match(requests[0].body.messages[0].content, /Custom skill policy/);
  assert.match(requests[0].body.messages[0].content, /must not generate runnable skill code/i);
  assert.match(requests[0].body.messages[0].content, /up to about ten questions/i);
  assert.match(requests[0].body.messages[0].content, /detailed step-by-step skill specification, return zero questions/i);
  assert.doesNotMatch(requests[0].body.messages[0].content, /at most three/i);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /extraction records body|Source Index body|List of Dates body/);
});

test("OpenAI direct skill interview planner sends strict Responses JSON-schema request", async () => {
  const requests = [];
  const provider = createOpenAiSkillInterviewPlannerProvider({
    apiKey: "sk-openai",
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-5.4",
    maxOutputTokens: 2600,
    timeoutMs: 90000,
    fetchImpl: async (endpoint, options) => {
      requests.push({
        endpoint,
        headers: options.headers,
        body: JSON.parse(options.body),
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            output: [{
              content: [{
                text: JSON.stringify({
                  mode: "new_skill",
                  target_skill: "",
                  understood_summary: "You want a client email skill.",
                  inferred_design_brief: {
                    intendedUser: "Lawyer",
                    problem: "Draft client update email.",
                    expectedInputs: "List of Dates.",
                    expectedOutputArtifact: "30_Drafts/Client Update Email.md",
                    targetLane: "30_Drafts",
                    paidPosture: "paid",
                    riskLevel: "high",
                    notes: "Client-facing draft.",
                  },
                  default_assumptions: [],
                  questions: [{
                    id: "tone",
                    label: "What tone should it use?",
                    help: "Choose the client-facing tone.",
                    examples: ["warm", "formal"],
                  }],
                  open_questions: [],
                  risk_flags: [],
                }),
              }],
            }],
          };
        },
      };
    },
  });

  const plan = await provider({
    userRequest: "draft client update email",
    skillIdea: { mode: "new_skill", text: "draft client update email" },
    activeMatter: { matterName: "Demo" },
    skillRegistry: [{ slash: "/create_listofdates" }],
    designBrief: {},
    schema: { type: "object", properties: {}, additionalProperties: true },
  });

  assert.equal(plan.inferred_design_brief.expectedOutputArtifact, "30_Drafts/Client Update Email.md");
  assert.equal(requests[0].endpoint, "https://api.openai.com/v1/responses");
  assert.equal(requests[0].headers.authorization, "Bearer sk-openai");
  assert.equal(requests[0].body.model, "gpt-5.4");
  assert.equal(requests[0].body.max_output_tokens, 2600);
  assert.equal(requests[0].body.text.format.type, "json_schema");
  assert.equal(requests[0].body.text.format.strict, true);
  assert.equal(requests[0].body.text.format.name, "skill_interview_plan");
  assert.match(requests[0].body.input[0].content, /must not generate runnable skill code/i);
  assert.match(requests[0].body.input[0].content, /up to about ten questions/i);
  assert.match(requests[0].body.input[0].content, /detailed step-by-step skill specification, return zero questions/i);
  assert.doesNotMatch(requests[0].body.input[0].content, /at most three/i);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /extraction records body|Source Index body|List of Dates body/);
});

test("skill interview planner can use OpenAI direct gpt-5.4 provider policy", async () => {
  const requests = [];
  const service = createSkillInterviewPlannerService({
    registryService: fakeRegistryService(),
    matterStore: fakeMatterStore(),
    env: {
      SKILL_INTERVIEW_PLANNER_ENABLED: "1",
      SKILL_INTERVIEW_PLANNER_PROVIDER: "openai-direct",
      OPENAI_API_KEY: "sk-openai",
      OPENAI_SKILL_INTERVIEW_PLANNER_MODEL: "gpt-5.4",
      OPENAI_SKILL_INTERVIEW_PLANNER_MAX_OUTPUT_TOKENS: "2600",
      OPENAI_SKILL_INTERVIEW_PLANNER_TIMEOUT_MS: "90000",
    },
    fetchImpl: async (endpoint, options) => {
      requests.push({ endpoint, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            output: [{
              content: [{
                text: JSON.stringify({
                  mode: "new_skill",
                  target_skill: "",
                  understood_summary: "You want a client update email skill.",
                  inferred_design_brief: {
                    intendedUser: "Lawyer",
                    problem: "Draft careful client updates from reviewed matter artifacts.",
                    expectedInputs: "List of Dates and lawyer instructions.",
                    expectedOutputArtifact: "30_Drafts/Client Update Email.md",
                    targetLane: "30_Drafts",
                    paidPosture: "paid",
                    riskLevel: "high",
                    notes: "Do not expose raw FILE citations in the client-facing email.",
                  },
                  default_assumptions: ["Source-backed reasoning remains internal."],
                  questions: [{
                    id: "emailPurpose",
                    label: "What should the email accomplish?",
                    help: "Choose the communication goal.",
                    examples: ["reassure client", "explain next steps"],
                  }],
                  open_questions: [],
                  risk_flags: ["External-facing draft requires lawyer review."],
                }),
              }],
            }],
          };
        },
      };
    },
  });

  const result = await service.planInterview({
    userRequest: "it should read list of dates and draft a warm client email",
    skillIdea: {
      type: "skill_idea",
      mode: "new_skill",
      text: "it should read list of dates and draft a warm client email",
      idea: "it should read list of dates and draft a warm client email",
    },
  });

  assert.equal(result.planner.used, true);
  assert.equal(result.planner.provider, "openai-direct");
  assert.equal(result.planner.model, "gpt-5.4");
  assert.equal(result.planner.policyPromptVersion, "legal-workbench-policy/v1");
  assert.equal(result.plan.inferred_design_brief.expectedOutputArtifact, "30_Drafts/Client Update Email.md");
  assert.equal(requests[0].endpoint, "https://api.openai.com/v1/responses");
  assert.equal(requests[0].body.model, "gpt-5.4");
});

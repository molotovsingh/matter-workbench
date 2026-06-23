import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createSkillRegistryService } from "../services/skill-registry-service.mjs";
import { createSkillRouterService } from "../services/skill-router-service.mjs";

function registryService() {
  return createSkillRegistryService({ appDir: process.cwd() });
}

function legalSetting(patch = {}) {
  return {
    jurisdiction: "",
    forum: "",
    case_type: "",
    procedure_stage: "",
    side: "",
    relief_type: "",
    ...patch,
  };
}

test("skill registry lists current slash skills", async () => {
  const registry = await registryService().readRegistry();
  assert.equal(registry.schema_version, "skill-registry/v1");
  assert.deepEqual(
    registry.skills.map((skill) => skill.slash),
    ["/matter-init", "/prepare_matter", "/extract", "/describe_sources", "/context_preview", "/context_search", "/create_listofdates", "/the_story", "/doctor"],
  );
  assert.equal(registry.skills.find((skill) => skill.slash === "/create_listofdates").category, "Analyze");
});

test("direct MECE overlap requires user approval instead of creating a duplicate skill", async () => {
  const calls = [];
  const service = createSkillRouterService({
    registryService: registryService(),
    aiProvider: async (payload) => {
      calls.push(payload);
      assert.match(payload.userRequest, /timeline|chronology/i);
      assert.deepEqual(
        payload.registry.skills.map((skill) => skill.slash),
        ["/matter-init", "/prepare_matter", "/extract", "/describe_sources", "/context_preview", "/context_search", "/create_listofdates", "/the_story", "/doctor"],
      );
      assert.ok(payload.registry.skills.some((skill) => skill.slash === "/create_listofdates"));
      return {
        decision: "modify_existing_skill",
        recommended_action: "modify_existing_skill",
        matched_skill: "/create_listofdates",
        confidence: 0.94,
        reason: "The request asks for the same chronology workflow already handled by /create_listofdates.",
        user_gate_required: false,
        suggested_next_action: "Ask the user to approve modifying /create_listofdates.",
        mece_violation: true,
        legal_setting: legalSetting(),
        override_requires: ["distinct output contract", "distinct workflow stage"],
      };
    },
  });

  const result = await service.checkIntent({
    userRequest: "Create a new skill to make a case timeline / chronology from extracted records.",
  });

  assert.equal(calls.length, 1);
  assert.equal(result.decision, "needs_user_approval");
  assert.equal(result.recommended_action, "modify_existing_skill");
  assert.equal(result.matched_skill, "/create_listofdates");
  assert.equal(result.mece_violation, true);
  assert.deepEqual(result.user_gate_choices, ["Use or improve existing skill", "Create separate skill with reason"]);
});

test("skill router uses model policy env overrides for OpenAI requests", async () => {
  const bodies = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        output_text: JSON.stringify({
          decision: "adjacent_skill",
          recommended_action: "adjacent_skill",
          matched_skill: "",
          confidence: 0.7,
          reason: "No existing skill directly matches.",
          user_gate_required: false,
          suggested_next_action: "Consider a future skill.",
          mece_violation: false,
          legal_setting: legalSetting(),
          override_requires: [],
        }),
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const service = createSkillRouterService({
      registryService: registryService(),
      endpoint: `http://${address.address}:${address.port}/v1/responses`,
      env: {
        OPENAI_API_KEY: "sk-test",
        OPENAI_MODEL: "policy-router-model",
        OPENAI_ROUTER_MAX_OUTPUT_TOKENS: "777",
      },
    });

    await service.checkIntent({ userRequest: "Create a future workflow helper." });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, "policy-router-model");
  assert.equal(bodies[0].max_output_tokens, 777);
  assert.equal(bodies[0].input[0].role, "system");
  assert.match(bodies[0].input[0].content, /Policy prompt version: legal-workbench-policy\/v1/);
  assert.match(bodies[0].input[0].content, /Custom skill policy/);
  assert.match(bodies[0].input[0].content, /transient_copilot/);
  assert.match(bodies[0].input[1].content, /transient_copilot_rule/);
  assert.match(bodies[0].input[1].content, /new_skill_rule/);
  assert.equal(bodies[0].text.format.name, "skill_router_decision");
});

test("skill router uses OpenRouter when configured", async () => {
  const bodies = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                decision: "transient_copilot",
                recommended_action: "transient_copilot",
                matched_skill: "",
                confidence: 0.82,
                reason: "One-time matter question.",
                user_gate_required: false,
                suggested_next_action: "Answer from the current matter record.",
                mece_violation: false,
                legal_setting: legalSetting(),
                override_requires: [],
              }),
            },
          },
        ],
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const service = createSkillRouterService({
      registryService: registryService(),
      endpoint: `http://${address.address}:${address.port}/api/v1/chat/completions`,
      env: {
        SKILL_ROUTER_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-test",
        OPENROUTER_SKILL_ROUTER_MODEL: "openai/gpt-5.4-mini",
        OPENROUTER_SKILL_ROUTER_MAX_OUTPUT_TOKENS: "888",
        OPENROUTER_SKILL_ROUTER_TIMEOUT_MS: "30000",
      },
    });

    const result = await service.checkIntent({ userRequest: "Which NCLT sections can we use here?" });
    assert.equal(result.decision, "transient_copilot");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, "openai/gpt-5.4-mini");
  assert.equal(bodies[0].max_tokens, 888);
  assert.equal(bodies[0].messages[0].role, "system");
  assert.match(bodies[0].messages[0].content, /Policy prompt version: legal-workbench-policy\/v1/);
  assert.match(bodies[0].messages[0].content, /Custom skill policy/);
  assert.match(bodies[0].messages[1].content, /transient_copilot_rule/);
  assert.equal(bodies[0].provider.require_parameters, true);
  assert.equal(bodies[0].provider.allow_fallbacks, false);
  assert.equal(bodies[0].response_format.json_schema.name, "skill_router_decision");
  assert.equal("temperature" in bodies[0], false);
});

test("one-time matter requests can route to transient copilot instead of skill factory", async () => {
  const service = createSkillRouterService({
    registryService: registryService(),
    aiProvider: async () => ({
      decision: "transient_copilot",
      recommended_action: "transient_copilot",
      matched_skill: "",
      confidence: 0.88,
      reason: "The request asks for a one-time note for the active matter, not a reusable workflow.",
      user_gate_required: false,
      suggested_next_action: "Answer this as a one-time matter task. Ask whether to save it as a reusable skill only if the user wants repeated use.",
      mece_violation: false,
      legal_setting: legalSetting({
        jurisdiction: "India",
        case_type: "Consumer complaint",
      }),
      override_requires: [],
    }),
  });

  const result = await service.checkIntent({
    userRequest: "Make me a quick evidence gaps note for this matter.",
  });

  assert.equal(result.decision, "transient_copilot");
  assert.equal(result.recommended_action, "transient_copilot");
  assert.equal(result.user_gate_required, false);
  assert.equal(result.matched_skill, "");
  assert.match(result.suggested_next_action, /one-time matter task/i);
});

test("one-time lookup wording overrides model new-skill classification", async () => {
  const service = createSkillRouterService({
    registryService: registryService(),
    aiProvider: async () => ({
      decision: "new_skill",
      recommended_action: "new_skill",
      matched_skill: "",
      confidence: 0.84,
      reason: "The request begins with new skill.",
      user_gate_required: false,
      suggested_next_action: "Start a skill interview.",
      mece_violation: false,
      legal_setting: legalSetting(),
      override_requires: [],
    }),
  });

  const result = await service.checkIntent({
    userRequest: "new skill to find where the addendum agreement is in this matter",
  });

  assert.equal(result.decision, "transient_copilot");
  assert.equal(result.recommended_action, "transient_copilot");
  assert.equal(result.user_gate_required, false);
  assert.match(result.reason, /one-time matter task/i);
});

test("reusable lookup wording can still proceed as a new skill", async () => {
  const service = createSkillRouterService({
    registryService: registryService(),
    aiProvider: async () => ({
      decision: "new_skill",
      recommended_action: "new_skill",
      matched_skill: "",
      confidence: 0.84,
      reason: "The request asks for a reusable lookup workflow.",
      user_gate_required: false,
      suggested_next_action: "Start a skill interview.",
      mece_violation: false,
      legal_setting: legalSetting(),
      override_requires: [],
    }),
  });

  const result = await service.checkIntent({
    userRequest: "new skill to find addendum agreements across all matters",
  });

  assert.equal(result.decision, "new_skill");
  assert.equal(result.recommended_action, "new_skill");
});

test("expert legal preference is routed as skill tuning", async () => {
  const service = createSkillRouterService({
    registryService: registryService(),
    aiProvider: async () => ({
      decision: "create_or_modify_tuning",
      recommended_action: "create_or_modify_tuning",
      matched_skill: "",
      confidence: 0.86,
      reason: "This is expert guidance for future drafting/review, not a new executable workflow.",
      user_gate_required: false,
      suggested_next_action: "Save as tuning for future petition drafting and claim extraction skills.",
      mece_violation: false,
      legal_setting: legalSetting({
        jurisdiction: "India",
        forum: "Delhi High Court",
        case_type: "Rent matter",
      }),
      override_requires: [],
    }),
  });

  const result = await service.checkIntent({
    userRequest: "For Delhi rent matters, always check service of notice before drafting.",
  });

  assert.equal(result.decision, "create_or_modify_tuning");
  assert.equal(result.user_gate_required, false);
  assert.equal(result.legal_setting.forum, "Delhi High Court");
});

test("create intent cannot silently reroute to run existing skill", async () => {
  const service = createSkillRouterService({
    registryService: registryService(),
    aiProvider: async () => ({
      decision: "run_existing_skill",
      recommended_action: "run_existing_skill",
      matched_skill: "/create_listofdates",
      confidence: 0.9,
      reason: "The existing skill already handles list-of-dates generation.",
      user_gate_required: false,
      suggested_next_action: "Run /create_listofdates.",
      mece_violation: false,
      legal_setting: legalSetting(),
      override_requires: [],
    }),
  });

  const result = await service.checkIntent({
    userRequest: "Create a new skill to generate a list of dates from extracted records.",
  });

  assert.equal(result.decision, "needs_user_approval");
  assert.equal(result.recommended_action, "run_existing_skill");
  assert.equal(result.user_gate_required, true);
  assert.equal(result.mece_violation, true);
});

test("forum-specific drafting request can be adjacent without violating existing skills", async () => {
  const service = createSkillRouterService({
    registryService: registryService(),
    aiProvider: async () => ({
      decision: "adjacent_skill",
      recommended_action: "adjacent_skill",
      matched_skill: "",
      confidence: 0.81,
      reason: "The request is a Draft-stage writ workflow; no existing Draft skill is registered yet.",
      user_gate_required: false,
      suggested_next_action: "Create a markdown-first writ drafting skill or profile, not DOCX output.",
      mece_violation: false,
      legal_setting: legalSetting({
        jurisdiction: "India",
        forum: "Delhi High Court",
        case_type: "Writ Petition",
        procedure_stage: "Filing",
        side: "Petitioner",
        relief_type: "Article 226 writ",
      }),
      override_requires: [],
    }),
  });

  const result = await service.checkIntent({
    userRequest: "Create a Delhi High Court writ petition drafting skill.",
  });

  assert.equal(result.decision, "adjacent_skill");
  assert.equal(result.mece_violation, false);
  assert.equal(result.legal_setting.case_type, "Writ Petition");
  assert.match(result.suggested_next_action, /markdown/i);
});

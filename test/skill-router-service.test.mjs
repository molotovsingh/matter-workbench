import assert from "node:assert/strict";
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
    ["/matter-init", "/extract", "/create_listofdates", "/doctor"],
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
  assert.deepEqual(result.user_gate_choices, ["Approve modification", "Justify new skill"]);
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

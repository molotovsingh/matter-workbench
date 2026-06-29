import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const reactIntentRoutingPath = new URL("../react-ui/src/lib/skillIntentRouting.ts", import.meta.url);
const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);

test("React skill intent routing opens Skill Factory only for reusable new-skill decisions", async () => {
  const routing = await importReactIntentRouting();

  assert.equal(routing.shouldStartSkillIdeaSessionFromIntent({
    decision: "new_skill",
    user_gate_required: false,
    matched_skill: "",
  }), true);
  assert.equal(routing.shouldStartSkillIdeaSessionFromIntent({
    decision: "adjacent_skill",
    user_gate_required: false,
    matched_skill: "",
  }), true);
  assert.equal(routing.shouldStartSkillIdeaSessionFromIntent({
    decision: "transient_copilot",
    user_gate_required: false,
    matched_skill: "",
  }), false);
  assert.equal(routing.shouldStartSkillIdeaSessionFromIntent({
    decision: "modify_existing_skill",
    user_gate_required: false,
    matched_skill: "/create_listofdates",
  }), false);
  assert.equal(routing.shouldStartSkillIdeaSessionFromIntent({
    decision: "new_skill",
    user_gate_required: true,
    matched_skill: "",
  }), false);
  assert.match(
    routing.formatIntentDiscoveryGuidance({ decision: "transient_copilot" }),
    /answer from the active matter context/i,
  );
  assert.match(
    routing.formatIntentDiscoveryGuidance({
      decision: "new_skill",
      user_gate_required: true,
      suggested_next_action: "Ask the user whether they want to create a separate reusable skill.",
    }),
    /should I answer this once.*reusable skill/i,
  );
  assert.doesNotMatch(
    routing.formatIntentDiscoveryGuidance({
      decision: "new_skill",
      user_gate_required: true,
      suggested_next_action: "Ask the user whether they want to create a separate reusable skill.",
    }),
    /Ask the user/i,
  );
  const modificationGuidance = routing.formatIntentDiscoveryGuidance({
    decision: "modify_existing_skill",
    recommended_action: "modify_existing_skill",
    matched_skill: "/party_officer_map",
    matched_skill_card: { configurable: true },
    user_gate_required: true,
    reason: "Tell the user to approve changing /party_officer_map.",
    suggested_next_action: "Ask the user to approve modifying /party_officer_map.",
  });
  assert.match(modificationGuidance, /change to \/party_officer_map/i);
  assert.doesNotMatch(modificationGuidance, /tell the user|ask the user/i);

  assert.deepEqual(
    routing.intentChoiceLabels({
      decision: "modify_existing_skill",
      recommended_action: "modify_existing_skill",
      matched_skill: "/party_officer_map",
      matched_skill_card: { configurable: true },
      user_gate_required: true,
    }),
    {
      primary: "Improve existing skill",
      secondary: "Create separate skill",
    },
  );
  assert.deepEqual(
    routing.intentChoiceLabels({
      decision: "new_skill",
      user_gate_required: true,
    }),
    {
      primary: "Answer once",
      secondary: "Build reusable skill",
    },
  );
  assert.deepEqual(
    routing.intentChoiceLabels({
      decision: "needs_user_approval",
      recommended_action: "run_existing_skill",
      matched_skill: "/create_listofdates",
      matched_skill_card: { configurable: false },
      user_gate_required: true,
    }),
    {
      primary: "Use existing skill",
      secondary: "Create separate skill",
    },
  );
  assert.equal(
    routing.isConfigurableExistingSkillChoice({
      decision: "needs_user_approval",
      recommended_action: "run_existing_skill",
      matched_skill: "/create_listofdates",
      matched_skill_card: { configurable: false },
      user_gate_required: true,
    }),
    false,
  );
  assert.equal(
    routing.shouldAutoStartConfigurableSkillImprovement({
      decision: "modify_existing_skill",
      recommended_action: "modify_existing_skill",
      matched_skill: "/the_story",
      matched_skill_card: { configurable: true, title: "The Story" },
      user_gate_required: false,
    }, "improve The Story make it like a story no need to ground it in evidence for it"),
    true,
  );
  assert.equal(
    routing.shouldAutoStartConfigurableSkillImprovement({
      decision: "modify_existing_skill",
      recommended_action: "modify_existing_skill",
      matched_skill: "/the_story",
      matched_skill_card: { configurable: true, title: "The Story" },
      user_gate_required: false,
    }, "create another story skill"),
    false,
  );
  assert.equal(
    routing.shouldAutoStartConfigurableSkillImprovement({
      decision: "modify_existing_skill",
      recommended_action: "modify_existing_skill",
      matched_skill: "/create_listofdates",
      matched_skill_card: { configurable: false, title: "List of Dates" },
      user_gate_required: false,
    }, "improve List of Dates"),
    false,
  );
  assert.equal(
    routing.formatIntentDiscoveryReason(
      "Tell the user to approve changing /party_officer_map.",
      "Review the existing skill before creating another one.",
    ),
    "Review the existing skill before creating another one.",
  );
  assert.doesNotMatch(
    routing.formatIntentDiscoveryGuidance({
      decision: "other",
      reason: "Tell the user to approve changing the skill.",
    }),
    /tell the user|ask the user/i,
  );
});

test("React command panel checks backend intent before opening Skill Factory for skill-like text", async () => {
  const source = await readFile(commandPanelPath, "utf8");

  assert.match(source, /parseSkillIdeaText\(cmd\)/);
  assert.match(source, /api\.checkIntent\(\{ userRequest: cmd, matterName: matterName \?\? undefined \}\)/);
  assert.match(source, /getUserFacingErrorMessage\(error\)/);
  assert.match(source, /shouldStartSkillIdeaSessionFromIntent\(decision\)/);
  assert.match(source, /formatIntentDiscoveryGuidance\(decision\)/);
  assert.match(source, /shouldAutoStartConfigurableSkillImprovement\(decision, cmd\)/);
  assert.match(source, /looksLikeCustomSkillModification\(cmd, baseSuggestions\)/);
  assert.match(source, /const shouldCheckIntent = ideaParsed !== null \|\| looksLikeCustomSkillModification\(cmd, baseSuggestions\)/);
  assert.match(source, /setPendingIntentChoice\(\{ command: cmd, decision \}\)/);
  assert.match(source, /intentChoiceLabels\(pendingIntentChoice\.decision\)/);
  assert.match(source, /isConfigurableExistingSkillChoice\(pendingIntentChoice\.decision\)/);
  assert.match(source, /onCommand\(matchedSkill\)/);
  assert.match(source, /buildPendingIntentSkill\(choiceLabels\.secondary\)/);
  assert.match(source, /commandForMode\(commandMode, cmd\)/);
  assert.doesNotMatch(source, /intent check unavailable; starting interview: \$\{getErrorMessage\(error\)\}/);
  assert.doesNotMatch(source, /if \(ideaParsed !== null\) \{\s*setSkillIdeaInput\(cmd\);/);
});

test("React skill overlap gate sanitizes router guidance before rendering", async () => {
  const source = await readFile(new URL("../react-ui/src/components/command/SkillIdeaSession.tsx", import.meta.url), "utf8");

  assert.match(source, /formatIntentDiscoveryGuidance/);
  assert.match(source, /formatIntentDiscoveryReason/);
  assert.match(source, /Improve existing skill/);
  assert.match(source, /Save updates/);
  assert.doesNotMatch(source, /decision\.suggested_next_action \|\|/);
  assert.doesNotMatch(source, /<dd>\{session\.overlapGate\.decision\.reason\}<\/dd>/);
});

async function importReactIntentRouting() {
  const source = await readFile(reactIntentRoutingPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const encoded = Buffer.from(compiled, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

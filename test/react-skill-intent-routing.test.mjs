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
});

test("React command panel checks backend intent before opening Skill Factory for skill-like text", async () => {
  const source = await readFile(commandPanelPath, "utf8");

  assert.match(source, /parseSkillIdeaText\(cmd\)/);
  assert.match(source, /api\.checkIntent\(\{ userRequest: cmd, matterName: matterName \?\? undefined \}\)/);
  assert.match(source, /shouldStartSkillIdeaSessionFromIntent\(decision\)/);
  assert.match(source, /formatIntentDiscoveryGuidance\(decision\)/);
  assert.match(source, /do not remember earlier chat/i);
  assert.doesNotMatch(source, /if \(ideaParsed !== null\) \{\s*setSkillIdeaInput\(cmd\);/);
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

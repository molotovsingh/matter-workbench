import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import test from "node:test";
import ts from "typescript";

import {
  SKILL_IDEA_SESSION_COMMAND_SETS,
  classifySkillIdeaSessionInput,
} from "../shared/skill-idea-session-commands.mjs";

const reactClassifierPath = new URL("../react-ui/src/lib/skillIdeaSessionCommands.ts", import.meta.url);

test("React skill-idea session command classifier mirrors the shared classifier", async () => {
  const react = await importReactClassifier();
  assert.deepEqual(react.SKILL_IDEA_SESSION_COMMAND_SETS, SKILL_IDEA_SESSION_COMMAND_SETS);

  const cases = [
    ["cancel", { ready: true }],
    ["   ", { ready: true }],
    ["answer text", { ready: false }],
    ["save updates", { ready: true }],
    ["edit", { ready: true }],
    ["generate sample from this matter", { ready: true }],
    ["copy sample", { ready: true }],
    ["regenerate sample", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["copy sample", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["copy sample v2", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["looks useful", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["looks right", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["create skill", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["copy review packet", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["mark ready", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["open skills", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["start another idea", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["make it shorter", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: false }],
    ["make it shorter", { ready: true, hasSavedIdea: true, hasActiveSample: true, sampleApproved: true }],
  ];

  for (const [input, state] of cases) {
    assert.deepEqual(
      react.classifySkillIdeaSessionInput(input, state),
      classifySkillIdeaSessionInput(input, state),
      `React command classification drifted for ${JSON.stringify(input)}`,
    );
  }
});

async function importReactClassifier() {
  const source = await readFile(reactClassifierPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const encoded = Buffer.from(compiled, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

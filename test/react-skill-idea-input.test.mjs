import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const skillIdeaInputPath = new URL("../react-ui/src/lib/skillIdeaInput.ts", import.meta.url);

test("React skill idea input treats natural blank new-skill requests like new skill", async () => {
  const { parseSkillIdeaText } = await importReactSkillIdeaInput();

  for (const input of [
    "new skill",
    "/new_skill",
    "/newskill",
    "/new-skill",
    "make a new skill",
    "I want to make a new skill",
    "I think I want to make a new skill",
  ]) {
    assert.equal(parseSkillIdeaText(input), "", input);
  }
});

async function importReactSkillIdeaInput() {
  const source = await readFile(skillIdeaInputPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const encoded = Buffer.from(compiled, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

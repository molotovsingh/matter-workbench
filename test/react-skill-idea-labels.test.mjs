import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const helperPath = new URL("../react-ui/src/lib/skillIdeaLabels.ts", import.meta.url);
const skillsPagePath = new URL("../react-ui/src/views/SkillsPage.tsx", import.meta.url);

test("skill idea labels hide placeholder unknown copy", async () => {
  const { skillIdeaDisplayTitle } = await importHelper();

  assert.equal(
    skillIdeaDisplayTitle({
      text: "Create a reusable skill to unknown; the requested skill idea has not been described",
      designBrief: {},
    }),
    "Unfinished skill idea",
  );
  assert.equal(
    skillIdeaDisplayTitle({
      text: "Create a reusable skill to unknown",
      designBrief: {},
    }),
    "Unfinished skill idea",
  );
  assert.equal(
    skillIdeaDisplayTitle({
      text: "",
      designBrief: { problem: "Review limitation risk from the matter record" },
    }),
    "Review limitation risk from the matter record",
  );
  assert.equal(
    skillIdeaDisplayTitle({
      text: "Identify unknown defendants from the pleadings",
      designBrief: {},
    }),
    "Identify unknown defendants from the pleadings",
  );
});

test("Skills page renders saved idea labels through the display helper", async () => {
  const source = await readFile(skillsPagePath, "utf8");

  assert.match(source, /skillIdeaDisplayTitle/);
  assert.doesNotMatch(source, /<strong>\{idea\.text\}<\/strong>/);
});

async function importHelper() {
  const source = await readFile(helperPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-skill-idea-labels-"));
  const modulePath = path.join(dir, "skillIdeaLabels.mjs");
  await writeFile(modulePath, compiled);
  try {
    return await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

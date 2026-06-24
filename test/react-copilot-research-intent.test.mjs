import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const intentPath = new URL("../react-ui/src/lib/copilotResearchIntent.ts", import.meta.url);
const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);

test("research intent helper identifies legal research questions", async () => {
  const helper = await importIntentHelper();

  assert.equal(helper.shouldSuggestResearchForAsk("which sections of NCLT can we use for the IRP to execute sale deed"), true);
  assert.equal(helper.shouldSuggestResearchForAsk("find case law on section 60(5) IBC"), true);
  assert.equal(helper.shouldSuggestResearchForAsk("what are the legal options before NCLT"), true);
  assert.equal(helper.shouldSuggestResearchForAsk("what does the sale deed say"), false);
  assert.equal(helper.shouldSuggestResearchForAsk("/research which sections apply"), false);
  assert.equal(helper.shouldSuggestResearchForAsk("/ask which sections apply"), false);
});

test("command panel offers Ask-to-Research escalation without silent browsing", async () => {
  const source = await readFile(commandPanelPath, "utf8");

  assert.match(source, /shouldSuggestResearchForAsk\(cmd\)/);
  assert.match(source, /setPendingResearchChoice\(cmd\)/);
  assert.match(source, /This may need public legal research/);
  assert.match(source, /Answer from matter record/);
  assert.match(source, /Research public sources/);
  assert.match(source, /`\/ask \$\{pendingResearchChoice\}`/);
  assert.match(source, /`\/research \$\{pendingResearchChoice\}`/);
  assert.match(source, /setCommandMode\('ask'\)/);
  assert.match(source, /setCommandMode\('research'\)/);
});

async function importIntentHelper() {
  const source = await readFile(intentPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
  return import(moduleUrl);
}

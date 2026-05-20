import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const assistantSmallTalkPath = new URL("../react-ui/src/lib/assistantSmallTalk.ts", import.meta.url);
const reactAppPath = new URL("../react-ui/src/App.tsx", import.meta.url);

test("React assistant handles greetings locally instead of routing them to copilot", async () => {
  const { localAssistantReply } = await importAssistantSmallTalk();

  assert.match(localAssistantReply("hi", true) || "", /Ask me a specific question about this matter/i);
  assert.match(localAssistantReply("hello!", false) || "", /Pick a matter first/i);
  assert.equal(localAssistantReply("how many flats did the client buy?", true), null);
});

test("React command handler checks local assistant replies before backend intent discovery", async () => {
  const source = await readFile(reactAppPath, "utf8");

  assert.match(source, /const localReply = localAssistantReply\(cmd, Boolean\(state\.activeMatter\)\)/);
  assert.match(source, /if \(localReply\) \{\s*dispatch\(\{ type: 'SET_COMMAND_COPY', payload: localReply \}\)/);
  assert.match(source, /if \(localReply\)[\s\S]*?const askQuestion = parseAskCommand\(cmd\)/);
});

async function importAssistantSmallTalk() {
  const source = await readFile(assistantSmallTalkPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const encoded = Buffer.from(compiled, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const helperPath = new URL("../react-ui/src/lib/copilotThread.ts", import.meta.url);

test("Copilot thread helper bounds visible and request turns", async () => {
  const helper = await importHelper();
  let turns = [];
  for (let i = 1; i <= 14; i += 1) {
    turns = helper.appendCopilotThreadTurn(turns, {
      role: i % 2 ? "user" : "assistant",
      mode: i % 3 ? "ask" : "research",
      text: `turn ${i}`,
    });
  }

  assert.equal(turns.length, 12);
  assert.equal(turns[0].text, "turn 3");

  const conversation = helper.boundedConversationForRequest([
    { role: "user", mode: "ask", text: "older" },
    ...turns,
    { role: "assistant", mode: "research", text: "x".repeat(1400) },
  ]);

  assert.equal(conversation.length, 6);
  assert.equal(conversation.at(-1).content.length, 1200);
  assert.deepEqual(Object.keys(conversation.at(-1)), ["role", "mode", "content"]);
});

async function importHelper() {
  const source = await readFile(helperPath, "utf8");
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

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const feedbackHelperPath = new URL("../react-ui/src/lib/privateBetaFeedback.ts", import.meta.url);

async function importFeedbackHelperModule() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "react-private-beta-feedback-test-"));
  const source = await readFile(feedbackHelperPath, "utf8");
  await writeFile(path.join(tempDir, "privateBetaFeedback.mjs"), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText);
  return import(`${pathToFileURL(path.join(tempDir, "privateBetaFeedback.mjs")).href}?t=${Date.now()}`);
}

test("React feedback helper lets one plain problem sentence become a saveable report", async () => {
  const { buildPrivateBetaFeedbackDraft, hasPrivateBetaFeedbackDraftText } = await importFeedbackHelperModule();

  const draft = {
    choice: "",
    tryingToDo: "",
    happenedInstead: "The Save button showed a blocked cursor.",
  };

  assert.equal(hasPrivateBetaFeedbackDraftText(draft), true);
  assert.deepEqual(buildPrivateBetaFeedbackDraft(draft), {
    choice: "did_not_work",
    tryingToDo: "The Save button showed a blocked cursor.",
    happenedInstead: "The Save button showed a blocked cursor.",
  });
});

test("React feedback helper treats a blank form as unsaveable", async () => {
  const { buildPrivateBetaFeedbackDraft, hasPrivateBetaFeedbackDraftText } = await importFeedbackHelperModule();

  const draft = {
    choice: "",
    tryingToDo: "   ",
    happenedInstead: "",
  };

  assert.equal(hasPrivateBetaFeedbackDraftText(draft), false);
  assert.equal(buildPrivateBetaFeedbackDraft(draft), null);
});

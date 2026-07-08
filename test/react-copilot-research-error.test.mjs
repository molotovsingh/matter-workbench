import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const answerPath = new URL("../react-ui/src/lib/matterCopilotAnswer.ts", import.meta.url);

test("research errors use Research-specific recovery copy", async () => {
  const helper = await importAnswerHelpers();

  assert.equal(
    helper.formatMatterCopilotResearchError("Provider billing quota exceeded"),
    "Research could not complete. You can retry Research or use Ask to answer from the matter record.",
  );
  assert.equal(
    helper.formatMatterCopilotResearchError("Public research took too long"),
    "Public research took too long. You can retry Research or use Ask to answer from the matter record.",
  );
  assert.equal(
    helper.formatMatterCopilotResearchError("I could not find useful public sources."),
    "I could not find useful public sources. You can retry with a narrower research question or use Ask to answer from the matter record.",
  );
});

async function importAnswerHelpers() {
  let source = await readFile(answerPath, "utf8");
  source = source
    .replace(/import[^\n]+legal-source-ids\.mjs';\n/, "const isStatuteSourceId = (value) => /^STATUTE-\\d{4}$/i.test(String(value || '').trim());\n")
    .replace(/import[^\n]+user-facing-ai-language-policy\.js';\n/, `const USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE = "Assistant is temporarily unavailable. You can continue using the workspace.";\nconst containsUserFacingRestrictedAiLanguage = (value) => /openai|openrouter|gpt|llm|api[\\s_-]*key|provider|model|quota|billing|credits?|insufficient[\\s_-]*funds/i.test(String(value || ""));\nconst isAssistantAvailabilityError = (value) => /user not found|auth|unauthorized|forbidden|permission denied|access denied|invalid credentials/i.test(String(value || "")) || containsUserFacingRestrictedAiLanguage(value);\n`)
    .replace(/import[^\n]+secretRedaction';\n/, "const redactSensitiveText = (value) => String(value || '');\n")
    .replace(/import type[^\n]+;\n/, "");
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { containsUserFacingRestrictedAiLanguage, USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE } from "../shared/user-facing-ai-language-policy.js";

const matterCopilotAnswerPath = new URL("../react-ui/src/lib/matterCopilotAnswer.ts", import.meta.url);
const reactSecretRedactionPath = new URL("../react-ui/src/lib/secretRedaction.ts", import.meta.url);
const userFacingPolicyUrl = new URL("../shared/user-facing-ai-language-policy.js", import.meta.url).href;

async function loadMatterCopilotAnswerModule() {
  const secretRedactionUrl = await transpiledDataUrl(reactSecretRedactionPath);
  const source = await readFile(matterCopilotAnswerPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
    .replace(
      /from ['"]\.\.\/\.\.\/\.\.\/shared\/user-facing-ai-language-policy\.js['"];/,
      `from '${userFacingPolicyUrl}';`,
    )
    .replace("from './secretRedaction';", `from '${secretRedactionUrl}';`);
  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`;
  return await import(moduleUrl);
}

async function transpiledDataUrl(fileUrl) {
  const source = await readFile(fileUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

test("React matter copilot answer renders legal record language instead of packet jargon", async () => {
  const { formatMatterCopilotAnswer } = await loadMatterCopilotAnswerModule();

  const rendered = formatMatterCopilotAnswer({
    question: "how many flats?",
    answer_status: "answered",
    answer_markdown: "The packet supports that the client purchased five flats from Atlas.",
    sources: [{ source_label: "Order No. 07, 8 August 2019" }],
    warnings: [
      "Omitted 755 evidence block(s) due to maxBlocks=100",
      "The supplied packet is slightly inconsistent in places.",
      "931 evidence blocks were omitted from the current record.",
      "Several source documents are marked needs review; OCR quality appears uneven in places.",
    ],
    ai_run: { provider: "openai-direct", model: "gpt-5.4-mini" },
  });

  assert.match(rendered, /The record indicates that the client purchased five flats from Atlas\./);
  assert.match(rendered, /The current record is slightly inconsistent in places\./);
  assert.match(rendered, /OCR quality appears uneven/i);
  assert.doesNotMatch(rendered, /packet supports|supplied packet|bounded matter context|maxBlocks|evidence block/i);

  const renderedWithoutQualityWarning = formatMatterCopilotAnswer({
    question: "what happened?",
    answer_status: "answered",
    answer_markdown: "The record indicates a payment dispute.",
    sources: [{ source_label: "Agreement - 1 June 2014" }],
    warnings: ["931 evidence blocks were omitted from the current record."],
    ai_run: { provider: "openai-direct", model: "gpt-5.4" },
  });
  assert.match(renderedWithoutQualityWarning, /Only part of the matter record was included in this quick answer/);
  assert.doesNotMatch(renderedWithoutQualityWarning, /evidence block/i);
});

test("React matter copilot answer redacts secrets echoed in answer text", async () => {
  const { formatMatterCopilotAnswer } = await loadMatterCopilotAnswerModule();

  const rendered = formatMatterCopilotAnswer({
    question: "what happened?",
    answer_status: "answered",
    answer_markdown: "The record indicates a provider error with OPENAI_API_KEY=sk-answer-secret.",
    sources: [{ source_label: "Source with token=sk-source-secret" }],
    warnings: ["Operator note secret=sk-warning-secret"],
  });

  assert.match(rendered, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.match(rendered, /token=\[redacted-secret\]/);
  assert.match(rendered, /secret=\[redacted-secret\]/);
  assert.doesNotMatch(rendered, /sk-answer-secret|sk-source-secret|sk-warning-secret/);
});

test("React matter copilot answer hides unsupported citation internals from lawyers", async () => {
  const { formatMatterCopilotError } = await loadMatterCopilotAnswerModule();

  const rendered = formatMatterCopilotError("Matter copilot returned unsupported citation: FILE-0008 p1.b2");

  assert.match(rendered, /could not verify the sources/i);
  assert.match(rendered, /Run preparation again/i);
  assert.doesNotMatch(rendered, /unsupported citation|FILE-0008|p1\.b2/i);
});

test("React matter copilot terminal errors do not expose unsupported citation internals", async () => {
  const { formatMatterCopilotTerminalError } = await loadMatterCopilotAnswerModule();

  const rendered = formatMatterCopilotTerminalError("Matter copilot returned unsupported citation: FILE-0008 p1.b2");

  assert.match(rendered, /\[assistant\] failed:/);
  assert.match(rendered, /could not verify the sources/i);
  assert.doesNotMatch(rendered, /unsupported citation|FILE-0008|p1\.b2/i);
});

test("React matter copilot errors collapse provider and billing language", async () => {
  const { formatMatterCopilotError } = await loadMatterCopilotAnswerModule();

  const rendered = formatMatterCopilotError("OpenRouter quota exceeded for model openai/gpt-5.4");

  assert.equal(rendered, USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE);
  assert.equal(containsUserFacingRestrictedAiLanguage(rendered), false);
});

test("React matter copilot errors collapse provider account misses", async () => {
  const { formatMatterCopilotError, formatMatterCopilotTerminalError } = await loadMatterCopilotAnswerModule();

  const rendered = formatMatterCopilotError("User not found.");
  const terminal = formatMatterCopilotTerminalError("Matter copilot failed: User not found.");

  assert.equal(rendered, USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE);
  assert.match(terminal, /Assistant is temporarily unavailable/);
  assert.doesNotMatch(terminal, /User not found/i);
});

test("React App routes copilot failures through the terminal-safe formatter", async () => {
  const appSource = await readFile(new URL("../react-ui/src/App.tsx", import.meta.url), "utf8");

  assert.match(appSource, /formatMatterCopilotTerminalError/);
  assert.doesNotMatch(appSource, /\[copilot\] failed: \$\{message\}/);
});

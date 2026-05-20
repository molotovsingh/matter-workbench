import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const matterCopilotAnswerPath = new URL("../react-ui/src/lib/matterCopilotAnswer.ts", import.meta.url);

test("React matter copilot answer renders legal record language instead of packet jargon", async () => {
  const source = await readFile(matterCopilotAnswerPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`;
  const { formatMatterCopilotAnswer } = await import(moduleUrl);

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

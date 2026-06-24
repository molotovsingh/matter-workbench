import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCopilotInteractionReceipt,
  createCopilotInteractionReceiptService,
} from "../services/copilot-interaction-receipt-service.mjs";

test("Copilot interaction receipts normalize compact Ask and Research metadata", () => {
  const ask = buildCopilotInteractionReceipt({
    mode: "ask",
    matterName: "Sunrise vs Ansal Landmark",
    question: "What source supports that? OPENAI_API_KEY=sk-secret",
    answer: {
      answer_status: "answered",
      answer_markdown: "The record shows it.",
      sources: [{ raw_citation: "FILE-0001 p1.b2" }],
      warnings: [],
      ai_run: { provider: "openrouter", model: "openai/gpt-5.4", task: "copilot_answer" },
      context: { conversation_turns: 2, packet_schema_version: "matter-context-packet/v1" },
    },
    runtimeMode: "postgres",
    route: "/api/matter-copilot/answer",
  });

  assert.equal(ask.mode, "ask");
  assert.equal(ask.outcome, "answered");
  assert.doesNotMatch(ask.question, /sk-secret/);
  assert.deepEqual(ask.sourceSummary.matterSourceIds, ["FILE-0001 p1.b2"]);
  assert.equal(ask.context.conversationTurns, 2);

  const research = buildCopilotInteractionReceipt({
    mode: "research",
    matterName: "Sunrise vs Ansal Landmark",
    question: "NCLT options?",
    answer: {
      answer_status: "partial",
      answer_markdown: "Research answer from public sources.",
      public_sources: [{ id: "WEB-0001", url: "https://example.test" }],
      warnings: ["Verify authorities before relying or filing."],
      ai_run: { provider: "openrouter", model: "openai/gpt-5.4", task: "copilot_web_research" },
    },
    runtimeMode: "postgres",
    route: "/api/matter-copilot/research",
  });

  assert.equal(research.mode, "research");
  assert.equal(research.outcome, "partial");
  assert.deepEqual(research.sourceSummary.publicSourceIds, ["WEB-0001"]);
  assert.deepEqual(research.sourceSummary.publicUrls, ["https://example.test"]);
});

test("Copilot interaction receipt service appends and filters receipts", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-copilot-receipts-"));
  const receiptsPath = path.join(tmp, "receipts.json");
  const service = createCopilotInteractionReceiptService({
    appDir: tmp,
    receiptsPath,
    now: () => new Date("2026-06-24T05:00:00.000Z"),
    idFactory: () => "receipt_fixed",
  });

  await service.appendReceipt(buildCopilotInteractionReceipt({
    mode: "ask",
    matterName: "Matter A",
    question: "What happened?",
    answer: { answer_status: "answered", answer_markdown: "Answer", sources: [] },
  }));
  await service.appendReceipt(buildCopilotInteractionReceipt({
    mode: "research",
    matterName: "Matter A",
    question: "Which sections?",
    answer: { answer_status: "partial", answer_markdown: "Research", public_sources: [{ id: "WEB-0001" }] },
  }));

  const all = await service.listReceipts({ limit: 10 });
  assert.equal(all.schema_version, "copilot-interaction-receipts-ledger/v1");
  assert.equal(all.receipts.length, 2);

  const researchOnly = await service.listReceipts({ matterName: "Matter A", mode: "research" });
  assert.equal(researchOnly.receipts.length, 1);
  assert.equal(researchOnly.receipts[0].mode, "research");

  const store = JSON.parse(await readFile(receiptsPath, "utf8"));
  assert.equal(store.receipts.length, 2);
});

test("Copilot interaction receipts capture failures without raw stack traces", () => {
  const receipt = buildCopilotInteractionReceipt({
    mode: "research",
    matterName: "Matter A",
    question: "Research failed?",
    error: Object.assign(new Error("OPENROUTER_API_KEY=sk-failed"), { code: "copilot_research.provider_timeout" }),
    runtimeMode: "postgres",
    route: "/api/matter-copilot/research",
  });

  assert.equal(receipt.outcome, "error");
  assert.equal(receipt.errorCode, "copilot_research.provider_timeout");
  assert.equal(receipt.errorClass, "Error");
  assert.doesNotMatch(JSON.stringify(receipt), /sk-failed/);
});

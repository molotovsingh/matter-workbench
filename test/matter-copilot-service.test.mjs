import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMatterCopilotService } from "../services/matter-copilot-service.mjs";
import {
  COPILOT_ANSWER_SYSTEM_PROMPT,
  copilotUserPayload,
  createDefaultMatterCopilotProvider,
} from "../services/matter-copilot-providers.mjs";
import { toCsv } from "../shared/csv.mjs";

const HASH_ONE = "1".repeat(64);

test("matter copilot answers from bounded context and validates citations", async () => {
  const root = await makeMatterRoot();
  const service = createMatterCopilotService({
    matterStore: { getMatterRoot: () => root },
    env: { OPENAI_API_KEY: "sk-test" },
    now: () => new Date("2026-05-20T10:00:00.000Z"),
    answerProvider: async ({ question, matterContext, schema }) => {
      assert.equal(question, "which date started the lis?");
      assert.equal(matterContext.schema_version, "matter-context-packet/v1");
      assert.match(matterContext.context_priority[0], /list_of_dates_markdown and chronology_entries first/);
      assert.match(matterContext.list_of_dates_markdown.markdown, /# List of Dates/);
      assert.equal(matterContext.chronology_entries.length, 1);
      assert.equal(matterContext.chronology_entries[0].event, "Consumer complaint was filed.");
      assert.equal("evidence_blocks_omitted" in matterContext.counts, false);
      assert.equal(schema.required.includes("answer_status"), true);
      return {
        answer_status: "answered",
        answer_markdown: "The record points to 21 January 2013, when the consumer complaint was filed.",
        confidence: 0.78,
        sources: [{
          raw_citation: "FILE-0001 p1.b2",
          source_label: "Consumer complaint filing record",
          snippet: "Consumer Complaint Case No. 10 of 2013 was filed on 21 January 2013.",
        }],
        warnings: [],
      };
    },
  });

  const answer = await service.answerQuestion({ question: "which date started the lis?" });

  assert.equal(answer.schema_version, "matter-copilot-answer/v1");
  assert.equal(answer.answer_status, "answered");
  assert.equal(answer.ai_run.task, "copilot_answer");
  assert.equal(answer.ai_run.policyPromptVersion, "legal-workbench-policy/v1");
  assert.deepEqual(answer.sources.map((source) => source.raw_citation), ["FILE-0001 p1.b2"]);
});

test("matter copilot prompt keeps procedural posture chat distinct from saved native artifacts", () => {
  const payload = copilotUserPayload({
    question: "procedural posture?",
    matterContext: {},
  });

  assert.match(COPILOT_ANSWER_SYSTEM_PROMPT, /procedural posture, filing forum, current case stage/i);
  assert.match(COPILOT_ANSWER_SYSTEM_PROMPT, /Do not imply that a Filing and Procedural Posture Diagnosis artifact was saved/i);
  assert.match(COPILOT_ANSWER_SYSTEM_PROMPT, /\/procedural_posture_diagnosis creates the saved diagnosis artifact and receipt/i);
  assert.ok(payload.strict_rules.some((rule) => /run \/procedural_posture_diagnosis to save/i.test(rule)));
  assert.ok(payload.visible_answer_voice.some((rule) => /do not imply the answer was saved/i.test(rule)));
});

test("matter copilot passes bounded conversation context only as reference context", async () => {
  const root = await makeMatterRoot();
  const service = createMatterCopilotService({
    matterStore: { getMatterRoot: () => root },
    env: { OPENAI_API_KEY: "sk-test" },
    answerProvider: async ({ conversationContext }) => {
      assert.deepEqual(conversationContext, [
        { role: "user", mode: "ask", content: "What is the procedural history?" },
        { role: "assistant", mode: "ask", content: "The record indicates the complaint was filed." },
      ]);
      return {
        answer_status: "answered",
        answer_markdown: "The record indicates the consumer complaint was filed on 21 January 2013.",
        confidence: 0.8,
        sources: [{
          raw_citation: "FILE-0001 p1.b2",
          source_label: "Consumer complaint filing record",
          snippet: "Consumer Complaint Case No. 10 of 2013 was filed on 21 January 2013.",
        }],
        warnings: [],
      };
    },
  });

  const answer = await service.answerQuestion({
    question: "What happened after that?",
    conversation: [
      { role: "user", mode: "ask", content: "What is the procedural history?" },
      { role: "assistant", mode: "ask", content: "The record indicates the complaint was filed." },
    ],
  });

  assert.equal(answer.answer_status, "answered");
  assert.equal(answer.context.conversation_turns, 2);
});

test("matter copilot blocks unsupported-only citations without throwing a server error", async () => {
  const root = await makeMatterRoot();
  const service = createMatterCopilotService({
    matterStore: { getMatterRoot: () => root },
    env: { OPENAI_API_KEY: "sk-test" },
    answerProvider: async () => ({
      answer_status: "answered",
      answer_markdown: "Unsupported answer.",
      confidence: 0.2,
      sources: [{ raw_citation: "FILE-9999 p1.b1", source_label: "Unknown", snippet: "Nope" }],
      warnings: [],
    }),
  });

  const answer = await service.answerQuestion({ question: "what happened?" });

  assert.equal(answer.answer_status, "blocked");
  assert.deepEqual(answer.sources, []);
  assert.match(answer.answer_markdown, /could not verify the source references/i);
  assert.match(answer.warnings.join(" "), /source references could not be verified/i);
  assert.doesNotMatch(JSON.stringify(answer), /FILE-9999|p1\.b1|Unsupported answer|unsupported citation/i);
});

test("matter copilot blocks source-required answers with no citations instead of throwing", async () => {
  const root = await makeMatterRoot();
  const service = createMatterCopilotService({
    matterStore: { getMatterRoot: () => root },
    env: { OPENAI_API_KEY: "sk-test" },
    answerProvider: async () => ({
      answer_status: "answered",
      answer_markdown: "The record is strong on merits, but I forgot to cite it.",
      confidence: 0.7,
      sources: [],
      warnings: [],
    }),
  });

  const answer = await service.answerQuestion({ question: "is this a good case?" });

  assert.equal(answer.answer_status, "blocked");
  assert.deepEqual(answer.sources, []);
  assert.match(answer.answer_markdown, /could not verify the source references/i);
  assert.match(answer.warnings.join(" "), /source references could not be verified/i);
  assert.doesNotMatch(JSON.stringify(answer), /forgot to cite|did not include validated source citations/i);
});

test("matter copilot discards unsupported provider citations when validated sources remain", async () => {
  const root = await makeMatterRoot();
  const service = createMatterCopilotService({
    matterStore: { getMatterRoot: () => root },
    env: { OPENAI_API_KEY: "sk-test" },
    answerProvider: async () => ({
      answer_status: "answered",
      answer_markdown: "The record indicates the consumer complaint was filed on 21 January 2013.",
      confidence: 0.72,
      sources: [
        {
          raw_citation: "FILE-9999 p1.b1",
          source_label: "Unknown source",
          snippet: "Unsupported source.",
        },
        {
          raw_citation: "FILE-0001 p1.b1",
          source_label: "Consumer complaint filing record",
          snippet: "Consumer Complaint Case No. 10 of 2013 was filed on 21 January 2013.",
        },
      ],
      warnings: [],
    }),
  });

  const answer = await service.answerQuestion({ question: "when was the complaint filed?" });

  assert.equal(answer.answer_status, "partial");
  assert.deepEqual(answer.sources.map((source) => source.raw_citation), ["FILE-0001 p1.b1"]);
  assert.match(answer.warnings.join(" "), /source references could not be verified and were ignored/i);
  assert.doesNotMatch(answer.warnings.join(" "), /FILE-9999|p1\.b1|unsupported citation/i);
});

test("matter copilot blocks answers whose prose still cites unsupported references", async () => {
  const root = await makeMatterRoot();
  const service = createMatterCopilotService({
    matterStore: { getMatterRoot: () => root },
    env: { OPENAI_API_KEY: "sk-test" },
    answerProvider: async () => ({
      answer_status: "answered",
      answer_markdown: "The unsupported event is decisive (FILE-9999 p1.b1), while the complaint filing is supported.",
      confidence: 0.72,
      sources: [
        {
          raw_citation: "FILE-9999 p1.b1",
          source_label: "Unknown source",
          snippet: "Unsupported source.",
        },
        {
          raw_citation: "FILE-0001 p1.b1",
          source_label: "Consumer complaint filing record",
          snippet: "Consumer Complaint Case No. 10 of 2013 was filed on 21 January 2013.",
        },
      ],
      warnings: [],
    }),
  });

  const answer = await service.answerQuestion({ question: "what happened?" });

  assert.equal(answer.answer_status, "blocked");
  assert.deepEqual(answer.sources, []);
  assert.match(answer.answer_markdown, /could not verify the source references/i);
  assert.doesNotMatch(JSON.stringify(answer), /FILE-9999|Unsupported source|unsupported event is decisive/i);
});

test("matter copilot resolves an unambiguous source label back to a raw citation", async () => {
  const root = await makeMatterRoot();
  const service = createMatterCopilotService({
    matterStore: { getMatterRoot: () => root },
    env: { OPENAI_API_KEY: "sk-test" },
    answerProvider: async () => ({
      answer_status: "answered",
      answer_markdown: "The record indicates the consumer complaint was filed on 21 January 2013.",
      confidence: 0.8,
      sources: [{
        raw_citation: "Consumer complaint filing record",
        source_label: "Consumer complaint filing record",
        snippet: "Consumer Complaint Case No. 10 of 2013 was filed on 21 January 2013.",
      }],
      warnings: [],
    }),
  });

  const answer = await service.answerQuestion({ question: "which date started the lis?" });

  assert.deepEqual(answer.sources.map((source) => source.raw_citation), ["FILE-0001 p1.b1"]);
  assert.equal(answer.sources[0].source_label, "Consumer complaint filing record");
});

test("matter copilot validates citations from omitted List of Dates entries", async () => {
  const root = await makeMatterRoot({ extraChronologyEntries: 120 });
  const service = createMatterCopilotService({
    matterStore: { getMatterRoot: () => root },
    env: { OPENAI_API_KEY: "sk-test" },
    answerProvider: async ({ matterContext }) => {
      assert.equal(matterContext.chronology_entries.length, 120);
      return {
        answer_status: "partial",
        answer_markdown: "The later chronology entry is relevant but outside the visible JSON slice.",
        confidence: 0.66,
        sources: [{
          raw_citation: "FILE-0001 p1.b121",
          source_label: "Consumer complaint filing record",
          snippet: "Chronology entry 121 remained supported by the List of Dates artifact.",
        }],
        warnings: [],
      };
    },
  });

  const answer = await service.answerQuestion({ question: "what later event matters?" });

  assert.deepEqual(answer.sources.map((source) => source.raw_citation), ["FILE-0001 p1.b121"]);
});

test("matter copilot OpenRouter provider omits temperature for GPT-5 models", async () => {
  let requestBody = null;
  const provider = createDefaultMatterCopilotProvider({
    providerConfig: {
      provider: "openrouter",
      endpoint: "https://openrouter.example.test/chat/completions",
      model: "openai/gpt-5.4",
      maxOutputTokens: 64,
      timeoutMs: 1000,
    },
    env: { OPENROUTER_API_KEY: "sk-or-v1-test" },
    fetchImpl: async (_url, options = {}) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }),
      };
    },
  });

  const result = await provider({
    question: "what happened?",
    matterContext: { schema_version: "matter-context-packet/v1" },
    conversationContext: [{ role: "user", mode: "ask", content: "what happened before?" }],
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: { ok: { type: "boolean" } },
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(requestBody.model, "openai/gpt-5.4");
  assert.equal(Object.hasOwn(requestBody, "temperature"), false);
  assert.equal(requestBody.provider.require_parameters, true);
  const userPayload = JSON.parse(requestBody.messages[1].content);
  assert.deepEqual(userPayload.conversation_context, [{ role: "user", mode: "ask", content: "what happened before?" }]);
  assert.match(userPayload.strict_rules.join("\n"), /prior assistant answers are not evidence/i);
});

test("matter copilot emits stable validation and configuration codes", async () => {
  const missingMatterService = createMatterCopilotService({
    matterStore: { getMatterRoot: () => "" },
    answerProvider: async () => {
      throw new Error("should not call provider without a matter");
    },
  });
  await assertRejectsCode(
    () => missingMatterService.answerQuestion({ question: "what happened?" }),
    "matter_copilot.matter_required",
    409,
  );

  const root = await makeMatterRoot();
  const validationService = createMatterCopilotService({
    matterStore: { getMatterRoot: () => root },
    answerProvider: async () => {
      throw new Error("should not call provider without a question");
    },
  });
  await assertRejectsCode(
    () => validationService.answerQuestion({ question: " " }),
    "matter_copilot.question_required",
    400,
  );

  const missingKeyService = createMatterCopilotService({
    matterStore: { getMatterRoot: () => root },
    env: {},
    fetchImpl: async () => {
      throw new Error("should not call provider without an API key");
    },
  });
  await assertRejectsCode(
    () => missingKeyService.answerQuestion({ question: "what happened?" }),
    "matter_copilot.provider_api_key_required",
    409,
  );
});

async function assertRejectsCode(operation, code, statusCode) {
  let thrown;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `expected ${code} to be thrown`);
  assert.equal(thrown.code, code);
  assert.equal(thrown.statusCode, statusCode);
}

async function makeMatterRoot({ extraChronologyEntries = 0 } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-copilot-test-"));
  const root = path.join(tmp, "Mehta vs Skyline");
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), `${JSON.stringify({
    matter_name: "Mehta vs Skyline",
    client_name: "Rohan Mehta",
    opposite_party: "Skyline Developers Pvt Ltd",
    matter_type: "consumer dispute",
    jurisdiction: "India",
    intakes: [{ intake_id: "INTAKE-01", intake_dir: "00_Inbox/Intake 01 - Initial" }],
  }, null, 2)}\n`);
  await writeFile(
    path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"),
    toCsv([{
      file_id: "FILE-0001",
      intake_id: "INTAKE-01",
      source_path: "00_Inbox/Intake 01 - Initial/Source Files/complaint.pdf",
      original_path: "00_Inbox/Intake 01 - Initial/Originals/FILE-0001__complaint.pdf",
      working_copy_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__complaint.pdf",
      category: "PDFs",
      original_name: "complaint.pdf",
      sha256: HASH_ONE,
      size_bytes: "128",
      duplicate_of: "",
      status: "unique",
    }], [
      "file_id",
      "intake_id",
      "source_path",
      "original_path",
      "working_copy_path",
      "category",
      "original_name",
      "sha256",
      "size_bytes",
      "duplicate_of",
      "status",
    ]),
  );
  await writeFile(
    path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"),
    `${JSON.stringify({
      schema_version: "extraction-record/v1",
      file_id: "FILE-0001",
      sha256: HASH_ONE,
      source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__complaint.pdf",
      engine: "pdfjs-dist@4.10.38",
      page_count: 1,
      pages: [{
        page: 1,
        confidence_avg: 0.98,
        needs_review: false,
        blocks: [{
          id: "p1.b1",
          type: "paragraph",
          text: "Consumer Complaint Case No. 10 of 2013 was filed on 21 January 2013.",
        }],
      }],
      warnings: [],
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "10_Library", "Source Index.json"),
    `${JSON.stringify({
      schema_version: "source-index/v1",
      generated_at: "2026-05-20T09:00:00.000Z",
      sources: [{
        file_id: "FILE-0001",
        sha256: HASH_ONE,
        source_id: "FILE-0001",
        content_hash: HASH_ONE,
        source_path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__complaint.pdf",
        display_label: "Consumer complaint filing record",
        short_label: "Complaint filing record",
        document_type: "complaint",
        needs_review: false,
      }],
    }, null, 2)}\n`,
  );
  const chronologyEntries = [{
    date_iso: "2013-01-21",
    date_text: "21 January 2013",
    event: "Consumer complaint was filed.",
    legal_relevance: "Starts the lis before the consumer forum.",
    citation: "FILE-0001 p1.b2",
    source_label: "Consumer complaint filing record",
    source_short_label: "Complaint filing record",
    source_excerpt: "Consumer Complaint Case No. 10 of 2013 was filed on 21 January 2013.",
    needs_review: false,
  }];
  for (let i = 1; i <= extraChronologyEntries; i += 1) {
    chronologyEntries.push({
      date_iso: `2013-02-${String(Math.min(i, 28)).padStart(2, "0")}`,
      date_text: `February ${i}, 2013`,
      event: `Chronology entry ${i} remained supported by the List of Dates artifact.`,
      legal_relevance: `Later chronology relevance ${i}.`,
      citation: `FILE-0001 p1.b${i + 1}`,
      source_label: "Consumer complaint filing record",
      source_short_label: "Complaint filing record",
      source_excerpt: `Chronology entry ${i} remained supported by the List of Dates artifact.`,
      needs_review: false,
    });
  }

  await writeFile(
    path.join(root, "10_Library", "List of Dates.json"),
    `${JSON.stringify({
      schema_version: "list-of-dates/v1",
      generated_at: "2026-05-20T09:30:00.000Z",
      entries: chronologyEntries,
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "10_Library", "List of Dates.md"),
    "# List of Dates\n\n| Date | Event | Legal Relevance | Source |\n|---|---|---|---|\n| 21 January 2013 | Consumer complaint was filed. | Starts the lis before the consumer forum. | Complaint filing record |\n",
  );
  return root;
}

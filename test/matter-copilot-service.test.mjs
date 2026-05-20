import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMatterCopilotService } from "../services/matter-copilot-service.mjs";
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
      assert.equal(schema.required.includes("answer_status"), true);
      return {
        answer_status: "answered",
        answer_markdown: "The record points to 21 January 2013, when the consumer complaint was filed.",
        confidence: 0.78,
        sources: [{
          raw_citation: "FILE-0001 p1.b1",
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
  assert.deepEqual(answer.sources.map((source) => source.raw_citation), ["FILE-0001 p1.b1"]);
});

test("matter copilot fails closed when provider cites outside the packet", async () => {
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

  await assert.rejects(
    () => service.answerQuestion({ question: "what happened?" }),
    /unsupported citation/i,
  );
});

async function makeMatterRoot() {
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
  return root;
}

import assert from "node:assert/strict";
import test from "node:test";

import { CANDIDATE_SCHEMA, OUTPUT_SCHEMA } from "../listofdates/contracts.mjs";
import { CASE_TIMELINE_PERSPECTIVE } from "../listofdates/providers.mjs";
import { runCreateListOfDatesTwoPass } from "../listofdates/two-pass-runner.mjs";

const matterJson = {
  matter_name: "Mehta vs Skyline",
  client_name: "Mehta",
  opposite_party: "Skyline",
  matter_type: "Civil",
  jurisdiction: "India",
  brief_description: "Chronology test matter",
};

const chronologyBlocks = [
  {
    citation: "FILE-0001 p1.b1",
    file_id: "FILE-0001",
    source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
    original_name: "facts.txt",
    page: 1,
    block_id: "p1.b1",
    block_type: "paragraph",
    needs_review: false,
    source_label: "Agreement note",
    text: "Agreement was signed on 20 April 2026 by Mehta and Skyline.",
  },
];

test("List of Dates two-pass runner returns candidate ledger and final entries", async () => {
  const outputLines = [];
  const pass1Calls = [];
  const pass2Calls = [];

  const result = await runCreateListOfDatesTwoPass({
    options: {
      pass1Provider: async (request) => {
        pass1Calls.push(request);
        return {
          ai_run: {
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          },
          candidates: [
            {
              date_iso: "2026-04-20",
              date_text: "20 April 2026",
              event_candidate: "Agreement was signed by Mehta and Skyline.",
              legal_materiality: "Potential foundation date for the client's contract chronology.",
              citation: "FILE-0001 p1.b1",
              source_excerpt: "Agreement was signed on 20 April 2026 by Mehta and Skyline.",
              candidate_type: "agreement",
              party_posture: "helps_client",
              needs_review: false,
              confidence: 0.94,
            },
          ],
        };
      },
      pass2Provider: async (request) => {
        pass2Calls.push(request);
        return {
          ai_run: {
            returnedModel: "editor-model",
            usage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
          },
          entries: [
            {
              date_iso: "2026-04-20",
              date_text: "20 April 2026",
              event: "Agreement was signed by Mehta and Skyline.",
              event_type: "agreement",
              legal_relevance: "Supports the client's contract chronology because the cited block records the agreement date.",
              issue_tags: ["agreement"],
              perspective: CASE_TIMELINE_PERSPECTIVE,
              citation: "FILE-0001 p1.b1",
              needs_review: false,
              confidence: 0.94,
            },
          ],
        };
      },
    },
    env: {},
    matterRoot: "/tmp/example-matter",
    dryRun: true,
    matterJson,
    records: [{ file_id: "FILE-0001" }],
    sourceIndex: new Map([
      ["FILE-0001", {
        source_label: "Agreement note",
        source_short_label: "Agreement",
      }],
    ]),
    chronologyBlocks,
    chunks: [chronologyBlocks],
    filteredBlockCount: 2,
    outputLines,
  });

  assert.equal(pass1Calls.length, 1);
  assert.equal(pass1Calls[0].schema, CANDIDATE_SCHEMA);
  assert.equal(pass1Calls[0].chunk[0].citation, "FILE-0001 p1.b1");
  assert.equal(pass2Calls.length, 1);
  assert.equal(pass2Calls[0].schema, OUTPUT_SCHEMA);
  assert.deepEqual(pass2Calls[0].candidates.map((candidate) => candidate.candidate_id), ["cand_0001"]);

  assert.equal(result.generationMode, "two_pass");
  assert.equal(result.dryRun, true);
  assert.equal(result.engineVersion, "create-listofdates-v2-two-pass");
  assert.deepEqual(result.counts, {
    recordsRead: 1,
    blocksSent: 1,
    blocksFiltered: 2,
    aiRequests: 2,
    candidateEntries: 1,
    acceptedCandidates: 1,
    acceptedEntries: 1,
    clusteredEntries: 0,
    entries: 1,
    rejectedCandidates: 0,
    rejectedEntries: 0,
  });
  assert.equal(result.outputPaths.candidates, "10_Library/Case Timeline Candidates.json");
  assert.equal(result.candidateLedger.status, "succeeded");
  assert.equal(result.candidateLedger.final_entry_count, 1);
  assert.equal(result.aiRun.provider, "two-pass");
  assert.equal(result.aiRun.model, "gpt-4.1 -> gpt-5.4-mini");
  assert.equal(result.pass2AiRun.returnedModel, "editor-model");
  assert.equal(result.entries[0].source_label, "Agreement note");
  assert.match(outputLines.join("\n"), /two-pass mode enabled/);
  assert.match(outputLines.join("\n"), /dry run only/);
});

test("List of Dates two-pass runner rejects invalid editor payloads", async () => {
  await assert.rejects(
    () => runCreateListOfDatesTwoPass({
      options: {
        pass1Provider: async () => ({
          candidates: [
            {
              date_iso: "2026-04-20",
              date_text: "20 April 2026",
              event_candidate: "Agreement was signed by Mehta and Skyline.",
              legal_materiality: "Potential foundation date for the client's contract chronology.",
              citation: "FILE-0001 p1.b1",
              source_excerpt: "Agreement was signed on 20 April 2026 by Mehta and Skyline.",
              candidate_type: "agreement",
              party_posture: "helps_client",
              needs_review: false,
              confidence: 0.94,
            },
          ],
        }),
        pass2Provider: async () => ({ entries: null }),
      },
      env: {},
      matterRoot: "/tmp/example-matter",
      dryRun: true,
      matterJson,
      records: [{ file_id: "FILE-0001" }],
      sourceIndex: new Map(),
      chronologyBlocks,
      chunks: [chronologyBlocks],
      filteredBlockCount: 0,
      outputLines: [],
    }),
    /invalid two-pass list-of-dates editor payload/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  TWO_PASS_ENGINE_VERSION,
  createCandidateLedger,
  mergeAiRunMetadata,
  twoPassAiRunMetadata,
} from "../listofdates/run-metadata.mjs";

test("List of Dates run metadata merges provider response usage without mutating base metadata", () => {
  const baseAiRun = {
    provider: "openai-direct",
    model: "gpt-4.1",
    task: "create_case_timeline",
  };

  const merged = mergeAiRunMetadata(baseAiRun, [
    {
      returnedModel: "gpt-4.1-2026",
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        cost: 0.01,
      },
    },
    {
      returnedProvider: "openai",
      usage: {
        promptTokens: 5,
        totalTokens: 9,
        cost: 0.02,
      },
    },
    null,
    "ignored",
  ]);

  assert.deepEqual(baseAiRun, {
    provider: "openai-direct",
    model: "gpt-4.1",
    task: "create_case_timeline",
  });
  assert.deepEqual(merged, {
    provider: "openai-direct",
    model: "gpt-4.1",
    task: "create_case_timeline",
    returnedModel: "gpt-4.1-2026",
    returnedProvider: "openai",
    usage: {
      promptTokens: 15,
      completionTokens: 20,
      totalTokens: 39,
      cost: 0.03,
    },
  });
});

test("List of Dates two-pass metadata composes pass metadata fail-closed", () => {
  const pass1 = {
    policyVersion: "policy/v1",
    policyPromptVersion: "legal-workbench-policy/v1",
    model: "gpt-4.1",
  };
  const pass2 = {
    policyVersion: "policy/v2",
    model: "gpt-5.4",
  };

  assert.deepEqual(twoPassAiRunMetadata(pass1, pass2), {
    policyVersion: "policy/v2",
    policyPromptVersion: "legal-workbench-policy/v1",
    task: "create_case_timeline_two_pass",
    tier: "source_backed_analysis",
    provider: "two-pass",
    model: "gpt-4.1 -> gpt-5.4",
    fallback: "fail_closed",
    pass1,
    pass2,
  });
});

test("List of Dates candidate ledger records source counts, matter summary, and status", () => {
  const ledger = createCandidateLedger({
    matterJson: {
      matter_name: "Example Matter",
      client_name: "Client",
      opposite_party: "Builder",
      ignored: "field",
    },
    candidates: [{ candidate_id: "cand_0001" }],
    records: [{ file_id: "FILE-0001" }, { file_id: "FILE-0002" }],
    chronologyBlocks: [{ citation: "FILE-0001 p1.b1" }],
    filteredBlockCount: 3,
    pass1AiRun: { provider: "openai-direct", model: "gpt-4.1" },
    status: "pending_editor",
  });

  assert.equal(ledger.schema_version, "list-of-dates-candidates/v1");
  assert.equal(ledger.engine_version, TWO_PASS_ENGINE_VERSION);
  assert.equal(ledger.status, "pending_editor");
  assert.match(ledger.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(ledger.matter, {
    matter_name: "Example Matter",
    client_name: "Client",
    opposite_party: "Builder",
    matter_type: "",
    jurisdiction: "",
    brief_description: "",
  });
  assert.equal(ledger.source_record_count, 2);
  assert.equal(ledger.source_block_count, 1);
  assert.equal(ledger.filtered_block_count, 3);
  assert.deepEqual(ledger.ai_run, { provider: "openai-direct", model: "gpt-4.1" });
  assert.deepEqual(ledger.candidates, [{ candidate_id: "cand_0001" }]);
});

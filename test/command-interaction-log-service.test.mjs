import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  COMMAND_INTERACTION_LOG_SCHEMA_VERSION,
  createCommandInteractionLogService,
  normalizeInteraction,
} from "../services/command-interaction-log-service.mjs";

test("command interaction log appends whitelisted JSONL records", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "command-log-service-"));
  const logPath = path.join(appDir, ".local", "command-interactions.jsonl");
  const service = createCommandInteractionLogService({
    appDir,
    logPath,
    now: () => new Date("2026-05-12T10:00:00.000Z"),
  });

  const result = await service.appendInteraction({
    typed_input: "create a skill to summarize pleadings",
    matched_command: "skill_idea/interview",
    rendered_state: "skill_idea/interview",
    status: "opened_interview",
    skill_idea_id: "idea_123",
    provider_run_invoked: false,
    planner_source: "model",
    planner_model: "openrouter / openai/gpt-4.1",
    planner_fallback_reason: "",
    matter: {
      matterName: "Demo Matter",
      folderName: "Dummy 01",
    },
    router_decision: {
      decision: "new_skill_candidate",
      matched_skill: "",
      confidence: 0.42,
      recommended_action: "save idea",
      reason: "Explicit skill idea.",
    },
    terminal_lines: ["[skill-ideas] interview opened"],
    apiKey: "sk-should-not-be-logged",
    copiedReviewPacket: "# Skill Idea Review Packet\nsecret packet text",
    rawSourceText: "full source document text",
  });

  assert.equal(result.logged, true);
  assert.equal(result.path, ".local/command-interactions.jsonl");

  const contents = await readFile(logPath, "utf8");
  const lines = contents.trim().split("\n");
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.schema_version, COMMAND_INTERACTION_LOG_SCHEMA_VERSION);
  assert.equal(record.timestamp, "2026-05-12T10:00:00.000Z");
  assert.equal(record.matter.matter_name, "Demo Matter");
  assert.equal(record.matter.folder_name, "Dummy 01");
  assert.equal(record.typed_input, "create a skill to summarize pleadings");
  assert.equal(record.matched_command, "skill_idea/interview");
  assert.equal(record.rendered_state, "skill_idea/interview");
  assert.equal(record.status, "opened_interview");
  assert.equal(record.skill_idea_id, "idea_123");
  assert.equal(record.provider_run_invoked, false);
  assert.equal(record.planner_source, "model");
  assert.equal(record.planner_model, "openrouter / openai/gpt-4.1");
  assert.equal(record.planner_fallback_reason, "");
  assert.equal(record.router_decision.decision, "new_skill_candidate");
  assert.deepEqual(record.terminal_lines, ["[skill-ideas] interview opened"]);
  assert.doesNotMatch(contents, /sk-should-not-be-logged|secret packet text|full source document text/);
});

test("command interaction normalization bounds large fields", () => {
  const record = normalizeInteraction({
    typed_input: "x".repeat(2000),
    terminal_lines: Array.from({ length: 12 }, (_, index) => `line ${index + 1}`),
    error: "boom",
  }, {
    now: () => new Date("2026-05-12T10:00:00.000Z"),
  });

  assert.equal(record.timestamp, "2026-05-12T10:00:00.000Z");
  assert.equal(record.typed_input.length, 1200);
  assert.equal(record.typed_input.endsWith("…"), true);
  assert.deepEqual(record.terminal_lines, ["line 5", "line 6", "line 7", "line 8", "line 9", "line 10", "line 11", "line 12"]);
  assert.deepEqual(record.errors, ["boom"]);
});

test("command interaction log serializes concurrent appends", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "command-log-service-concurrent-"));
  const logPath = path.join(appDir, ".local", "command-interactions.jsonl");
  const service = createCommandInteractionLogService({
    appDir,
    logPath,
    now: () => new Date("2026-05-12T10:00:00.000Z"),
  });

  await Promise.all(Array.from({ length: 20 }, (_, index) => service.appendInteraction({
    typed_input: `command ${index}`,
    status: "ran",
  })));

  const lines = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 20);
  const records = lines.map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map((record) => record.typed_input),
    Array.from({ length: 20 }, (_, index) => `command ${index}`),
  );
});

test("command interaction normalization redacts secrets inside retained fields", () => {
  const record = normalizeInteraction({
    typed_input: "set OPENAI_API_KEY=sk-typed-secret",
    terminal_lines: [
      "curl authorization: Bearer sk-terminal-secret",
      "OPENROUTER_API_KEY='sk-openrouter-secret'",
    ],
    error: "provider rejected sk-error-secret",
    router_decision: {
      decision: "new_skill_candidate",
      reason: "MISTRAL_API_KEY=sk-mistral-secret was present in copied text",
    },
  }, {
    now: () => new Date("2026-05-12T10:00:00.000Z"),
  });
  const serialized = JSON.stringify(record);

  assert.doesNotMatch(serialized, /sk-typed-secret|sk-terminal-secret|sk-openrouter-secret|sk-error-secret|sk-mistral-secret/);
  assert.match(record.typed_input, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.deepEqual(record.terminal_lines, [
    "curl authorization: Bearer [redacted-secret]",
    "OPENROUTER_API_KEY=[redacted-secret]",
  ]);
  assert.deepEqual(record.errors, ["provider rejected [redacted-secret]"]);
  assert.match(record.router_decision.reason, /MISTRAL_API_KEY=\[redacted-secret\]/);
});

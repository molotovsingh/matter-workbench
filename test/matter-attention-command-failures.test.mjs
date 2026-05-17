import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildCommandFailureAttentionItems } from "../services/matter-attention-command-failures.mjs";

test("matter attention command failures filter to the selected matter and dedupe repeated failures", async () => {
  const seenLimits = [];
  const items = await buildCommandFailureAttentionItems({
    commandInteractionLogService: {
      logPath: path.join("/tmp", "matter-workbench-test", ".local", "command-interactions.jsonl"),
      readRecentInteractions: async ({ limit }) => {
        seenLimits.push(limit);
        return [
          {
            timestamp: "2026-05-16T10:00:00.000Z",
            matter: { folder_name: "Other Matter" },
            typed_input: "/describe_sources",
            matched_command: "/describe_sources",
            status: "failed",
            errors: ["provider unavailable"],
          },
          {
            timestamp: "2026-05-16T10:01:00.000Z",
            matter: { folder_name: "Attention Matter" },
            typed_input: "/describe_sources",
            matched_command: "/describe_sources",
            status: "ran",
            status_bar: "Source labels complete",
          },
          {
            timestamp: "2026-05-16T10:02:00.000Z",
            matter: { folder_name: "Attention Matter" },
            typed_input: "/create_listofdates",
            matched_command: "/create_listofdates",
            status: "failed",
            errors: ["provider returned invalid chronology"],
          },
          {
            timestamp: "2026-05-16T10:03:00.000Z",
            matter: { folder_name: "Attention Matter" },
            typed_input: "/create_listofdates",
            matched_command: "/create_listofdates",
            status: "failed",
            errors: ["provider returned invalid chronology"],
          },
          {
            timestamp: "2026-05-16T10:04:00.000Z",
            matter: { folder_name: "Attention Matter" },
            typed_input: "/context_search",
            matched_command: "/context_search",
            status: "unknown",
            terminal_lines: ["[context] provider unavailable"],
          },
        ];
      },
    },
    matterName: "Attention Matter",
  });

  assert.deepEqual(seenLimits, [200]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.title), [
    "Command failed: /context_search",
    "Command failed: /create_listofdates",
  ]);
  assert.equal(items[0].detail, "[context] provider unavailable");
  assert.equal(items[1].detail, "provider returned invalid chronology");
  assert.deepEqual(items[0].evidence, [{ path: ".local/command-interactions.jsonl" }]);
});

test("matter attention command failures treat explicit error statuses as failures", async () => {
  const items = await buildCommandFailureAttentionItems({
    commandInteractionLogService: {
      readRecentInteractions: async () => [
        {
          timestamp: "2026-05-16T10:00:00.000Z",
          matter: { folder_name: "Attention Matter" },
          typed_input: "/describe_sources",
          matched_command: "/describe_sources",
          status: "provider unavailable",
        },
      ],
    },
    matterName: "Attention Matter",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].detail, "Command log indicates a failure.");
});

test("matter attention command failures return empty items without a reader boundary", async () => {
  const items = await buildCommandFailureAttentionItems({
    commandInteractionLogService: { logPath: "/tmp/command-interactions.jsonl" },
    matterName: "Attention Matter",
  });

  assert.deepEqual(items, []);
});

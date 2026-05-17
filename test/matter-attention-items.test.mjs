import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAttentionItem,
  sortAttentionItems,
  summarizeAttentionItems,
} from "../services/matter-attention-items.mjs";

test("matter attention items normalize stable ids and default fields", () => {
  assert.deepEqual(normalizeAttentionItem({
    category: "source_labels",
    code: "source_index_missing",
    title: "Source Index is missing",
  }), {
    id: "source-labels-source-index-missing-source-index-is-missing",
    severity: "warning",
    category: "source_labels",
    code: "source_index_missing",
    title: "Source Index is missing",
    detail: "",
    action: "",
    evidence: [],
    occurredAt: "",
  });
});

test("matter attention items sort severity first and newest events within severity", () => {
  const sorted = sortAttentionItems([
    normalizeAttentionItem({
      severity: "warning",
      category: "command",
      code: "older_warning",
      title: "Older warning",
      occurredAt: "2026-05-16T09:00:00.000Z",
    }),
    normalizeAttentionItem({
      severity: "blocker",
      category: "custom_skill",
      code: "failed",
      title: "Failed skill",
      occurredAt: "2026-05-16T08:00:00.000Z",
    }),
    normalizeAttentionItem({
      severity: "warning",
      category: "command",
      code: "newer_warning",
      title: "Newer warning",
      occurredAt: "2026-05-16T10:00:00.000Z",
    }),
  ]);

  assert.deepEqual(sorted.map((item) => item.code), ["failed", "newer_warning", "older_warning"]);
});

test("matter attention item summaries derive lifecycle state from counts", () => {
  assert.deepEqual(summarizeAttentionItems([]), {
    total: 0,
    blocker: 0,
    warning: 0,
    info: 0,
    state: "clear",
  });
  assert.equal(summarizeAttentionItems([
    normalizeAttentionItem({ severity: "warning" }),
  ]).state, "attention_needed");
  assert.equal(summarizeAttentionItems([
    normalizeAttentionItem({ severity: "blocker" }),
    normalizeAttentionItem({ severity: "warning" }),
  ]).state, "blocked");
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSourceLabelAttentionItems } from "../services/matter-attention-source-labels.mjs";
import { SOURCE_INDEX_RELATIVE } from "../shared/matter-artifacts.mjs";

test("matter attention source labels reports missing Source Index after extraction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-source-missing-"));
  const items = await buildSourceLabelAttentionItems({
    root,
    status: {
      stages: [
        { slash: "/extract", state: "present" },
        { slash: "/describe_sources", state: "not_run" },
      ],
    },
  });

  assert.deepEqual(items.map((item) => item.code), ["source_index_missing"]);
  assert.equal(items[0].severity, "warning");
});

test("matter attention source labels reports review, leaky labels, count mismatch, and stale advice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-source-labels-"));
  await mkdir(path.join(root, path.dirname(SOURCE_INDEX_RELATIVE)), { recursive: true });
  await writeFile(path.join(root, SOURCE_INDEX_RELATIVE), `${JSON.stringify({
    source_record_count: 3,
    sources: [
      {
        source_id: "source-1",
        label_status: "needs_review",
        display_label: "Email from Consulate",
      },
      {
        source_id: "source-2",
        label_status: "confirmed",
        display_label: "FILE-0002 internal label",
      },
    ],
  })}\n`);

  const items = await buildSourceLabelAttentionItems({
    root,
    status: {
      stages: [{
        slash: "/describe_sources",
        state: "present",
        rerunAdvice: {
          state: "stale",
          reason: "Newer extraction records exist",
          dependencyState: "chronology_review_needed",
          artifactPath: SOURCE_INDEX_RELATIVE,
          newestInputPath: "00_Inbox/Intake 01 - Initial/Extraction Records/FILE-0004.json",
          newestInputAt: "2026-05-17T10:00:00.000Z",
        },
      }],
    },
  });

  assert.deepEqual(items.map((item) => item.code), [
    "source_labels_need_review",
    "source_label_developer_name",
    "source_index_count_mismatch",
    "source_labels_stale",
  ]);
  assert.equal(items.find((item) => item.code === "source_labels_stale").occurredAt, "2026-05-17T10:00:00.000Z");
});

test("matter attention source labels reports invalid Source Index schema", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-source-schema-"));
  await mkdir(path.join(root, path.dirname(SOURCE_INDEX_RELATIVE)), { recursive: true });
  await writeFile(path.join(root, SOURCE_INDEX_RELATIVE), "{\"not_sources\":[]}\n");

  const items = await buildSourceLabelAttentionItems({ root, status: { stages: [] } });

  assert.equal(items[0].code, "source_index_schema_invalid");
  assert.equal(items[0].severity, "blocker");
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildChronologyAttentionItems } from "../services/matter-attention-chronology.mjs";
import {
  LIST_OF_DATES_JSON_RELATIVE,
  LIST_OF_DATES_MARKDOWN_RELATIVE,
} from "../shared/matter-artifacts.mjs";

test("matter attention chronology reports missing List of Dates after source labels exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-chronology-missing-"));
  const items = await buildChronologyAttentionItems({
    root,
    status: {
      stages: [{ slash: "/describe_sources", state: "present" }],
    },
  });

  assert.deepEqual(items.map((item) => item.code), ["listofdates_missing"]);
  assert.equal(items[0].severity, "warning");
});

test("matter attention chronology reports markdown missing and dependency advice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-chronology-json-"));
  await mkdir(path.join(root, path.dirname(LIST_OF_DATES_JSON_RELATIVE)), { recursive: true });
  await writeFile(path.join(root, LIST_OF_DATES_JSON_RELATIVE), "{\"entries\":[]}\n");

  const items = await buildChronologyAttentionItems({
    root,
    status: {
      stages: [{
        slash: "/create_listofdates",
        state: "present",
        rerunAdvice: {
          state: "stale",
          reason: "Source labels changed",
          dependencyState: "label_refresh_needed",
          artifactPath: LIST_OF_DATES_JSON_RELATIVE,
          newestInputPath: "10_Library/Source Index.json",
          newestInputAt: "2026-05-17T11:00:00.000Z",
        },
      }],
    },
  });

  assert.deepEqual(items.map((item) => item.code), [
    "listofdates_markdown_missing",
    "chronology_stale",
  ]);
  assert.match(items[1].detail, /label_refresh_needed/);
});

test("matter attention chronology reports markdown without JSON metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-attention-chronology-md-"));
  await mkdir(path.join(root, path.dirname(LIST_OF_DATES_MARKDOWN_RELATIVE)), { recursive: true });
  await writeFile(path.join(root, LIST_OF_DATES_MARKDOWN_RELATIVE), "# List of Dates\n");

  const items = await buildChronologyAttentionItems({ root, status: { stages: [] } });

  assert.equal(items[0].code, "listofdates_json_missing");
  assert.equal(items[0].severity, "warning");
});

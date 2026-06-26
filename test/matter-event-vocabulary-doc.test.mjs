import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const vocabularyPath = new URL("../docs/future-design-decisions/matter-event-vocabulary-spike.md", import.meta.url);
const futureReadmePath = new URL("../docs/future-design-decisions/README.md", import.meta.url);


test("matter event vocabulary spike is explicitly non-binding and does not unlock file removal", async () => {
  const doc = await readFile(vocabularyPath, "utf8");

  assert.match(doc, /Review draft — vocabulary plus first implemented event; not a frozen schema/);
  assert.match(doc, /not:\n\n- an accepted database schema/);
  assert.match(doc, /a permission to add file removal/);
  assert.match(doc, /Kafka\/broker design/);
  assert.match(doc, /removed_from_active_record/);
  assert.doesNotMatch(doc, /source_file\.deleted/);
  assert.match(doc, /Not ordinary delete/);
});

test("matter event vocabulary records the low-risk first canonical event and blocks source removal", async () => {
  const doc = await readFile(vocabularyPath, "utf8");

  assert.match(doc, /First implemented mutation: `custom_skill\.created`/);
  assert.match(doc, /does not alter source evidence/);
  assert.match(doc, /Do not include sample markdown, evidence blocks, or matter source text/);
  assert.match(doc, /source_file\.removed_from_active_record/);
  assert.match(doc, /active source set projection/);
  assert.match(doc, /local tombstone\/suppression behavior/);
  assert.match(doc, /artifact currentness\/staleness projection/);
  assert.match(doc, /restore\/quarantine rules/);
});

test("future decision ledger indexes the event vocabulary spike as review draft", async () => {
  const readme = await readFile(futureReadmePath, "utf8");

  assert.match(readme, /Matter Event Vocabulary Spike/);
  assert.match(readme, /`custom_skill\.created` is the first implemented canonical event/);
  assert.match(readme, /keep the rest of the vocabulary non-binding/i);
});

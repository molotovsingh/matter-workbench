import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contractPath = new URL("../docs/contracts/active-source-set-and-suppression.md", import.meta.url);
const docsReadmePath = new URL("../docs/README.md", import.meta.url);

test("active source set contract documents read-side suppression without unlocking file removal", async () => {
  const contract = await readFile(contractPath, "utf8");

  assert.match(contract, /Current read-side contract/);
  assert.match(contract, /not a file-removal UI/i);
  assert.match(contract, /\.matter-workbench\/source-tombstones\.json/);
  assert.match(contract, /matter-source-tombstones\/v1/);
  assert.match(contract, /removed_from_active_record/);
  assert.match(contract, /quarantined/);
  assert.match(contract, /must not store\nsource text, extracted evidence blocks, or legal work product/);
  assert.match(contract, /Matter Context packets/);
  assert.match(contract, /generated Library artifact summaries/);
  assert.match(contract, /stale generated artifacts to reintroduce suppressed/);
  assert.match(contract, /Case Timeline generation/);
  assert.match(contract, /rerun\/currentness advice/);
  assert.match(contract, /chronology_regeneration_needed/);
  assert.match(contract, /canonical `source_file\.removed_from_active_record` event append/);
  assert.match(contract, /never\s+ordinary `Delete file`/);
});

test("docs map links the active source set suppression contract", async () => {
  const readme = await readFile(docsReadmePath, "utf8");

  assert.match(readme, /Active Source Set And Suppression/);
  assert.match(readme, /before any source-removal UI/);
});

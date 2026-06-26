import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contractPath = new URL("../docs/future-design-decisions/source-custody-removal-write-contract.md", import.meta.url);
const ledgerPath = new URL("../docs/future-design-decisions/README.md", import.meta.url);

test("source custody removal write contract stays narrow, idempotent, and non-deleting", async () => {
  const contract = await readFile(contractPath, "utf8");

  assert.match(contract, /Draft implementation contract/);
  assert.match(contract, /not permission to add a user-facing removal/);
  assert.match(contract, /Remove from active record/);
  assert.match(contract, /Do not call it `Delete file`/);
  assert.match(contract, /uploaded source\/original file represented by a stable `FILE-NNNN` id/);
  assert.match(contract, /`reason` entered by the operator\/lawyer/);
  assert.match(contract, /`idempotency_key` supplied by the caller/);
  assert.match(contract, /source_file\.removed_from_active_record/);
  assert.match(contract, /source_file\.deleted/);
  assert.match(contract, /source_document\.deleted/);
  assert.match(contract, /source text/);
  assert.match(contract, /extracted evidence blocks/);
  assert.match(contract, /generated legal work product/);
  assert.match(contract, /inside one transaction/);
  assert.match(contract, /status\+tombstone\+event|status.*event/s);
  assert.match(contract, /Do not silently regenerate paid\/model artifacts/);
  assert.match(contract, /pure read-only source-removal impact preview helper and endpoint with no UI/);
  assert.match(contract, /Still missing before any UI/);
  assert.doesNotMatch(contract, /DELETE FROM/i);
  assert.doesNotMatch(contract, /rm -rf/i);
});

test("future decisions ledger links the source custody removal write contract", async () => {
  const ledger = await readFile(ledgerPath, "utf8");

  assert.match(ledger, /Source Custody Removal Write Contract/);
  assert.match(ledger, /source-custody-removal-write-contract\.md/);
  assert.match(ledger, /source_file\.removed_from_active_record/);
  assert.match(ledger, /no physical purge/);
});

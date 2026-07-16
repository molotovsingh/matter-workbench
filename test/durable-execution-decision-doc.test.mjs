import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const notePath = new URL("../docs/future-design-decisions/durable-execution-pg-durable-fit.md", import.meta.url);
const ledgerPath = new URL("../docs/future-design-decisions/README.md", import.meta.url);

test("durable execution note keeps the pattern but rejects current pg_durable adoption", async () => {
  const note = await readFile(notePath, "utf8");

  assert.match(note, /durable-execution pattern survives review/i);
  assert.match(note, /Adopting \*\*`pg_durable` now does not survive review\*\*/i);
  assert.match(note, /not implementation permission/i);
  assert.match(note, /non-idempotent external effects are \*\*not\*\* made safe automatically/i);
  assert.match(note, /Runtime-DB mode already has a substantial durable substrate/i);
  assert.match(note, /Failure of any acceptance item rejects adoption/i);
  assert.doesNotMatch(note, /external effects are gated.*only fire once/is);
});

test("future decision ledger parks pg_durable behind an isolated spike", async () => {
  const ledger = await readFile(ledgerPath, "utf8");

  assert.match(ledger, /Durable Execution And `pg_durable` Fit/);
  assert.match(ledger, /tool adoption rejected for current implementation/);
  assert.match(ledger, /disposable-Postgres spike must prove crash recovery/i);
});

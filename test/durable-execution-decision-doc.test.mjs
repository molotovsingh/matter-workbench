import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const notePath = new URL("../docs/future-design-decisions/durable-execution-pg-durable-fit.md", import.meta.url);
const ledgerPath = new URL("../docs/future-design-decisions/README.md", import.meta.url);

test("durable execution note rejects Workbench runtime adoption but permits a Mothership triage spike", async () => {
  const note = await readFile(notePath, "utf8");

  assert.match(note, /^Status: Parked evaluation; Mothership telemetry-triage spike is credible; Matter Workbench runtime adoption rejected$/m);
  assert.match(note, /^### Strongest candidate: Mothership telemetry triage$/m);
  assert.match(note, /^## Required Mothership Triage Spike Before Any Adoption$/m);
  assert.match(note, /triage after ingestion/i);
  assert.match(note, /non-idempotent external effects are \*\*not\*\* made safe automatically/i);
  assert.doesNotMatch(note, /external effects are gated.*only fire once/is);
});

test("future decision ledger parks pg_durable behind a Mothership-only triage spike", async () => {
  const ledger = await readFile(ledgerPath, "utf8");

  assert.match(ledger, /Durable Execution And `pg_durable` Fit/);
  assert.match(ledger, /Mothership telemetry-triage spike is credible/i);
  assert.match(ledger, /Keep Workbench telemetry transport local-first/i);
  assert.match(ledger, /disposable Mothership-Postgres spike may test post-ingestion triage only/i);
});

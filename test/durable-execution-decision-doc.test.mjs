import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const notePath = new URL("../docs/future-design-decisions/durable-execution-pg-durable-fit.md", import.meta.url);
const ledgerPath = new URL("../docs/future-design-decisions/README.md", import.meta.url);

test("durable execution note rejects Workbench runtime adoption but permits a Mothership triage spike", async () => {
  const note = await readFile(notePath, "utf8");

  assert.match(note, /durable-execution pattern survives review/i);
  assert.match(note, /Adopting \*\*`pg_durable` now as Matter Workbench's runtime orchestrator does\s+not\s+survive review\*\*/i);
  assert.match(note, /telemetry delivery and telemetry triage are distinct/i);
  assert.match(note, /possible\s+`pg_durable` boundary starts only after Mothership has safely accepted the row/i);
  assert.match(note, /Strongest candidate: Mothership telemetry triage/i);
  assert.match(note, /Failure of any acceptance item rejects adoption for telemetry triage/i);
  assert.match(note, /non-idempotent external effects are \*\*not\*\* made safe automatically/i);
  assert.match(note, /Runtime-DB mode already has a substantial durable substrate/i);
  assert.doesNotMatch(note, /external effects are gated.*only fire once/is);
});

test("future decision ledger parks pg_durable behind a Mothership-only triage spike", async () => {
  const ledger = await readFile(ledgerPath, "utf8");

  assert.match(ledger, /Durable Execution And `pg_durable` Fit/);
  assert.match(ledger, /Mothership telemetry-triage spike is credible/i);
  assert.match(ledger, /Keep Workbench telemetry transport local-first/i);
  assert.match(ledger, /disposable Mothership-Postgres spike may test post-ingestion triage only/i);
});

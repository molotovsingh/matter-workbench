import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const handoffDocPath = new URL("../docs/database-transition-handoff.md", import.meta.url);
const docsReadmePath = new URL("../docs/README.md", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);
const localVmPasswordPattern = ["aks", "ingh11"].join("");
const passwordPlaceholderPattern = ["choose", "a", "password", "here"].join("-");

test("database transition handoff doc records the shadow-only path without secrets", async () => {
  const doc = await readFile(handoffDocPath, "utf8");

  assert.match(doc, /# Database Transition Handoff/);
  assert.match(doc, /shadow-only/i);
  assert.match(doc, /npm run db:migrate/);
  assert.match(doc, /npm run db:shadow:hydrate/);
  assert.match(doc, /npm run db:shadow:hydrate:verify/);
  assert.match(doc, /npm run db:shadow:snapshot/);
  assert.match(doc, /repo branch, short commit, and whether\s+the worktree was clean/i);
  assert.match(doc, /db:doctor[\s\S]*preflight/i);
  assert.match(doc, /db:shadow:snapshot[\s\S]*ready_to_hydrate:\s*yes/i);
  assert.match(doc, /db:shadow:snapshot[\s\S]*refuses to write/i);
  assert.match(doc, /MWB_PSQL_BIN/);
  assert.match(doc, /Homebrew[\s\S]*libpq/i);
  assert.match(doc, /docs\/shadow-db-snapshots\/shadow-db-snapshot-2026-06-04T00-00-00-000Z\.md/);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*one[- ]run evidence/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*not live truth/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*repo changes/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*local matter/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*source repo state/i);
  assert.match(doc, /Current Snapshot Evidence[\s\S]*do not keep refreshing/i);
  assert.match(doc, /Do not cut over runtime reads or writes/i);
  assert.doesNotMatch(
    doc,
    new RegExp(`${localVmPasswordPattern}|${passwordPlaceholderPattern}|192\\.168\\.210\\.\\d+|postgres:\\/\\/[^"\\s]+`),
  );
});

test("documentation map links the database transition handoff", async () => {
  const docsReadme = await readFile(docsReadmePath, "utf8");
  const dbReadme = await readFile(dbReadmePath, "utf8");

  assert.match(docsReadme, /\[Database Transition Handoff\]\(database-transition-handoff\.md\)/);
  assert.match(dbReadme, /\[Database Transition Handoff\]\(\.\.\/docs\/database-transition-handoff\.md\)/);
});

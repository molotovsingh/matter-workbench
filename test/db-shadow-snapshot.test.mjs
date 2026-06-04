import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const snapshotPath = new URL("../scripts/db-shadow-snapshot.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("shadow DB snapshot writes redacted markdown and JSON handoff files", async () => {
  const {
    createShadowDbSnapshot,
  } = await import(snapshotPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-shadow-snapshot-"));
  const calls = [];

  const snapshot = await createShadowDbSnapshot({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    outDir,
    timestamp: "2026-06-04T00:00:00.000Z",
    buildReport: async ({ databaseUrl, matterQuery, slashQuery }) => {
      calls.push({ databaseUrl, matterQuery, slashQuery });
      return {
        matched: true,
        filters: { matter: matterQuery || "", slash: slashQuery || "" },
        matter: { verification: { matched: true } },
      };
    },
    renderReport: () => [
      "Matter Workbench shadow DB report",
      "matched: yes",
      "matter_counts: matched",
    ],
  });

  assert.equal(snapshot.matched, true);
  assert.equal(snapshot.generatedAt, "2026-06-04T00:00:00.000Z");
  assert.match(snapshot.files.markdown, /shadow-db-snapshot-2026-06-04T00-00-00-000Z\.md$/);
  assert.match(snapshot.files.json, /shadow-db-snapshot-2026-06-04T00-00-00-000Z\.json$/);
  assert.equal(calls[0].databaseUrl, "postgres://mwb_user:secret@db.example/matter_workbench_shadow");

  const markdown = await readFile(snapshot.files.markdown, "utf8");
  const json = JSON.parse(await readFile(snapshot.files.json, "utf8"));

  assert.match(markdown, /# Matter Workbench Shadow DB Snapshot/);
  assert.match(markdown, /Matched: yes/);
  assert.match(markdown, /matter_counts: matched/);
  assert.equal(json.schemaVersion, "shadow-db-snapshot/v1");
  assert.equal(json.matched, true);
  assert.equal(json.files.markdown, "shadow-db-snapshot-2026-06-04T00-00-00-000Z.md");
  assert.equal(json.files.json, "shadow-db-snapshot-2026-06-04T00-00-00-000Z.json");
  assert.deepEqual(json.reportLines, [
    "Matter Workbench shadow DB report",
    "matched: yes",
    "matter_counts: matched",
  ]);
  assert.doesNotMatch(markdown, /secret|db\.example|matter_workbench_shadow/);
  assert.doesNotMatch(JSON.stringify(json), /secret|db\.example|matter_workbench_shadow/);
  assert.doesNotMatch(JSON.stringify(json), new RegExp(escapeRegExp(outDir)));
});

test("shadow DB snapshot refuses to run without a database URL", async () => {
  const {
    createShadowDbSnapshot,
  } = await import(snapshotPath.href);

  await assert.rejects(
    () => createShadowDbSnapshot({
      databaseUrl: "",
      outDir: os.tmpdir(),
      buildReport: async () => ({}),
      renderReport: () => [],
    }),
    /Set MWB_DATABASE_URL or DATABASE_URL/,
  );
});

test("package and database docs expose the shadow DB snapshot command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:shadow:snapshot"], "node scripts/db-shadow-snapshot.mjs");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:shadow:snapshot/);
  assert.match(readme, /docs\/shadow-db-snapshots/);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

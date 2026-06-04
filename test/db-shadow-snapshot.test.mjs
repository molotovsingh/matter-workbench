import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const snapshotPath = new URL("../scripts/db-shadow-snapshot.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);
const snapshotsReadmePath = new URL("../docs/shadow-db-snapshots/README.md", import.meta.url);

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
    repoMetadata: {
      branch: "codex/test-branch",
      commit: "abc1234",
      clean: true,
    },
    preflightDoctor: async () => [
      "Matter Workbench database doctor",
      "ready_to_apply: no",
      "ready_to_hydrate: yes",
    ],
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
  assert.match(markdown, /Branch: codex\/test-branch/);
  assert.match(markdown, /Commit: abc1234/);
  assert.match(markdown, /Worktree clean: yes/);
  assert.match(markdown, /matter_counts: matched/);
  assert.equal(json.schemaVersion, "shadow-db-snapshot/v1");
  assert.equal(json.matched, true);
  assert.deepEqual(json.repo, {
    branch: "codex/test-branch",
    commit: "abc1234",
    clean: true,
  });
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

test("shadow DB snapshot stops before writing files when doctor says schema is not ready", async () => {
  const {
    createShadowDbSnapshot,
  } = await import(snapshotPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-shadow-snapshot-blocked-"));
  let buildReportCalled = false;

  await assert.rejects(
    () => createShadowDbSnapshot({
      databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
      outDir,
      timestamp: "2026-06-04T00:00:00.000Z",
      preflightDoctor: async () => [
        "Matter Workbench database doctor",
        "ready_to_apply: yes",
        "ready_to_hydrate: no",
        "next: Apply with MWB_DATABASE_URL set and npm run db:migrate.",
      ],
      buildReport: async () => {
        buildReportCalled = true;
        return {};
      },
      renderReport: () => [],
    }),
    /shadow database is not ready to snapshot/i,
  );
  assert.equal(buildReportCalled, false);
  assert.deepEqual(await readdir(outDir), []);
});

test("shadow DB snapshot repo metadata falls back safely outside git", async () => {
  const {
    collectGitRepoMetadata,
  } = await import(snapshotPath.href);

  const calls = [];
  const repo = collectGitRepoMetadata({
    cwd: "/tmp/not-a-repo",
    spawn: (command, args, options = {}) => {
      calls.push({ command, args, cwd: options.cwd });
      return { status: 128, stdout: "", stderr: "not a git repo" };
    },
  });

  assert.deepEqual(repo, {
    branch: "unknown",
    commit: "unknown",
    clean: false,
  });
  assert.deepEqual(calls.map((call) => call.args.join(" ")), [
    "rev-parse --abbrev-ref HEAD",
    "rev-parse --short HEAD",
    "status --porcelain",
  ]);
});

test("package and database docs expose the shadow DB snapshot command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:shadow:snapshot"], "node scripts/db-shadow-snapshot.mjs");

  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:shadow:snapshot/);
  assert.match(readme, /docs\/shadow-db-snapshots/);
  assert.match(readme, /db:shadow:snapshot[\s\S]*db:doctor[\s\S]*preflight/i);
  assert.match(readme, /ready_to_hydrate:\s*yes/i);
  assert.match(readme, /refuses to write/i);
});

test("shadow DB snapshot folder docs describe the doctor preflight", async () => {
  const readme = await readFile(snapshotsReadmePath, "utf8");

  assert.match(readme, /db:shadow:snapshot[\s\S]*db:doctor[\s\S]*preflight/i);
  assert.match(readme, /ready_to_hydrate:\s*yes/i);
  assert.match(readme, /refuses to write/i);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

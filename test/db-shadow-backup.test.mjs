import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const backupPath = new URL("../scripts/db-shadow-backup.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);
const handoffDocPath = new URL("../docs/database-transition-handoff.md", import.meta.url);

test("shadow DB backup writes an ignored local SQL dump and manifest without leaking credentials", async () => {
  const { runShadowBackup, renderShadowBackupResult } = await import(backupPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-shadow-backup-"));
  const calls = [];

  const result = await runShadowBackup({
    databaseUrl: "postgres://mwb_user:pw%21@db.example:5432/matter_workbench_shadow",
    outDir,
    timestamp: "2026-06-05T00:00:00.000Z",
    env: { MWB_PG_DUMP_BIN: "/custom/bin/pg_dump" },
    spawn: (command, args, options) => {
      calls.push({ command, args, env: options.env });
      writeFileSync(args.at(-1), "-- fake shadow dump\n");
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(result.success, true);
  assert.match(result.backupPath, /shadow-db-backup-2026-06-05T00-00-00-000Z\.sql$/);
  assert.match(result.manifestPath, /shadow-db-backup-2026-06-05T00-00-00-000Z\.json$/);
  assert.equal(calls[0].command, "/custom/bin/pg_dump");
  assert.deepEqual(calls[0].env.PGPASSWORD, "pw!");
  assert.deepEqual(calls[0].args.slice(-2), ["--file", result.backupPath]);

  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, "shadow-db-backup/v1");
  assert.equal(manifest.generatedAt, "2026-06-05T00:00:00.000Z");
  assert.equal(manifest.files.sql, path.basename(result.backupPath));
  assert.equal(manifest.databaseUrl, "configured");
  assert.equal(manifest.pgDump, "/custom/bin/pg_dump");
  assert.doesNotMatch(JSON.stringify(manifest), /pw!|postgres:\/\//);

  const rendered = renderShadowBackupResult(result).join("\n");
  assert.match(rendered, /Matter Workbench shadow DB backup/);
  assert.match(rendered, /success: yes/);
  assert.match(rendered, /\.local\/shadow-db-backups|mwb-shadow-backup-/);
  assert.doesNotMatch(rendered, /pw!|postgres:\/\//);

  await stat(result.backupPath);
  await stat(result.manifestPath);
});

test("shadow DB backup fails closed without a database URL", async () => {
  const { runShadowBackup } = await import(backupPath.href);

  await assert.rejects(
    () => runShadowBackup({ databaseUrl: "" }),
    /Set MWB_DATABASE_URL or DATABASE_URL/,
  );
});

test("shadow DB backup fills a generated timestamp when caller passes an empty timestamp", async () => {
  const { runShadowBackup } = await import(backupPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-shadow-backup-timestamp-"));

  const result = await runShadowBackup({
    databaseUrl: "postgres://mwb_user:pw@db.example/matter_workbench_shadow",
    outDir,
    timestamp: "",
    spawn: (command, args) => {
      writeFileSync(args.at(-1), "-- fake shadow dump\n");
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.equal(manifest.generatedAt, result.generatedAt);
});

test("shadow DB backup preserves redacted pg_dump failure evidence", async () => {
  const { runShadowBackup, renderShadowBackupResult } = await import(backupPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-shadow-backup-fail-"));

  const result = await runShadowBackup({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    outDir,
    timestamp: "2026-06-05T00:00:00.000Z",
    spawn: () => ({
      status: 1,
      stdout: "",
      stderr: "pg_dump failed for postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    }),
  });

  assert.equal(result.success, false);
  assert.match(renderShadowBackupResult(result).join("\n"), /postgres:\/\/mwb_user:\*\*\*@db\.example/);
  assert.doesNotMatch(renderShadowBackupResult(result).join("\n"), /mwb_user:secret|matter_workbench_shadow/);
});

test("package and docs expose the shadow DB backup command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:shadow:backup"], "node scripts/db-shadow-backup.mjs");

  const dbReadme = await readFile(dbReadmePath, "utf8");
  assert.match(dbReadme, /npm run db:shadow:backup/);
  assert.match(dbReadme, /local ignored backup/i);

  const handoffDoc = await readFile(handoffDocPath, "utf8");
  assert.match(handoffDoc, /npm run db:shadow:backup/);
  assert.match(handoffDoc, /backup/i);
});

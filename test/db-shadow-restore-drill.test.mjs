import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const restorePath = new URL("../scripts/db-shadow-restore-drill.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);
const handoffDocPath = new URL("../docs/database-transition-handoff.md", import.meta.url);

test("shadow DB restore drill restores a backup into a temporary database, verifies, and cleans up", async () => {
  const { runShadowRestoreDrill, renderShadowRestoreDrillResult } = await import(restorePath.href);
  const backupPath = await writeFakeBackup();
  const calls = [];

  const result = await runShadowRestoreDrill({
    databaseUrl: "postgres://mwb_user:pw%21@db.example:5432/matter_workbench_shadow",
    backupPath,
    timestamp: "2026-06-05T00:00:00.000Z",
    env: { MWB_PSQL_BIN: "/custom/bin/psql" },
    spawn: (command, args, options = {}) => {
      calls.push({ command, args, env: options.env });
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.cleanup, true);
  assert.equal(result.restoredDatabase, "matter_workbench_shadow_restore_2026_06_05T00_00_00_000Z");
  assert.equal(calls[0].command, "/custom/bin/psql");
  assert.deepEqual(calls[0].env.PGPASSWORD, "pw!");
  assert.equal(calls[0].args[calls[0].args.indexOf("-d") + 1], "matter_workbench_shadow");
  assert.match(calls[0].args.join(" "), /CREATE DATABASE "matter_workbench_shadow_restore_2026_06_05T00_00_00_000Z"/);
  assert.deepEqual(calls[1].args.slice(-2), ["-f", backupPath]);
  assert.equal(calls[2].command, "npm");
  assert.deepEqual(calls[2].args, ["run", "db:shadow:report", "--silent"]);
  assert.match(calls[2].env.MWB_DATABASE_URL, /matter_workbench_shadow_restore_2026_06_05T00_00_00_000Z$/);
  assert.match(calls[3].args.join(" "), /DROP DATABASE IF EXISTS "matter_workbench_shadow_restore_2026_06_05T00_00_00_000Z"/);
  assert.equal(calls[3].args[calls[3].args.indexOf("-d") + 1], "matter_workbench_shadow");

  const rendered = renderShadowRestoreDrillResult(result).join("\n");
  assert.match(rendered, /Matter Workbench shadow DB restore drill/);
  assert.match(rendered, /success: yes/);
  assert.match(rendered, /cleanup: yes/);
  assert.doesNotMatch(rendered, /pw!|postgres:\/\//);
});

test("shadow DB restore drill rejects unsafe or live database names", async () => {
  const { runShadowRestoreDrill } = await import(restorePath.href);
  const backupPath = await writeFakeBackup();

  await assert.rejects(
    () => runShadowRestoreDrill({
      databaseUrl: "postgres://mwb_user:pw@db.example/matter_workbench_shadow",
      backupPath,
      restoredDatabase: "matter_workbench_shadow",
    }),
    /Restore database name must start with matter_workbench_shadow_restore_/,
  );

  await assert.rejects(
    () => runShadowRestoreDrill({
      databaseUrl: "postgres://mwb_user:pw@db.example/matter_workbench_shadow",
      backupPath,
      restoredDatabase: "matter_workbench_shadow_restore_bad-name",
    }),
    /Restore database name may only contain letters, numbers, and underscores/,
  );
});

test("shadow DB restore drill cleans up even when verification fails", async () => {
  const { runShadowRestoreDrill, renderShadowRestoreDrillResult } = await import(restorePath.href);
  const backupPath = await writeFakeBackup();
  const calls = [];

  const result = await runShadowRestoreDrill({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    backupPath,
    restoredDatabase: "matter_workbench_shadow_restore_failure",
    spawn: (command, args, options = {}) => {
      calls.push({ command, args, env: options.env });
      if (command === "npm") {
        return {
          status: 1,
          stdout: "",
          stderr: "report failed for postgres://mwb_user:secret@db.example/matter_workbench_shadow",
        };
      }
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.cleanup, true);
  assert.equal(path.basename(calls.at(-1).command), "psql");
  assert.match(calls.at(-1).args.join(" "), /DROP DATABASE IF EXISTS "matter_workbench_shadow_restore_failure"/);
  const rendered = renderShadowRestoreDrillResult(result).join("\n");
  assert.match(rendered, /failed_step: verify restored database/);
  assert.match(rendered, /postgres:\/\/mwb_user:\*\*\*@db\.example/);
  assert.doesNotMatch(rendered, /mwb_user:secret/);
});

test("package and docs expose the shadow DB restore drill command", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:shadow:restore-drill"], "node scripts/db-shadow-restore-drill.mjs");

  const dbReadme = await readFile(dbReadmePath, "utf8");
  assert.match(dbReadme, /npm run db:shadow:restore-drill/);
  assert.match(dbReadme, /temporary restore database/i);

  const handoffDoc = await readFile(handoffDocPath, "utf8");
  assert.match(handoffDoc, /npm run db:shadow:restore-drill/);
  assert.match(handoffDoc, /restore drill/i);
  assert.match(handoffDoc, /pg_hba\.conf/i);
  assert.match(handoffDoc, /temporary restore database/i);
});

async function writeFakeBackup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-shadow-restore-"));
  const backupPath = path.join(dir, "backup.sql");
  await writeFile(backupPath, "-- fake backup\n");
  return backupPath;
}

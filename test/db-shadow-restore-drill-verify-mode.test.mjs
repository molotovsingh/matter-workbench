import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const restorePath = new URL("../scripts/db-shadow-restore-drill.mjs", import.meta.url);

test("shadow DB restore drill can verify restored SQL without source matter folders", async () => {
  const { runShadowRestoreDrill } = await import(restorePath.href);
  const backupPath = await writeFakeBackup();
  const calls = [];

  const result = await runShadowRestoreDrill({
    databaseUrl: "postgres://mwb_user:pw%21@db.example:5432/matter_workbench_shadow",
    backupPath,
    verificationMode: "sql-summary",
    timestamp: "2026-06-06T14:00:00.000Z",
    spawn: (command, args, options = {}) => {
      calls.push({ command, args, env: options.env });
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.verificationMode, "sql-summary");
  assert.equal(calls[2].command, calls[1].command);
  assert.match(calls[2].args.join(" "), /select json_build_object/i);
  assert.match(calls[2].args.join(" "), /preparation_advisory_snapshots/i);
  assert.doesNotMatch(calls[2].args.join(" "), /from advisory_snapshots\b/i);
  assert.notEqual(calls[2].command, "npm");
});

test("shadow DB restore drill keeps report verification mode available", async () => {
  const { runShadowRestoreDrill } = await import(restorePath.href);
  const backupPath = await writeFakeBackup();
  const calls = [];

  await runShadowRestoreDrill({
    databaseUrl: "postgres://mwb_user:pw%21@db.example:5432/matter_workbench_shadow",
    backupPath,
    verificationMode: "report",
    spawn: (command, args, options = {}) => {
      calls.push({ command, args, env: options.env });
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.equal(calls[2].command, "npm");
  assert.deepEqual(calls[2].args, ["run", "db:shadow:report", "--silent"]);
});

async function writeFakeBackup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-shadow-restore-verify-mode-"));
  const backupPath = path.join(dir, "backup.sql");
  await writeFile(backupPath, "-- fake backup\n");
  return backupPath;
}

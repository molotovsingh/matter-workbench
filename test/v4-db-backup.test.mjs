import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runV4DbBackup } from "../scripts/v4-db-backup.mjs";

test("V4 backup dumps exactly matter_workbench_v4 and writes a digest manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-backup-"));
  try {
    const calls = [];
    const result = await runV4DbBackup({
      databaseUrl: "postgresql://mwb_v4_migrator:top-secret@localhost/matter_workbench_v4",
      outDir: root,
      timestamp: "2026-08-29T07:00:00.000Z",
      spawn(command, args) {
        calls.push({ command, args });
        const outputIndex = args.indexOf("--file");
        writeFileSync(args[outputIndex + 1], "-- non-empty V4 SQL dump\n");
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(result.success, true);
    assert.ok(result.bytes > 0);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.ok(calls[0].args.some((arg) => String(arg).includes("matter_workbench_v4")));
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.schemaVersion, "v4-db-backup/v1");
    assert.equal(manifest.databaseName, "matter_workbench_v4");
    assert.equal(manifest.backup.bytes, result.bytes);
    assert.equal(manifest.backup.sha256, result.sha256);
    assert.doesNotMatch(JSON.stringify(manifest), /top-secret/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("V4 backup fails closed on zero bytes or missing digest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-backup-"));
  try {
    const result = await runV4DbBackup({
      databaseUrl: "postgresql://mwb_v4_migrator:x@localhost/matter_workbench_v4",
      outDir: root,
      spawn(command, args) { const i = args.indexOf("--file"); writeFileSync(args[i + 1], ""); return { status: 0, stdout: "", stderr: "" }; },
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "v4_db.backup_empty");
  } finally { await rm(root, { recursive: true, force: true }); }
});

// spawnSync-compatible fakes need synchronous file creation.
import { writeFileSync } from "node:fs";

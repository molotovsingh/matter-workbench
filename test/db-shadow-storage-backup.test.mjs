import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const backupPath = new URL("../scripts/db-shadow-storage-backup.mjs", import.meta.url);
const restoreCheckPath = new URL("../scripts/db-shadow-storage-restore-check.mjs", import.meta.url);
const acceptancePath = new URL("../scripts/db-shadow-acceptance.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);
const handoffDocPath = new URL("../docs/database-transition-handoff.md", import.meta.url);

test("shadow storage backup copies local PDF storage objects and writes a redacted manifest", async () => {
  const { runShadowStorageBackup, renderShadowStorageBackupResult } = await import(backupPath.href);
  const root = await fixtureMatterHome();
  const outDir = await mkdirTemp("mwb-shadow-storage-backup-");

  const result = await runShadowStorageBackup({
    mattersHome: root,
    storagePlan: fixtureStoragePlan(root),
    outDir,
    timestamp: "2026-06-05T00:00:00.000Z",
  });

  assert.equal(result.success, true);
  assert.equal(result.objectsCopied, 2);
  assert.equal(result.failedObjects, 0);
  assert.match(result.backupDir, /shadow-storage-backup-2026-06-05T00-00-00-000Z$/);
  assert.match(result.manifestPath, /manifest\.json$/);

  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, "shadow-storage-backup/v1");
  assert.equal(manifest.generatedAt, "2026-06-05T00:00:00.000Z");
  assert.equal(manifest.mattersHome, "configured");
  assert.equal(manifest.success, true);
  assert.equal(manifest.objects.length, 2);
  assert.deepEqual(
    manifest.objects.map((object) => object.objectKey).sort(),
    [
      "Atlas/00_Inbox/Intake 01/Source Files/a.pdf",
      "Atlas/00_Inbox/Intake 01/Source Files/b.pdf",
    ],
  );
  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(escapeRegExp(root)));
  assert.doesNotMatch(JSON.stringify(manifest), /matter_workbench_shadow|postgres:\/\//);

  const firstBackedUp = path.join(path.dirname(result.manifestPath), manifest.objects[0].backupRelativePath);
  await stat(firstBackedUp);

  const rendered = renderShadowStorageBackupResult(result).join("\n");
  assert.match(rendered, /Matter Workbench shadow storage backup/);
  assert.match(rendered, /success: yes/);
  assert.doesNotMatch(rendered, new RegExp(escapeRegExp(root)));
});

test("shadow storage backup fails closed when a referenced PDF is missing", async () => {
  const { runShadowStorageBackup } = await import(backupPath.href);
  const root = await fixtureMatterHome();
  const plan = fixtureStoragePlan(root);
  plan.storageObjects.push({
    objectKey: "Atlas/00_Inbox/Intake 01/Source Files/missing.pdf",
    objectRole: "source_original",
    bucket: "local-shadow",
    storageProvider: "local-filesystem",
    mimeType: "application/pdf",
    sha256: "abc",
  });

  const result = await runShadowStorageBackup({
    mattersHome: root,
    storagePlan: plan,
    outDir: await mkdirTemp("mwb-shadow-storage-backup-missing-"),
    timestamp: "2026-06-05T00:00:00.000Z",
  });

  assert.equal(result.success, false);
  assert.equal(result.failedObjects, 1);
  assert.match(result.failures[0].reason, /missing source file/i);
});

test("shadow storage restore check verifies backup hashes and catches tampering", async () => {
  const { runShadowStorageBackup } = await import(backupPath.href);
  const { runShadowStorageRestoreCheck, renderShadowStorageRestoreCheckResult } = await import(restoreCheckPath.href);
  const root = await fixtureMatterHome();
  const backup = await runShadowStorageBackup({
    mattersHome: root,
    storagePlan: fixtureStoragePlan(root),
    outDir: await mkdirTemp("mwb-shadow-storage-backup-check-"),
    timestamp: "2026-06-05T00:00:00.000Z",
  });

  const ok = await runShadowStorageRestoreCheck({ manifestPath: backup.manifestPath });
  assert.equal(ok.success, true);
  assert.equal(ok.checkedObjects, 2);
  assert.equal(ok.failedObjects, 0);

  const manifest = JSON.parse(await readFile(backup.manifestPath, "utf8"));
  const firstPath = path.join(path.dirname(backup.manifestPath), manifest.objects[0].backupRelativePath);
  await writeFile(firstPath, "tampered");

  const failed = await runShadowStorageRestoreCheck({ manifestPath: backup.manifestPath });
  assert.equal(failed.success, false);
  assert.equal(failed.failedObjects, 1);
  assert.match(renderShadowStorageRestoreCheckResult(failed).join("\n"), /hash mismatch/);
});

test("shadow storage restore check can write redacted handoff evidence files", async () => {
  const { runShadowStorageBackup } = await import(backupPath.href);
  const { runShadowStorageRestoreCheck } = await import(restoreCheckPath.href);
  const root = await fixtureMatterHome();
  const backup = await runShadowStorageBackup({
    mattersHome: root,
    storagePlan: fixtureStoragePlan(root),
    outDir: await mkdirTemp("mwb-shadow-storage-evidence-backup-"),
    timestamp: "2026-06-05T00:00:00.000Z",
  });
  const outDir = await mkdirTemp("mwb-shadow-storage-evidence-docs-");

  const result = await runShadowStorageRestoreCheck({
    manifestPath: backup.manifestPath,
    outDir,
    timestamp: "2026-06-05T00:01:00.000Z",
  });

  assert.equal(result.success, true);
  assert.ok(result.files.markdown.endsWith("shadow-storage-restore-check-2026-06-05T00-01-00-000Z.md"));
  assert.ok(result.files.json.endsWith("shadow-storage-restore-check-2026-06-05T00-01-00-000Z.json"));

  const markdown = await readFile(result.files.markdown, "utf8");
  assert.match(markdown, /Matter Workbench shadow storage restore check/);
  assert.match(markdown, /Success: yes/);
  assert.match(markdown, /Checked objects: 2/);
  assert.doesNotMatch(markdown, new RegExp(escapeRegExp(root)));

  const json = JSON.parse(await readFile(result.files.json, "utf8"));
  assert.equal(json.schemaVersion, "shadow-storage-restore-check/v1");
  assert.equal(json.success, true);
  assert.equal(json.checkedObjects, 2);
  assert.doesNotMatch(JSON.stringify(json), new RegExp(escapeRegExp(root)));
});

test("shadow acceptance storage evidence verifies latest backup against current PDF custody", async () => {
  const { runShadowStorageBackup } = await import(backupPath.href);
  const { checkShadowStorageBackupEvidence } = await import(acceptancePath.href);
  const root = await fixtureMatterHome();
  const outDir = await mkdirTemp("mwb-shadow-storage-evidence-");
  const storagePlan = fixtureStoragePlan(root);

  await runShadowStorageBackup({
    mattersHome: root,
    storagePlan,
    outDir,
    timestamp: "2026-06-05T00:00:00.000Z",
  });

  const accepted = await checkShadowStorageBackupEvidence({
    mattersHome: root,
    storagePlan,
    backupRoot: outDir,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.checkedObjects, 2);
  assert.equal(accepted.missingCurrentObjects, 0);
  assert.equal(accepted.hashMismatches, 0);

  storagePlan.storageObjects.push(pdfObject("Atlas/00_Inbox/Intake 01/Source Files/new.pdf", "new"));
  const stale = await checkShadowStorageBackupEvidence({
    mattersHome: root,
    storagePlan,
    backupRoot: outDir,
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.missingCurrentObjects, 1);
});

test("package and docs expose shadow storage backup and restore-check commands", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:shadow:storage-backup"], "node scripts/db-shadow-storage-backup.mjs");
  assert.equal(pkg.scripts["db:shadow:storage-restore-check"], "node scripts/db-shadow-storage-restore-check.mjs");

  const dbReadme = await readFile(dbReadmePath, "utf8");
  assert.match(dbReadme, /npm run db:shadow:storage-backup/);
  assert.match(dbReadme, /npm run db:shadow:storage-restore-check/);

  const handoffDoc = await readFile(handoffDocPath, "utf8");
  assert.match(handoffDoc, /db:shadow:storage-backup/);
  assert.match(handoffDoc, /db:shadow:storage-restore-check/);
});

async function fixtureMatterHome() {
  const root = await mkdirTemp("mwb-shadow-storage-fixture-");
  const sourceDir = path.join(root, "Atlas", "00_Inbox", "Intake 01", "Source Files");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "a.pdf"), "pdf-a");
  await writeFile(path.join(sourceDir, "b.pdf"), "pdf-b");
  await writeFile(path.join(sourceDir, "note.md"), "not a pdf");
  return root;
}

function fixtureStoragePlan(root) {
  return {
    mattersHome: root,
    storageObjects: [
      pdfObject("Atlas/00_Inbox/Intake 01/Source Files/a.pdf", "pdf-a"),
      pdfObject("Atlas/00_Inbox/Intake 01/Source Files/b.pdf", "pdf-b"),
      {
        objectKey: "Atlas/00_Inbox/Intake 01/Source Files/note.md",
        objectRole: "matter_artifact",
        bucket: "local-shadow",
        storageProvider: "local-filesystem",
        mimeType: "text/markdown",
        sha256: sha256("not a pdf"),
      },
    ],
  };
}

function pdfObject(objectKey, text) {
  return {
    objectKey,
    objectRole: "source_original",
    bucket: "local-shadow",
    storageProvider: "local-filesystem",
    mimeType: "application/pdf",
    sha256: sha256(text),
  };
}

async function mkdirTemp(prefix) {
  return await mkdir(path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`), { recursive: true }).then((created) => created);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

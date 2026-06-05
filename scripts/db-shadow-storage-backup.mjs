#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { collectLocalStorageHydrationPlan } from "./db-hydrate-local-storage.mjs";
import { defaultMattersHome } from "./db-hydrate-local-matters.mjs";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "shadow-storage-backup/v1";

export function parseStorageBackupArgs(argv = []) {
  const parsed = {
    appDir: process.cwd(),
    mattersHome: defaultMattersHome(),
    outDir: path.resolve(".local", "shadow-storage-backups"),
    timestamp: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--app-dir requires a value");
      parsed.appDir = path.resolve(value);
      i += 1;
    } else if (arg === "--matters-home") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matters-home requires a value");
      parsed.mattersHome = path.resolve(value);
      i += 1;
    } else if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out-dir requires a value");
      parsed.outDir = path.resolve(value);
      i += 1;
    } else if (arg === "--timestamp") {
      const value = argv[i + 1];
      if (!value) throw new Error("--timestamp requires a value");
      parsed.timestamp = value;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runShadowStorageBackup({
  appDir = process.cwd(),
  mattersHome = defaultMattersHome(),
  outDir = path.resolve(".local", "shadow-storage-backups"),
  timestamp = new Date().toISOString(),
  storagePlan,
  collectStoragePlan = collectLocalStorageHydrationPlan,
  copyFileFn = copyFile,
} = {}) {
  const generatedAt = timestamp || new Date().toISOString();
  const slug = timestampSlug(generatedAt);
  const backupDir = path.join(outDir, `shadow-storage-backup-${slug}`);
  const manifestPath = path.join(backupDir, "manifest.json");
  const plan = storagePlan || await collectStoragePlan({ appDir, mattersHome });
  const pdfObjects = pdfStorageObjects(plan);
  const objects = [];
  const failures = [];

  await mkdir(path.join(backupDir, "objects"), { recursive: true });

  for (const object of pdfObjects) {
    const objectKey = normalizeObjectKey(object.objectKey);
    const backupRelativePath = normalizeObjectKey(path.posix.join("objects", objectKey));
    const sourcePath = resolveInside(mattersHome, objectKey);
    const destinationPath = resolveInside(backupDir, backupRelativePath);
    const entry = {
      objectKey,
      objectRole: String(object.objectRole || ""),
      bucket: String(object.bucket || ""),
      storageProvider: String(object.storageProvider || ""),
      mimeType: String(object.mimeType || ""),
      backupRelativePath,
      bytes: 0,
      sha256: "",
      expectedSha256: String(object.sha256 || ""),
      expectedHashMatched: null,
    };

    try {
      const sourceStats = await stat(sourcePath);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFileFn(sourcePath, destinationPath);
      const backupStats = await stat(destinationPath);
      const sha256 = await sha256File(destinationPath);
      entry.bytes = backupStats.size;
      entry.sha256 = sha256;
      if (entry.expectedSha256) entry.expectedHashMatched = entry.expectedSha256 === sha256;
      if (entry.expectedHashMatched === false) {
        failures.push({ objectKey, reason: "hash mismatch against storage object metadata" });
      }
      if (sourceStats.size !== backupStats.size) {
        failures.push({ objectKey, reason: "copied file size mismatch" });
      }
    } catch (error) {
      failures.push({ objectKey, reason: classifyCopyError(error) });
    }
    objects.push(entry);
  }

  const success = failures.length === 0;
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    mattersHome: "configured",
    success,
    totals: {
      pdfObjects: pdfObjects.length,
      copiedObjects: objects.filter((object) => object.sha256).length,
      failedObjects: failures.length,
    },
    files: {
      manifest: path.basename(manifestPath),
    },
    objects,
    failures,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    success,
    generatedAt,
    backupDir,
    manifestPath,
    pdfObjects: pdfObjects.length,
    objectsCopied: manifest.totals.copiedObjects,
    failedObjects: failures.length,
    failures,
  };
}

export function renderShadowStorageBackupResult(result = {}) {
  const lines = [
    "Matter Workbench shadow storage backup",
    `success: ${result.success ? "yes" : "no"}`,
    `generated_at: ${result.generatedAt || ""}`,
    `backup_dir: ${result.backupDir || ""}`,
    `manifest: ${result.manifestPath || ""}`,
    `pdf_objects: ${result.pdfObjects || 0}`,
    `objects_copied: ${result.objectsCopied || 0}`,
    `failed_objects: ${result.failedObjects || 0}`,
  ];
  for (const failure of result.failures || []) {
    lines.push(`failure: ${failure.objectKey || ""} - ${failure.reason || ""}`);
  }
  return lines;
}

function pdfStorageObjects(plan = {}) {
  return (plan.storageObjects || []).filter((object) => {
    if (object.storageProvider !== "local-filesystem") return false;
    const key = String(object.objectKey || "").toLowerCase();
    const mime = String(object.mimeType || "").toLowerCase();
    return mime === "application/pdf" || key.endsWith(".pdf");
  });
}

function normalizeObjectKey(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root || ".");
  const resolvedPath = path.resolve(resolvedRoot, normalizeObjectKey(relativePath));
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Unsafe storage object path: ${relativePath}`);
  }
  return resolvedPath;
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function classifyCopyError(error) {
  if (error?.code === "ENOENT") return "missing source file";
  return error?.message || "copy failed";
}

async function main() {
  const args = parseStorageBackupArgs(process.argv.slice(2));
  const result = await runShadowStorageBackup(args);
  for (const line of renderShadowStorageBackupResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

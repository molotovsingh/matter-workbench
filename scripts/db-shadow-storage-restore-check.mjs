#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "shadow-storage-backup/v1";
const EVIDENCE_SCHEMA_VERSION = "shadow-storage-restore-check/v1";

export function parseStorageRestoreCheckArgs(argv = []) {
  const parsed = {
    manifestPath: "",
    outDir: "",
    timestamp: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") {
      const value = argv[i + 1];
      if (!value) throw new Error("--manifest requires a value");
      parsed.manifestPath = path.resolve(value);
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

  if (!parsed.manifestPath) throw new Error("Pass --manifest .local/shadow-storage-backups/<backup>/manifest.json.");
  return parsed;
}

export async function runShadowStorageRestoreCheck({
  manifestPath,
  outDir = "",
  timestamp = new Date().toISOString(),
} = {}) {
  if (!manifestPath) throw new Error("Pass manifestPath before checking a shadow storage backup.");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported shadow storage backup manifest: ${manifest.schemaVersion || "(missing)"}`);
  }

  const backupRoot = path.dirname(path.resolve(manifestPath));
  const failures = [];
  let checkedObjects = 0;

  for (const object of manifest.objects || []) {
    checkedObjects += 1;
    const relativePath = normalizeObjectKey(object.backupRelativePath);
    const backupPath = resolveInside(backupRoot, relativePath);
    try {
      const stats = await stat(backupPath);
      const sha256 = await sha256File(backupPath);
      if (object.sha256 && object.sha256 !== sha256) {
        failures.push({ objectKey: object.objectKey || "", reason: "hash mismatch" });
        continue;
      }
      if (Number(object.bytes) !== stats.size) {
        failures.push({ objectKey: object.objectKey || "", reason: "size mismatch" });
        continue;
      }
    } catch (error) {
      failures.push({
        objectKey: object.objectKey || "",
        reason: error?.code === "ENOENT" ? "missing backup object" : error?.message || "restore check failed",
      });
    }
  }

  const result = {
    success: failures.length === 0,
    generatedAt: manifest.generatedAt || "",
    manifest: path.basename(manifestPath),
    checkedObjects,
    failedObjects: failures.length,
    failures,
  };
  if (outDir) result.files = await writeStorageRestoreEvidence({ result, outDir, timestamp });
  return result;
}

export function renderShadowStorageRestoreCheckResult(result = {}) {
  const lines = [
    "Matter Workbench shadow storage restore check",
    `success: ${result.success ? "yes" : "no"}`,
    `generated_at: ${result.generatedAt || ""}`,
    `manifest: ${result.manifest || ""}`,
    `checked_objects: ${result.checkedObjects || 0}`,
    `failed_objects: ${result.failedObjects || 0}`,
  ];
  for (const failure of result.failures || []) {
    lines.push(`failure: ${failure.objectKey || ""} - ${failure.reason || ""}`);
  }
  return lines;
}

function normalizeObjectKey(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

async function writeStorageRestoreEvidence({ result, outDir, timestamp }) {
  const generatedAt = timestamp || new Date().toISOString();
  const slug = timestampSlug(generatedAt);
  const markdownPath = path.join(outDir, `shadow-storage-restore-check-${slug}.md`);
  const jsonPath = path.join(outDir, `shadow-storage-restore-check-${slug}.json`);
  await mkdir(outDir, { recursive: true });

  const json = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    sourceBackupGeneratedAt: result.generatedAt || "",
    success: Boolean(result.success),
    manifest: result.manifest || "",
    checkedObjects: result.checkedObjects || 0,
    failedObjects: result.failedObjects || 0,
    failures: result.failures || [],
  };
  await writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
  await writeFile(markdownPath, `${renderStorageRestoreEvidenceMarkdown(json).join("\n")}\n`);
  return { markdown: markdownPath, json: jsonPath };
}

function renderStorageRestoreEvidenceMarkdown(evidence = {}) {
  const lines = [
    "# Matter Workbench shadow storage restore check",
    "",
    `Generated: ${evidence.generatedAt || ""}`,
    `Source backup generated: ${evidence.sourceBackupGeneratedAt || ""}`,
    `Manifest: ${evidence.manifest || ""}`,
    `Success: ${evidence.success ? "yes" : "no"}`,
    `Checked objects: ${evidence.checkedObjects || 0}`,
    `Failed objects: ${evidence.failedObjects || 0}`,
    "",
    "This is a shadow-storage restore-check handoff artifact. It proves a local storage backup manifest can be read and its backed-up PDF objects are present and hash-matching. It does not include source document bytes.",
  ];
  if (evidence.failures?.length) {
    lines.push("", "Failures:");
    for (const failure of evidence.failures) {
      lines.push(`- ${failure.objectKey || ""}: ${failure.reason || ""}`);
    }
  }
  return lines;
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root || ".");
  const resolvedPath = path.resolve(resolvedRoot, normalizeObjectKey(relativePath));
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Unsafe backup object path: ${relativePath}`);
  }
  return resolvedPath;
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const args = parseStorageRestoreCheckArgs(process.argv.slice(2));
  const result = await runShadowStorageRestoreCheck(args);
  for (const line of renderShadowStorageRestoreCheckResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

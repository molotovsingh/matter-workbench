#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_REAL_MATTER_FILTER = (name) => !name.startsWith("Dummy ");

export async function buildModeAResetPlan(options = {}) {
  const appDir = path.resolve(options.appDir || repoRoot);
  const mattersHome = await resolveMattersHome({ appDir, explicit: options.mattersHome });
  const backupRoot = path.resolve(options.backupRoot || path.join(os.homedir(), "matter-workbench-backups"));
  const runId = options.runId || `v1-beta-mode-a-${timestampForPath(new Date())}`;
  const backupDir = path.join(backupRoot, runId);
  const allMatterNames = await listMatterNames(mattersHome);
  const selectedNames = selectMatterNames(allMatterNames, options);
  const matters = [];

  for (const matterName of selectedNames) {
    const matterRoot = path.join(mattersHome, matterName);
    const matterJsonPath = path.join(matterRoot, "matter.json");
    const matterJson = await readJsonSafe(matterJsonPath);
    const sourceFiles = await discoverSourceFiles(matterRoot);
    const topLevelEntries = await listTopLevelEntries(matterRoot);
    matters.push({
      matterName,
      matterRoot,
      matterJsonPath,
      hasMatterJson: Boolean(matterJson),
      sourceFileCount: sourceFiles.length,
      sourceBytes: sourceFiles.reduce((sum, file) => sum + file.size, 0),
      sourceFiles,
      resetEntries: topLevelEntries.filter((entry) => entry.name !== "matter.json"),
    });
  }

  return {
    schema_version: "v1-beta-mode-a-reset-plan/v1",
    generated_at: new Date().toISOString(),
    appDir,
    mattersHome,
    backupRoot,
    runId,
    backupDir,
    mode: options.apply ? "apply" : "dry-run",
    matters,
  };
}

export async function applyModeAReset(options = {}) {
  const plan = await buildModeAResetPlan({ ...options, apply: true });
  await mkdir(plan.backupDir, { recursive: true });

  const manifest = {
    schema_version: "v1-beta-mode-a-reset-manifest/v1",
    generated_at: new Date().toISOString(),
    mattersHome: plan.mattersHome,
    backupDir: plan.backupDir,
    runId: plan.runId,
    matters: [],
  };

  for (const matter of plan.matters) {
    const matterBackupDir = path.join(plan.backupDir, "matters", matter.matterName);
    const sourceBackupDir = path.join(plan.backupDir, "source-files", matter.matterName);
    await mkdir(matterBackupDir, { recursive: true });
    await mkdir(sourceBackupDir, { recursive: true });

    const matterRecord = {
      matterName: matter.matterName,
      matterRoot: matter.matterRoot,
      matterJsonBackup: "",
      sourceFiles: [],
      movedEntries: [],
    };

    if (matter.hasMatterJson) {
      const matterJsonBackup = path.join(matterBackupDir, "matter.json");
      await copyFile(matter.matterJsonPath, matterJsonBackup);
      matterRecord.matterJsonBackup = path.relative(plan.backupDir, matterJsonBackup);
    }

    for (const source of matter.sourceFiles) {
      const backupPath = path.join(sourceBackupDir, source.importRelativePath);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(source.absolutePath, backupPath);
      matterRecord.sourceFiles.push({
        originalRelativePath: source.matterRelativePath,
        importRelativePath: source.importRelativePath,
        backupRelativePath: path.relative(plan.backupDir, backupPath),
        size: source.size,
        sha256: source.sha256,
        discoveredFrom: source.discoveredFrom,
      });
    }

    await writeManifest(plan.backupDir, manifest);

    for (const entry of matter.resetEntries) {
      const from = path.join(matter.matterRoot, entry.name);
      const to = path.join(matterBackupDir, "state", entry.name);
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);
      matterRecord.movedEntries.push({
        name: entry.name,
        type: entry.type,
        backupRelativePath: path.relative(plan.backupDir, to),
      });
    }

    manifest.matters.push(matterRecord);
    await writeManifest(plan.backupDir, manifest);
  }

  return manifest;
}

async function writeManifest(backupDir, manifest) {
  await writeFile(path.join(backupDir, "reset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function resolveMattersHome({ appDir, explicit }) {
  if (explicit) return path.resolve(explicit);
  if (process.env.MATTERS_HOME) return path.resolve(process.env.MATTERS_HOME);
  const configPath = path.join(appDir, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (!config.mattersHome) throw new Error("mattersHome is not configured");
  return path.resolve(config.mattersHome);
}

async function listMatterNames(mattersHome) {
  const entries = await readdir(mattersHome, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function selectMatterNames(allMatterNames, options = {}) {
  if (options.matterNames?.length) {
    const wanted = new Set(options.matterNames);
    const missing = [...wanted].filter((name) => !allMatterNames.includes(name));
    if (missing.length) throw new Error(`Matter(s) not found: ${missing.join(", ")}`);
    return allMatterNames.filter((name) => wanted.has(name));
  }
  if (options.all) return allMatterNames;
  return allMatterNames.filter(DEFAULT_REAL_MATTER_FILTER);
}

async function readJsonSafe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function listTopLevelEntries(matterRoot) {
  const entries = await readdir(matterRoot, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith(".DS_Store"))
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverSourceFiles(matterRoot) {
  const sourceDirs = await findNamedDirs(matterRoot, "Source Files");
  const files = [];
  for (const sourceDir of sourceDirs) {
    const intakeName = path.basename(path.dirname(sourceDir));
    const discoveredFrom = path.relative(matterRoot, sourceDir);
    const nestedFiles = await listFiles(sourceDir);
    for (const absolutePath of nestedFiles) {
      const fileStat = await stat(absolutePath);
      const sourceRelative = path.relative(sourceDir, absolutePath);
      files.push({
        absolutePath,
        matterRelativePath: path.relative(matterRoot, absolutePath),
        importRelativePath: sourceDirs.length > 1
          ? path.join(intakeName, sourceRelative)
          : sourceRelative,
        discoveredFrom,
        size: fileStat.size,
        sha256: await sha256File(absolutePath),
      });
    }
  }
  if (files.length) return dedupeImportPaths(files);

  const originalsDirs = await findNamedDirs(matterRoot, "Originals");
  for (const originalsDir of originalsDirs) {
    const intakeName = path.basename(path.dirname(originalsDir));
    const discoveredFrom = path.relative(matterRoot, originalsDir);
    const nestedFiles = await listFiles(originalsDir);
    for (const absolutePath of nestedFiles) {
      const fileStat = await stat(absolutePath);
      const sourceRelative = path.relative(originalsDir, absolutePath);
      files.push({
        absolutePath,
        matterRelativePath: path.relative(matterRoot, absolutePath),
        importRelativePath: originalsDirs.length > 1
          ? path.join(intakeName, sourceRelative)
          : sourceRelative,
        discoveredFrom,
        size: fileStat.size,
        sha256: await sha256File(absolutePath),
      });
    }
  }
  return dedupeImportPaths(files);
}

function dedupeImportPaths(files) {
  const seen = new Map();
  return files.map((file) => {
    let importRelativePath = file.importRelativePath;
    const prior = seen.get(importRelativePath);
    if (prior && prior !== file.sha256) {
      const parsed = path.parse(importRelativePath);
      importRelativePath = path.join(parsed.dir, `${parsed.name}-${file.sha256.slice(0, 8)}${parsed.ext}`);
    }
    seen.set(importRelativePath, file.sha256);
    return { ...file, importRelativePath };
  });
}

async function findNamedDirs(root, name) {
  const matches = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const absolutePath = path.join(dir, entry.name);
      if (entry.name === name) {
        matches.push(absolutePath);
        continue;
      }
      if (entry.name === "By Type" || entry.name === "_extracted") continue;
      await walk(absolutePath);
    }
  }
  await walk(root);
  return matches.sort((a, b) => a.localeCompare(b));
}

async function listFiles(root) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else if (entry.isFile() && !entry.name.startsWith(".DS_Store") && !entry.name.startsWith("~$")) {
        files.push(absolutePath);
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function timestampForPath(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function parseArgs(argv) {
  const options = {
    all: false,
    apply: false,
    appDir: repoRoot,
    backupRoot: "",
    matterNames: [],
    mattersHome: "",
    runId: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") options.all = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--app-dir") options.appDir = requireValue(argv, ++index, arg);
    else if (arg === "--backup-root") options.backupRoot = requireValue(argv, ++index, arg);
    else if (arg === "--matter") options.matterNames.push(requireValue(argv, ++index, arg));
    else if (arg === "--matters-home") options.mattersHome = requireValue(argv, ++index, arg);
    else if (arg === "--run-id") options.runId = requireValue(argv, ++index, arg);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function printPlan(plan) {
  console.log(`Mode A reset ${plan.mode}`);
  console.log(`Matters home: ${plan.mattersHome}`);
  console.log(`Backup: ${plan.backupDir}`);
  console.log(`Matters: ${plan.matters.length}`);
  for (const matter of plan.matters) {
    console.log(`- ${matter.matterName}: ${matter.sourceFileCount} source file(s), ${formatBytes(matter.sourceBytes)}, reset ${matter.resetEntries.length} top-level entr${matter.resetEntries.length === 1 ? "y" : "ies"}`);
  }
}

function printHelp() {
  console.log([
    "Usage: node scripts/v1-beta-mode-a-reset.mjs [options]",
    "",
    "Defaults to real-looking matters only, excluding folders beginning with 'Dummy '.",
    "",
    "Options:",
    "  --apply                 Copy sources to backup and reset matter folders to matter.json only.",
    "  --all                   Include dummy matters too.",
    "  --matter <name>         Reset one named matter. Repeatable.",
    "  --matters-home <path>   Override configured matters home.",
    "  --backup-root <path>    Override backup root.",
    "  --run-id <id>           Override backup run id.",
    "  --help                  Show help.",
  ].join("\n"));
}

function formatBytes(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const options = parseArgs(process.argv.slice(2));
  (options.apply ? applyModeAReset(options) : buildModeAResetPlan(options))
    .then((result) => {
      if (options.apply) {
        console.log(`Mode A reset applied: ${result.backupDir}`);
        console.log(`Manifest: ${path.join(result.backupDir, "reset-manifest.json")}`);
        console.log(`Matters reset: ${result.matters.length}`);
      } else {
        printPlan(result);
      }
    })
    .catch((error) => {
      console.error(error?.stack || error?.message || error);
      process.exitCode = 1;
    });
}

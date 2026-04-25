import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toPosix } from "./path-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MATTER_ROOT = process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null;
const INTAKE_ID = "INTAKE-01";
const INTAKE_DIR_NAME = "Intake 01 - Initial";
const ENGINE_VERSION = "phase1-deterministic-v1";
const ROOT_FILE_SKIP_NAMES = new Set([
  ".DS_Store",
  "matter.json",
]);

const CATEGORY_BY_EXTENSION = new Map([
  [".pdf", "PDFs"],
  [".doc", "Word Documents"],
  [".docx", "Word Documents"],
  [".xls", "Spreadsheets"],
  [".xlsx", "Spreadsheets"],
  [".csv", "Spreadsheets"],
  [".jpg", "Images"],
  [".jpeg", "Images"],
  [".png", "Images"],
  [".heic", "Images"],
  [".eml", "Emails"],
  [".msg", "Emails"],
  [".zip", "Archives"],
  [".md", "Text Notes"],
  [".txt", "Text Notes"],
]);

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function normalizeName(name) {
  const parsed = path.parse(name);
  const stem = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "unnamed";
  return `${stem}${parsed.ext.toLowerCase()}`;
}

function classifyFile(filePath) {
  return CATEGORY_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) || "Needs Review";
}

function isIgnoredRootFile(name) {
  return name.startsWith(".") || ROOT_FILE_SKIP_NAMES.has(name);
}

function isIgnoredPath(relativePath) {
  const parts = relativePath.split(path.sep);
  return parts.some((part) => (
    part === ".DS_Store"
    || part.startsWith(".")
    || part === "Originals"
    || part === "By Type"
  ));
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root, base = root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    const relativePath = path.relative(base, absolutePath);
    if (isIgnoredPath(relativePath)) continue;

    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, base));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files.sort((a, b) => toPosix(path.relative(base, a)).localeCompare(toPosix(path.relative(base, b))));
}

async function copyIfNeeded(sourcePath, destinationPath, expectedHash, dryRun) {
  if (dryRun) return "dry-run";

  await mkdir(path.dirname(destinationPath), { recursive: true });

  try {
    const existingHash = await sha256(destinationPath);
    if (existingHash === expectedHash) return "already-current";
  } catch {
    // Destination does not exist or cannot be read; copy below.
  }

  await copyFile(sourcePath, destinationPath);
  return "copied";
}

async function resolveStagingDestination(sourcePath, destinationPath, sourceHash) {
  const parsed = path.parse(destinationPath);

  for (let index = 1; index < 1000; index += 1) {
    const candidate = index === 1
      ? destinationPath
      : path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);

    try {
      const candidateStat = await stat(candidate);
      if (!candidateStat.isFile()) continue;
      const existingHash = await sha256(candidate);
      if (existingHash === sourceHash) {
        return {
          destinationPath: candidate,
          status: "already-current",
          renamed: candidate !== destinationPath,
        };
      }
    } catch {
      return {
        destinationPath: candidate,
        status: "missing",
        renamed: candidate !== destinationPath,
      };
    }
  }

  throw new Error(`Could not find a safe intake filename for ${sourcePath}`);
}

async function stageLooseRootFiles(paths, dryRun) {
  const entries = await readdir(paths.matterRoot, { withFileTypes: true });
  const stagedRows = [];
  let copied = 0;
  let alreadyCurrent = 0;

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || isIgnoredRootFile(entry.name)) continue;

    const sourcePath = path.join(paths.matterRoot, entry.name);
    const sourceHash = await sha256(sourcePath);
    const preferredDestination = path.join(paths.sourceDir, entry.name);
    const stagingTarget = await resolveStagingDestination(sourcePath, preferredDestination, sourceHash);
    let status = stagingTarget.status;

    if (status === "already-current") {
      alreadyCurrent += 1;
    } else if (dryRun) {
      status = "dry-run";
    } else {
      await mkdir(path.dirname(stagingTarget.destinationPath), { recursive: true });
      await copyFile(sourcePath, stagingTarget.destinationPath);
      status = "copied";
      copied += 1;
    }

    stagedRows.push({
      source_path: toPosix(path.relative(paths.matterRoot, sourcePath)),
      staged_path: toPosix(path.relative(paths.matterRoot, stagingTarget.destinationPath)),
      source_sha256: sourceHash,
      status,
      renamed: stagingTarget.renamed,
    });
  }

  return {
    rows: stagedRows,
    copied,
    alreadyCurrent,
  };
}

async function readExistingMatterJson(matterRoot) {
  try {
    return JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  } catch {
    return {};
  }
}

function resolvePaths(matterRoot) {
  const intakeDir = path.join(matterRoot, "00_Inbox", INTAKE_DIR_NAME);
  return {
    matterRoot,
    intakeDir,
    sourceDir: path.join(intakeDir, "Source Files"),
    originalsDir: path.join(intakeDir, "Originals"),
    byTypeDir: path.join(intakeDir, "By Type"),
    intakeLogPath: path.join(intakeDir, "Intake Log.csv"),
    fileRegisterPath: path.join(intakeDir, "File Register.csv"),
    matterJsonPath: path.join(matterRoot, "matter.json"),
  };
}

export async function runMatterInit(options = {}) {
  const configuredMatterRoot = options.matterRoot || DEFAULT_MATTER_ROOT;
  if (!configuredMatterRoot) {
    throw new Error("MATTER_ROOT is not configured");
  }
  const matterRoot = path.resolve(configuredMatterRoot);
  const metadata = options.metadata || {};
  const dryRun = Boolean(options.dryRun);
  const paths = resolvePaths(matterRoot);
  const rootStaging = await stageLooseRootFiles(paths, dryRun);

  const sourceFiles = [];
  if (await pathExists(paths.sourceDir)) {
    const files = await listFiles(paths.sourceDir);
    files.forEach((sourcePath) => {
      sourceFiles.push({
        sourcePath,
        relativeSource: path.relative(paths.sourceDir, sourcePath),
      });
    });
  } else if (dryRun && rootStaging.rows.length) {
    rootStaging.rows.forEach((row) => {
      sourceFiles.push({
        sourcePath: path.join(matterRoot, row.source_path),
        relativeSource: path.basename(row.staged_path),
      });
    });
  } else {
    throw new Error(`Intake source folder is missing: ${toPosix(path.relative(matterRoot, paths.sourceDir))}`);
  }

  const seenByHash = new Map();
  const fileRegisterRows = [];
  let originalsCopied = 0;
  let workingCopiesCopied = 0;

  for (const [index, sourceFile] of sourceFiles.entries()) {
    const { sourcePath, relativeSource } = sourceFile;
    const fileId = `FILE-${String(index + 1).padStart(4, "0")}`;
    const sourceHash = await sha256(sourcePath);
    const fileStat = await stat(sourcePath);
    const duplicateOf = seenByHash.get(sourceHash) || "";
    if (!duplicateOf) seenByHash.set(sourceHash, fileId);

    const originalDestination = path.join(paths.originalsDir, relativeSource);
    const category = classifyFile(sourcePath);
    const workingCopyName = `${fileId}__${normalizeName(path.basename(sourcePath))}`;
    const workingCopyDestination = path.join(paths.byTypeDir, category, workingCopyName);

    const originalCopyStatus = await copyIfNeeded(sourcePath, originalDestination, sourceHash, dryRun);
    const workingCopyStatus = await copyIfNeeded(sourcePath, workingCopyDestination, sourceHash, dryRun);
    if (originalCopyStatus === "copied") originalsCopied += 1;
    if (workingCopyStatus === "copied") workingCopiesCopied += 1;

    fileRegisterRows.push({
      file_id: fileId,
      intake_id: INTAKE_ID,
      source_path: toPosix(path.relative(matterRoot, sourcePath)),
      original_path: toPosix(path.relative(matterRoot, originalDestination)),
      working_copy_path: toPosix(path.relative(matterRoot, workingCopyDestination)),
      category,
      original_name: path.basename(sourcePath),
      sha256: sourceHash,
      size_bytes: fileStat.size,
      duplicate_of: duplicateOf,
      status: duplicateOf ? "exact-duplicate" : "unique",
      engine_version: ENGINE_VERSION,
      notes: duplicateOf ? `Exact duplicate of ${duplicateOf}.` : "First-seen file for this checksum.",
    });
  }

  const uniqueFiles = fileRegisterRows.filter((row) => row.status === "unique").length;
  const duplicateFiles = fileRegisterRows.length - uniqueFiles;
  const intakeLogRows = [{
    intake_id: INTAKE_ID,
    intake_dir: toPosix(path.relative(matterRoot, paths.intakeDir)),
    source_dir: toPosix(path.relative(matterRoot, paths.sourceDir)),
    originals_dir: toPosix(path.relative(matterRoot, paths.originalsDir)),
    by_type_dir: toPosix(path.relative(matterRoot, paths.byTypeDir)),
    scanned_files: fileRegisterRows.length,
    unique_files: uniqueFiles,
    duplicate_files: duplicateFiles,
    originals_copied: originalsCopied,
    working_copies_copied: workingCopiesCopied,
    loose_root_files_seen: rootStaging.rows.length,
    loose_root_files_staged: rootStaging.copied,
    engine_version: ENGINE_VERSION,
    notes: "Deterministic copy-only intake. Source files are copied into the Inbox when needed; originals are not moved or modified.",
  }];

  const existingMatter = await readExistingMatterJson(matterRoot);
  const matterJson = {
    ...existingMatter,
    matter_name: metadata.matterName || existingMatter.matter_name || "",
    matter_type: metadata.matterType || existingMatter.matter_type || "",
    client_name: metadata.clientName || existingMatter.client_name || "",
    opposite_party: metadata.oppositeParty || existingMatter.opposite_party || "",
    jurisdiction: metadata.jurisdiction || existingMatter.jurisdiction || "",
    brief_description: metadata.briefDescription || existingMatter.brief_description || "",
    workspace_mode: existingMatter.workspace_mode || "legal",
    phase_1_intake: {
      intake_id: INTAKE_ID,
      engine_version: ENGINE_VERSION,
      source_dir: toPosix(path.relative(matterRoot, paths.sourceDir)),
      originals_dir: toPosix(path.relative(matterRoot, paths.originalsDir)),
      by_type_dir: toPosix(path.relative(matterRoot, paths.byTypeDir)),
      intake_log: toPosix(path.relative(matterRoot, paths.intakeLogPath)),
      file_register: toPosix(path.relative(matterRoot, paths.fileRegisterPath)),
      scanned_files: fileRegisterRows.length,
      unique_files: uniqueFiles,
      duplicate_files: duplicateFiles,
      loose_root_files_seen: rootStaging.rows.length,
      loose_root_files_staged: rootStaging.copied,
      loose_root_source_files: rootStaging.rows.map((row) => ({
        source_path: row.source_path,
        staged_path: row.staged_path,
        status: row.status,
      })),
    },
  };

  if (!dryRun) {
    await mkdir(paths.intakeDir, { recursive: true });
    await writeFile(
      paths.intakeLogPath,
      toCsv(intakeLogRows, [
        "intake_id",
        "intake_dir",
        "source_dir",
        "originals_dir",
        "by_type_dir",
        "scanned_files",
        "unique_files",
        "duplicate_files",
        "originals_copied",
        "working_copies_copied",
        "loose_root_files_seen",
        "loose_root_files_staged",
        "engine_version",
        "notes",
      ]),
    );
    await writeFile(
      paths.fileRegisterPath,
      toCsv(fileRegisterRows, [
        "file_id",
        "intake_id",
        "source_path",
        "original_path",
        "working_copy_path",
        "category",
        "original_name",
        "sha256",
        "size_bytes",
        "duplicate_of",
        "status",
        "engine_version",
        "notes",
      ]),
    );
    await writeFile(paths.matterJsonPath, `${JSON.stringify(matterJson, null, 2)}\n`);
  }

  return {
    dryRun,
    matterRoot,
    paths: Object.fromEntries(
      Object.entries(paths).map(([key, value]) => [key, toPosix(path.relative(matterRoot, value)) || "."]),
    ),
    counts: {
      scannedFiles: fileRegisterRows.length,
      uniqueFiles,
      duplicateFiles,
      originalsCopied,
      workingCopiesCopied,
      looseRootFilesSeen: rootStaging.rows.length,
      looseRootFilesStaged: rootStaging.copied,
    },
    categories: fileRegisterRows.reduce((accumulator, row) => {
      accumulator[row.category] = (accumulator[row.category] || 0) + 1;
      return accumulator;
    }, {}),
    matterJson,
    logs: {
      intakeLogRows,
      rootStagingRows: rootStaging.rows,
      fileRegisterRows,
    },
    outputLines: [
      "> workbench.run /matter-init",
      dryRun && rootStaging.rows.length
        ? `[intake] would stage loose root files: ${rootStaging.rows.length}`
        : rootStaging.rows.length
        ? `[intake] staged loose root files: ${rootStaging.copied} copied, ${rootStaging.alreadyCurrent} already in Inbox`
        : "[intake] staged loose root files: none found",
      `[intake] source: ${toPosix(path.relative(matterRoot, paths.sourceDir))}`,
      `[intake] scanned ${fileRegisterRows.length} files`,
      `[intake] unique files: ${uniqueFiles}`,
      `[intake] exact duplicates: ${duplicateFiles}`,
      `[intake] originals: ${toPosix(path.relative(matterRoot, paths.originalsDir))}`,
      `[intake] by type: ${toPosix(path.relative(matterRoot, paths.byTypeDir))}`,
      `[intake] wrote logs: ${toPosix(path.relative(matterRoot, paths.intakeLogPath))}, ${toPosix(path.relative(matterRoot, paths.fileRegisterPath))}`,
      "[intake] status: complete - deterministic intake ready for lawyer review",
    ],
  };
}

if (process.argv[1] === __filename) {
  const dryRun = !process.argv.includes("--apply");
  runMatterInit({ dryRun })
    .then((result) => {
      console.log(result.outputLines.join("\n"));
      if (dryRun) console.log("[intake] dry run only. Re-run with --apply to write files.");
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}

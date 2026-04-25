import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MATTER_ROOT = process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null;
const LOAD_ID = "LOAD-0001";
const LOAD_DIR_NAME = "Load_0001_Initial";
const ENGINE_VERSION = "phase1-deterministic-v1";

const CATEGORY_BY_EXTENSION = new Map([
  [".pdf", "documents_pdf"],
  [".doc", "documents_word"],
  [".docx", "documents_word"],
  [".xls", "spreadsheets"],
  [".xlsx", "spreadsheets"],
  [".csv", "spreadsheets"],
  [".jpg", "images"],
  [".jpeg", "images"],
  [".png", "images"],
  [".heic", "images"],
  [".eml", "email"],
  [".msg", "email"],
  [".zip", "archives"],
  [".md", "text"],
  [".txt", "text"],
]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

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
  return CATEGORY_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) || "review_required";
}

function isIgnoredPath(relativePath) {
  const parts = relativePath.split(path.sep);
  return parts.some((part) => (
    part === ".DS_Store"
    || part.startsWith(".")
    || part === "raw_source_files"
    || part === "arranged_files"
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

async function readExistingMatterJson(matterRoot) {
  try {
    return JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  } catch {
    return {};
  }
}

function resolvePaths(matterRoot) {
  const loadDir = path.join(matterRoot, "00_Inbox", LOAD_DIR_NAME);
  const evidenceDir = path.join(loadDir, "Evidence Files");
  return {
    matterRoot,
    loadDir,
    sourceDir: evidenceDir,
    rawSourceDir: path.join(loadDir, "raw_source_files"),
    arrangedDir: path.join(loadDir, "arranged_files"),
    loadLogPath: path.join(loadDir, "Inbox_Loads.csv"),
    normalizationLogPath: path.join(loadDir, "Inbox_Normalization_Log.csv"),
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

  await stat(paths.sourceDir);

  const files = await listFiles(paths.sourceDir);
  const seenByHash = new Map();
  const normalizationRows = [];
  let rawCopied = 0;
  let arrangedCopied = 0;

  for (const [index, sourcePath] of files.entries()) {
    const rawFileId = `RAW-${String(index + 1).padStart(4, "0")}`;
    const relativeSource = path.relative(paths.sourceDir, sourcePath);
    const sourceHash = await sha256(sourcePath);
    const fileStat = await stat(sourcePath);
    const duplicateOf = seenByHash.get(sourceHash) || "";
    if (!duplicateOf) seenByHash.set(sourceHash, rawFileId);

    const rawDestination = path.join(paths.rawSourceDir, relativeSource);
    const category = classifyFile(sourcePath);
    const arrangedName = `${rawFileId}__${normalizeName(path.basename(sourcePath))}`;
    const arrangedDestination = path.join(paths.arrangedDir, category, arrangedName);

    const rawCopyStatus = await copyIfNeeded(sourcePath, rawDestination, sourceHash, dryRun);
    const arrangedCopyStatus = await copyIfNeeded(sourcePath, arrangedDestination, sourceHash, dryRun);
    if (rawCopyStatus === "copied") rawCopied += 1;
    if (arrangedCopyStatus === "copied") arrangedCopied += 1;

    normalizationRows.push({
      raw_file_id: rawFileId,
      load_id: LOAD_ID,
      source_path: toPosix(path.relative(matterRoot, sourcePath)),
      preserved_path: toPosix(path.relative(matterRoot, rawDestination)),
      arranged_path: toPosix(path.relative(matterRoot, arrangedDestination)),
      category,
      original_name: path.basename(sourcePath),
      source_sha256: sourceHash,
      size_bytes: fileStat.size,
      duplicate_of_raw_file_id: duplicateOf,
      status: duplicateOf ? "exact-duplicate" : "unique",
      engine_version: ENGINE_VERSION,
      notes: duplicateOf ? `Exact duplicate of ${duplicateOf}.` : "First-seen raw file for this checksum.",
    });
  }

  const uniqueFiles = normalizationRows.filter((row) => row.status === "unique").length;
  const duplicateFiles = normalizationRows.length - uniqueFiles;
  const loadRows = [{
    load_id: LOAD_ID,
    load_dir: toPosix(path.relative(matterRoot, paths.loadDir)),
    source_dir: toPosix(path.relative(matterRoot, paths.sourceDir)),
    raw_source_dir: toPosix(path.relative(matterRoot, paths.rawSourceDir)),
    arranged_dir: toPosix(path.relative(matterRoot, paths.arrangedDir)),
    scanned_files: normalizationRows.length,
    unique_files: uniqueFiles,
    duplicate_files: duplicateFiles,
    raw_files_copied: rawCopied,
    arranged_files_copied: arrangedCopied,
    engine_version: ENGINE_VERSION,
    notes: "Deterministic copy-only intake. Source files are not moved or modified.",
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
      load_id: LOAD_ID,
      engine_version: ENGINE_VERSION,
      source_dir: toPosix(path.relative(matterRoot, paths.sourceDir)),
      raw_source_dir: toPosix(path.relative(matterRoot, paths.rawSourceDir)),
      arranged_dir: toPosix(path.relative(matterRoot, paths.arrangedDir)),
      load_log: toPosix(path.relative(matterRoot, paths.loadLogPath)),
      normalization_log: toPosix(path.relative(matterRoot, paths.normalizationLogPath)),
      scanned_files: normalizationRows.length,
      unique_files: uniqueFiles,
      duplicate_files: duplicateFiles,
    },
  };

  if (!dryRun) {
    await mkdir(paths.loadDir, { recursive: true });
    await writeFile(
      paths.loadLogPath,
      toCsv(loadRows, [
        "load_id",
        "load_dir",
        "source_dir",
        "raw_source_dir",
        "arranged_dir",
        "scanned_files",
        "unique_files",
        "duplicate_files",
        "raw_files_copied",
        "arranged_files_copied",
        "engine_version",
        "notes",
      ]),
    );
    await writeFile(
      paths.normalizationLogPath,
      toCsv(normalizationRows, [
        "raw_file_id",
        "load_id",
        "source_path",
        "preserved_path",
        "arranged_path",
        "category",
        "original_name",
        "source_sha256",
        "size_bytes",
        "duplicate_of_raw_file_id",
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
      scannedFiles: normalizationRows.length,
      uniqueFiles,
      duplicateFiles,
      rawFilesCopied: rawCopied,
      arrangedFilesCopied: arrangedCopied,
    },
    categories: normalizationRows.reduce((accumulator, row) => {
      accumulator[row.category] = (accumulator[row.category] || 0) + 1;
      return accumulator;
    }, {}),
    matterJson,
    logs: {
      loadRows,
      normalizationRows,
    },
    outputLines: [
      "> workbench.run /matter-init",
      `[phase-1] source: ${toPosix(path.relative(matterRoot, paths.sourceDir))}`,
      `[phase-1] scanned ${normalizationRows.length} files`,
      `[phase-1] unique files: ${uniqueFiles}`,
      `[phase-1] exact duplicates: ${duplicateFiles}`,
      `[phase-1] preserved originals: ${toPosix(path.relative(matterRoot, paths.rawSourceDir))}`,
      `[phase-1] arranged working copies: ${toPosix(path.relative(matterRoot, paths.arrangedDir))}`,
      `[phase-1] wrote logs: ${toPosix(path.relative(matterRoot, paths.loadLogPath))}, ${toPosix(path.relative(matterRoot, paths.normalizationLogPath))}`,
      "[phase-1] status: complete - deterministic intake ready for lawyer review",
    ],
  };
}

if (process.argv[1] === __filename) {
  const dryRun = !process.argv.includes("--apply");
  runMatterInit({ dryRun })
    .then((result) => {
      console.log(result.outputLines.join("\n"));
      if (dryRun) console.log("[phase-1] dry run only. Re-run with --apply to write files.");
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}

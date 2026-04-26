import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { csvEscape, parseCsvRow } from "../shared/csv.mjs";

const LEGACY_CATEGORY_RENAMES = new Map([
  ["documents_pdf", "PDFs"],
  ["documents_word", "Word Documents"],
  ["spreadsheets", "Spreadsheets"],
  ["images", "Images"],
  ["email", "Emails"],
  ["archives", "Archives"],
  ["text", "Text Notes"],
  ["review_required", "Needs Review"],
]);

const LEGACY_CSV_COLUMN_RENAMES = new Map([
  ["raw_file_id", "file_id"],
  ["load_id", "intake_id"],
  ["preserved_path", "original_path"],
  ["arranged_path", "working_copy_path"],
  ["source_sha256", "sha256"],
  ["duplicate_of_raw_file_id", "duplicate_of"],
  ["load_dir", "intake_dir"],
  ["raw_source_dir", "originals_dir"],
  ["arranged_dir", "by_type_dir"],
  ["raw_files_copied", "originals_copied"],
  ["arranged_files_copied", "working_copies_copied"],
  ["duplicate_files", "duplicates_in_batch"],
]);

export async function detectLegacyLayout(matterRoot) {
  const evidence = {
    legacyLoadDir: null,
    hasLegacyEvidenceFiles: false,
    hasLegacyRawSourceFiles: false,
    hasLegacyArrangedFiles: false,
    legacyCategoryDirs: [],
    hasLegacyLoadCsv: false,
    hasLegacyNormalizationCsv: false,
    legacyCsvColumns: [],
    hasLegacyMatterJsonKey: false,
  };

  const inboxDir = path.join(matterRoot, "00_Inbox");
  let inboxEntries = [];
  try {
    inboxEntries = await readdir(inboxDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const legacyLoadEntry = inboxEntries.find((entry) => entry.isDirectory() && /^Load_\d+_/.test(entry.name));
  if (legacyLoadEntry) evidence.legacyLoadDir = legacyLoadEntry.name;

  const intakeDirCandidates = legacyLoadEntry
    ? [legacyLoadEntry.name]
    : inboxEntries.filter((entry) => entry.isDirectory() && /^Intake \d+/.test(entry.name)).map((entry) => entry.name);

  for (const dirName of intakeDirCandidates) {
    const fullPath = path.join(inboxDir, dirName);
    let entries;
    try {
      entries = await readdir(fullPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "Evidence Files") evidence.hasLegacyEvidenceFiles = true;
        if (entry.name === "raw_source_files") evidence.hasLegacyRawSourceFiles = true;
        if (entry.name === "arranged_files") evidence.hasLegacyArrangedFiles = true;
      } else if (entry.isFile()) {
        if (entry.name === "Inbox_Loads.csv") evidence.hasLegacyLoadCsv = true;
        if (entry.name === "Inbox_Normalization_Log.csv") evidence.hasLegacyNormalizationCsv = true;
      }
    }
    if (evidence.hasLegacyArrangedFiles) {
      try {
        const arrangedEntries = await readdir(path.join(fullPath, "arranged_files"), { withFileTypes: true });
        for (const entry of arrangedEntries) {
          if (
            entry.isDirectory()
            && LEGACY_CATEGORY_RENAMES.has(entry.name)
            && !evidence.legacyCategoryDirs.includes(entry.name)
          ) {
            evidence.legacyCategoryDirs.push(entry.name);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  for (const csvName of ["Inbox_Loads.csv", "Inbox_Normalization_Log.csv", "Intake Log.csv", "File Register.csv"]) {
    for (const dirName of intakeDirCandidates) {
      const csvPath = path.join(inboxDir, dirName, csvName);
      try {
        const text = await readFile(csvPath, "utf8");
        const firstLine = text.split(/\r?\n/)[0] || "";
        const headers = parseCsvRow(firstLine);
        for (const header of headers) {
          if (LEGACY_CSV_COLUMN_RENAMES.has(header) && !evidence.legacyCsvColumns.includes(header)) {
            evidence.legacyCsvColumns.push(header);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  try {
    const matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
    if (matterJson.phase_1_intake && !Array.isArray(matterJson.intakes)) {
      evidence.hasLegacyMatterJsonKey = true;
    }
  } catch {
    // ignore
  }

  const anyLegacy = evidence.legacyLoadDir
    || evidence.hasLegacyEvidenceFiles
    || evidence.hasLegacyRawSourceFiles
    || evidence.hasLegacyArrangedFiles
    || evidence.legacyCategoryDirs.length
    || evidence.hasLegacyLoadCsv
    || evidence.hasLegacyNormalizationCsv
    || evidence.legacyCsvColumns.length
    || evidence.hasLegacyMatterJsonKey;

  if (!anyLegacy) return null;
  return {
    id: "legacy-layout",
    severity: "warning",
    title: "Legacy folder/CSV/matter.json layout",
    description: buildLegacyDescription(evidence),
    autoFixable: true,
    fixDescription: "Rename folders and CSVs to current names, rewrite CSV column headers and path values, migrate matter.json from phase_1_intake to intakes array.",
    evidence,
  };
}

function buildLegacyDescription(evidence) {
  const lines = [];
  if (evidence.legacyLoadDir) lines.push(`Folder "${evidence.legacyLoadDir}" to "Intake 01 - Initial".`);
  if (evidence.hasLegacyEvidenceFiles) lines.push(`Subfolder "Evidence Files" to "Source Files".`);
  if (evidence.hasLegacyRawSourceFiles) lines.push(`Subfolder "raw_source_files" to "Originals".`);
  if (evidence.hasLegacyArrangedFiles) lines.push(`Subfolder "arranged_files" to "By Type".`);
  if (evidence.legacyCategoryDirs.length) {
    const renames = evidence.legacyCategoryDirs.map((name) => `"${name}" to "${LEGACY_CATEGORY_RENAMES.get(name)}"`).join(", ");
    lines.push(`Category folders: ${renames}.`);
  }
  if (evidence.hasLegacyLoadCsv) lines.push(`"Inbox_Loads.csv" to "Intake Log.csv".`);
  if (evidence.hasLegacyNormalizationCsv) lines.push(`"Inbox_Normalization_Log.csv" to "File Register.csv".`);
  if (evidence.legacyCsvColumns.length) {
    lines.push(`CSV column headers: ${evidence.legacyCsvColumns.map((name) => `"${name}" to "${LEGACY_CSV_COLUMN_RENAMES.get(name)}"`).join(", ")}.`);
  }
  if (evidence.hasLegacyMatterJsonKey) lines.push("matter.json: phase_1_intake to intakes[0].");
  return lines.join(" ");
}

function rewriteCsvText(originalText, dirRenameMap) {
  const lines = originalText.split(/\r?\n/);
  const trailingNewline = originalText.endsWith("\n");
  if (!lines.length) return originalText;
  const headerCells = parseCsvRow(lines[0]);
  const newHeaderCells = headerCells.map((header) => LEGACY_CSV_COLUMN_RENAMES.get(header) || header);

  const outputRows = [newHeaderCells.map(csvEscape).join(",")];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = parseCsvRow(line);
    const remapped = cells.map((cell) => {
      let value = cell;
      for (const [oldDir, newDir] of dirRenameMap.entries()) {
        if (value.includes(oldDir)) value = value.split(oldDir).join(newDir);
      }
      return value;
    });
    outputRows.push(remapped.map(csvEscape).join(","));
  }
  return outputRows.join("\n") + (trailingNewline ? "\n" : "");
}

export async function fixLegacyLayout(matterRoot, evidence) {
  const log = [];
  const inboxDir = path.join(matterRoot, "00_Inbox");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(matterRoot, ".doctor-backups", stamp);
  await mkdir(backupRoot, { recursive: true });

  const matterJsonPath = path.join(matterRoot, "matter.json");
  let originalMatterJson = null;
  try {
    originalMatterJson = await readFile(matterJsonPath, "utf8");
    await writeFile(path.join(backupRoot, "matter.json"), originalMatterJson);
    log.push("Backed up matter.json");
  } catch {
    // no matter.json yet
  }

  const dirRenameMap = new Map();
  if (evidence.legacyLoadDir) {
    dirRenameMap.set(`00_Inbox/${evidence.legacyLoadDir}`, "00_Inbox/Intake 01 - Initial");
  }
  if (evidence.hasLegacyEvidenceFiles) dirRenameMap.set("Evidence Files", "Source Files");
  if (evidence.hasLegacyRawSourceFiles) dirRenameMap.set("raw_source_files", "Originals");
  if (evidence.hasLegacyArrangedFiles) dirRenameMap.set("arranged_files", "By Type");
  for (const oldName of evidence.legacyCategoryDirs) {
    dirRenameMap.set(oldName, LEGACY_CATEGORY_RENAMES.get(oldName));
  }

  const csvFilenameRenames = new Map();
  if (evidence.hasLegacyLoadCsv) csvFilenameRenames.set("Inbox_Loads.csv", "Intake Log.csv");
  if (evidence.hasLegacyNormalizationCsv) csvFilenameRenames.set("Inbox_Normalization_Log.csv", "File Register.csv");

  const intakeDirCandidates = [];
  try {
    const entries = await readdir(inboxDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && (/^Load_\d+_/.test(entry.name) || /^Intake \d+/.test(entry.name))) {
        intakeDirCandidates.push(entry.name);
      }
    }
  } catch {
    // ignore
  }

  const csvBackupBuffers = new Map();
  for (const dirName of intakeDirCandidates) {
    for (const csvName of ["Inbox_Loads.csv", "Inbox_Normalization_Log.csv", "Intake Log.csv", "File Register.csv"]) {
      const fullPath = path.join(inboxDir, dirName, csvName);
      try {
        const text = await readFile(fullPath, "utf8");
        csvBackupBuffers.set(fullPath, text);
        const safeName = `${dirName}__${csvName}`.replace(/[\/\\]/g, "_");
        await writeFile(path.join(backupRoot, safeName), text);
        log.push(`Backed up ${dirName}/${csvName}`);
      } catch {
        // ignore
      }
    }
  }

  const renameIfExists = async (oldAbs, newAbs) => {
    try {
      await stat(oldAbs);
    } catch {
      return false;
    }
    await mkdir(path.dirname(newAbs), { recursive: true });
    const { rename } = await import("node:fs/promises");
    await rename(oldAbs, newAbs);
    return true;
  };

  if (evidence.legacyLoadDir) {
    const oldPath = path.join(inboxDir, evidence.legacyLoadDir);
    const newPath = path.join(inboxDir, "Intake 01 - Initial");
    if (await renameIfExists(oldPath, newPath)) {
      log.push(`Renamed 00_Inbox/${evidence.legacyLoadDir} to 00_Inbox/Intake 01 - Initial`);
    }
  }

  const intakeDirNamesNow = [];
  try {
    const entries = await readdir(inboxDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && /^Intake \d+/.test(entry.name)) intakeDirNamesNow.push(entry.name);
    }
  } catch {
    // ignore
  }

  for (const intakeName of intakeDirNamesNow) {
    const intakeDir = path.join(inboxDir, intakeName);
    if (evidence.hasLegacyEvidenceFiles) {
      if (await renameIfExists(path.join(intakeDir, "Evidence Files"), path.join(intakeDir, "Source Files"))) {
        log.push(`Renamed ${intakeName}/Evidence Files to Source Files`);
      }
    }
    if (evidence.hasLegacyRawSourceFiles) {
      if (await renameIfExists(path.join(intakeDir, "raw_source_files"), path.join(intakeDir, "Originals"))) {
        log.push(`Renamed ${intakeName}/raw_source_files to Originals`);
      }
    }
    const arrangedDirNow = path.join(intakeDir, "By Type");
    if (evidence.hasLegacyArrangedFiles) {
      if (await renameIfExists(path.join(intakeDir, "arranged_files"), arrangedDirNow)) {
        log.push(`Renamed ${intakeName}/arranged_files to By Type`);
      }
    }
    try {
      const arrangedEntries = await readdir(arrangedDirNow, { withFileTypes: true });
      for (const entry of arrangedEntries) {
        if (entry.isDirectory() && LEGACY_CATEGORY_RENAMES.has(entry.name)) {
          const newName = LEGACY_CATEGORY_RENAMES.get(entry.name);
          if (await renameIfExists(path.join(arrangedDirNow, entry.name), path.join(arrangedDirNow, newName))) {
            log.push(`Renamed ${intakeName}/By Type/${entry.name} to ${newName}`);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  for (const intakeName of intakeDirNamesNow) {
    const intakeDir = path.join(inboxDir, intakeName);
    for (const [oldName, newName] of csvFilenameRenames.entries()) {
      if (await renameIfExists(path.join(intakeDir, oldName), path.join(intakeDir, newName))) {
        log.push(`Renamed ${intakeName}/${oldName} to ${newName}`);
      }
    }
  }

  const newCsvLocations = new Map();
  for (const [oldFullPath, originalText] of csvBackupBuffers.entries()) {
    const oldFilename = path.basename(oldFullPath);
    const newFilename = csvFilenameRenames.get(oldFilename) || oldFilename;
    const dir = path.dirname(oldFullPath);
    const dirName = path.basename(dir);
    const newDirName = (dirName === evidence.legacyLoadDir) ? "Intake 01 - Initial" : dirName;
    newCsvLocations.set(path.join(path.dirname(dir), newDirName, newFilename), originalText);
  }

  for (const [csvPath, originalText] of newCsvLocations.entries()) {
    await writeFile(csvPath, rewriteCsvText(originalText, dirRenameMap));
    log.push(`Rewrote ${path.relative(matterRoot, csvPath)}`);
  }

  if (evidence.hasLegacyMatterJsonKey && originalMatterJson) {
    let parsed;
    try {
      parsed = JSON.parse(originalMatterJson);
    } catch {
      parsed = null;
    }
    if (parsed && parsed.phase_1_intake) {
      const oldEntry = parsed.phase_1_intake;
      const remapPath = (value) => {
        if (typeof value !== "string") return value;
        let v = value;
        for (const [oldDir, newDir] of dirRenameMap.entries()) {
          if (v.includes(oldDir)) v = v.split(oldDir).join(newDir);
        }
        for (const [oldName, newName] of csvFilenameRenames.entries()) {
          if (v.endsWith(`/${oldName}`)) v = v.replace(new RegExp(`/${oldName}$`), `/${newName}`);
        }
        return v;
      };
      const migrated = {
        intake_id: oldEntry.intake_id || oldEntry.load_id || "INTAKE-01",
        engine_version: oldEntry.engine_version,
        intake_dir: remapPath(oldEntry.intake_dir || oldEntry.load_dir || "00_Inbox/Intake 01 - Initial"),
        received_date: oldEntry.received_date || "",
        label: oldEntry.label || "Initial",
        source_dir: remapPath(oldEntry.source_dir),
        originals_dir: remapPath(oldEntry.originals_dir || oldEntry.raw_source_dir),
        by_type_dir: remapPath(oldEntry.by_type_dir || oldEntry.arranged_dir),
        intake_log: remapPath(oldEntry.intake_log || oldEntry.load_log),
        file_register: remapPath(oldEntry.file_register || oldEntry.normalization_log),
        scanned_files: oldEntry.scanned_files,
        unique_files: oldEntry.unique_files,
        duplicates_in_batch: oldEntry.duplicates_in_batch ?? oldEntry.duplicate_files ?? 0,
        duplicates_of_prior: oldEntry.duplicates_of_prior ?? 0,
        loose_root_files_seen: oldEntry.loose_root_files_seen,
        loose_root_files_staged: oldEntry.loose_root_files_staged,
        loose_root_source_files: oldEntry.loose_root_source_files,
      };
      const next = {
        ...parsed,
        intakes: [migrated, ...(Array.isArray(parsed.intakes) ? parsed.intakes : [])],
      };
      delete next.phase_1_intake;
      await writeFile(matterJsonPath, `${JSON.stringify(next, null, 2)}\n`);
      log.push("Migrated matter.json: phase_1_intake to intakes[0]");
    }
  }

  return { ok: true, log, backupDir: path.relative(matterRoot, backupRoot) };
}

export async function runDoctorScan(matterRoot) {
  const issues = [];
  const legacy = await detectLegacyLayout(matterRoot);
  if (legacy) issues.push(legacy);
  return { issues };
}

export async function runDoctorFix(matterRoot, fixIds) {
  const applied = [];
  const failed = [];
  if (fixIds.includes("legacy-layout")) {
    const detected = await detectLegacyLayout(matterRoot);
    if (detected) {
      try {
        const result = await fixLegacyLayout(matterRoot, detected.evidence);
        applied.push({ id: "legacy-layout", ...result });
      } catch (error) {
        failed.push({ id: "legacy-layout", error: error.message });
      }
    }
  }
  const remaining = (await runDoctorScan(matterRoot)).issues;
  return { applied, failed, remaining };
}

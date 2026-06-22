import { Buffer } from "node:buffer";
import path from "node:path";

import {
  LEGACY_CATEGORY_RENAMES,
  rewriteLegacyCsvText,
} from "./doctor-legacy-layout.mjs";
import { detectRuntimeDbLegacyLayout, runRuntimeDbDoctorScan } from "./runtime-db-doctor-scan.mjs";
import { normalizeRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";
import { runtimeWorkspaceFilePaths } from "./runtime-db-workspace-read-model.mjs";

const DOCTOR_CSV_NAMES = new Set([
  "Inbox_Loads.csv",
  "Inbox_Normalization_Log.csv",
  "Intake Log.csv",
  "File Register.csv",
]);

export function runRuntimeDbDoctorFix({
  matter = {},
  workspace = {},
  readPayloadRow,
  fixIds = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!matter?.name) throw new Error("runtime DB matter is required");
  if (typeof readPayloadRow !== "function") throw new Error("runtime DB payload reader is required");
  const requestedFixIds = Array.isArray(fixIds) ? fixIds.filter((id) => typeof id === "string") : [];
  const payloadCache = new Map();
  const readCachedPayload = (relativePath) => {
    const normalizedPath = normalizeRuntimeObjectKey(relativePath);
    if (!payloadCache.has(normalizedPath)) {
      const payload = readPayloadRow({ matter, relativePath: normalizedPath });
      payloadCache.set(normalizedPath, {
        ...payload,
        bytes: Buffer.from(payload.bytes),
      });
    }
    return payloadCache.get(normalizedPath);
  };

  const scan = runRuntimeDbDoctorScan({
    matter,
    workspace,
    readPayloadRow: ({ relativePath }) => readCachedPayload(relativePath),
  });
  const applied = [];
  const failed = [];
  let files = [];
  let deleted = [];
  let remaining = scan.issues;

  if (requestedFixIds.includes("legacy-layout")) {
    const detected = scan.issues.find((issue) => issue.id === "legacy-layout");
    if (detected) {
      try {
        const result = buildRuntimeDbLegacyLayoutFix({
          workspace,
          evidence: detected.evidence || {},
          readPayload: readCachedPayload,
          generatedAt,
        });
        applied.push({ id: "legacy-layout", ...result.applied });
        files = files.concat(result.files);
        deleted = deleted.concat(result.deleted);
        remaining = result.remaining;
      } catch (error) {
        failed.push({ id: "legacy-layout", error: error.message || String(error) });
      }
    }
  }

  return {
    operationResult: { applied, failed, remaining },
    files,
    deleted,
  };
}

export function buildRuntimeDbLegacyLayoutFix({
  workspace = {},
  evidence = {},
  readPayload,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (typeof readPayload !== "function") throw new Error("runtime DB payload reader is required");
  const fileItems = runtimeWorkspaceFilePaths(workspace.tree || workspace.root || {})
    .map((item) => ({ ...item, relativePath: normalizeRuntimeObjectKey(item.path) }))
    .filter((item) => item.relativePath);
  const existingPaths = new Set(fileItems.map((item) => item.relativePath));
  const { dirRenameMap, csvFilenameRenames } = legacyRenameMaps(evidence);
  const backupDir = `.doctor-backups/${doctorStamp(generatedAt)}`;
  const filesByPath = new Map();
  const deletedByPath = new Map();
  const log = [];

  const addFile = (relativePath, bytes) => {
    const normalizedPath = normalizeRuntimeObjectKey(relativePath);
    filesByPath.set(normalizedPath, {
      relativePath: normalizedPath,
      bytes: Buffer.from(bytes),
    });
  };
  const deletePath = (relativePath) => {
    const normalizedPath = normalizeRuntimeObjectKey(relativePath);
    deletedByPath.set(normalizedPath, { relativePath: normalizedPath });
  };

  if (existingPaths.has("matter.json")) {
    const originalMatterJson = readPayload("matter.json").bytes;
    addFile(`${backupDir}/matter.json`, originalMatterJson);
    log.push("Backed up matter.json");
  }

  for (const relativePath of fileItems.map((item) => item.relativePath)) {
    if (!isLegacyIntakeCsvPath(relativePath)) continue;
    const originalText = readPayload(relativePath).bytes;
    const safeName = legacyCsvBackupName(relativePath);
    addFile(`${backupDir}/${safeName}`, originalText);
    log.push(`Backed up ${legacyCsvLogName(relativePath)}`);
  }

  validateRenameTargets(fileItems, evidence, csvFilenameRenames);
  appendRenameLog(log, evidence, fileItems);

  for (const item of fileItems) {
    const oldPath = item.relativePath;
    const newPath = remapLegacyRelativePath(oldPath, evidence, csvFilenameRenames);
    let nextBytes = null;
    let changed = newPath !== oldPath;

    if (isLegacyIntakeCsvPath(oldPath)) {
      const originalText = readPayload(oldPath).bytes.toString("utf8");
      const rewritten = rewriteLegacyCsvText(originalText, dirRenameMap);
      nextBytes = Buffer.from(rewritten, "utf8");
      changed = true;
    }

    if (oldPath === "matter.json" && evidence.hasLegacyMatterJsonKey) {
      const migrated = migrateLegacyMatterJsonText(
        readPayload(oldPath).bytes.toString("utf8"),
        dirRenameMap,
        csvFilenameRenames,
      );
      if (migrated) {
        nextBytes = Buffer.from(migrated, "utf8");
        changed = true;
      }
    }

    if (!changed) continue;
    addFile(newPath, nextBytes || readPayload(oldPath).bytes);
    if (newPath !== oldPath) deletePath(oldPath);
    if (isLegacyIntakeCsvPath(oldPath)) log.push(`Rewrote ${newPath}`);
  }

  const finalPayloads = buildVirtualPayloads({
    fileItems,
    filesByPath,
    evidence,
    csvFilenameRenames,
    readPayload,
  });
  const remaining = detectRuntimeDbLegacyLayout({
    paths: [...finalPayloads.keys()].map((relativePath) => ({ path: relativePath })),
    readText: (relativePath) => {
      const payload = finalPayloads.get(normalizeRuntimeObjectKey(relativePath));
      return payload ? payload.toString("utf8") : null;
    },
  });

  return {
    applied: { ok: true, log, backupDir },
    files: [...filesByPath.values()],
    deleted: [...deletedByPath.values()],
    remaining: remaining ? [remaining] : [],
  };
}

function legacyRenameMaps(evidence = {}) {
  const dirRenameMap = new Map();
  if (evidence.legacyLoadDir) {
    dirRenameMap.set(`00_Inbox/${evidence.legacyLoadDir}`, "00_Inbox/Intake 01 - Initial");
  }
  if (evidence.hasLegacyEvidenceFiles) dirRenameMap.set("Evidence Files", "Source Files");
  if (evidence.hasLegacyRawSourceFiles) dirRenameMap.set("raw_source_files", "Originals");
  if (evidence.hasLegacyArrangedFiles) dirRenameMap.set("arranged_files", "By Type");
  for (const oldName of evidence.legacyCategoryDirs || []) {
    dirRenameMap.set(oldName, LEGACY_CATEGORY_RENAMES.get(oldName));
  }

  const csvFilenameRenames = new Map();
  if (evidence.hasLegacyLoadCsv) csvFilenameRenames.set("Inbox_Loads.csv", "Intake Log.csv");
  if (evidence.hasLegacyNormalizationCsv) csvFilenameRenames.set("Inbox_Normalization_Log.csv", "File Register.csv");
  return { dirRenameMap, csvFilenameRenames };
}

function remapLegacyRelativePath(relativePath, evidence = {}, csvFilenameRenames = new Map()) {
  const normalizedPath = normalizeRuntimeObjectKey(relativePath);
  const segments = normalizedPath.split("/");
  if (evidence.legacyLoadDir && segments[0] === "00_Inbox" && segments[1] === evidence.legacyLoadDir) {
    segments[1] = "Intake 01 - Initial";
  }
  const intakeIndex = segments[0] === "00_Inbox" && /^Intake \d+/.test(segments[1] || "") ? 1 : -1;
  if (intakeIndex >= 0) {
    const laneIndex = intakeIndex + 1;
    if (evidence.hasLegacyEvidenceFiles && segments[laneIndex] === "Evidence Files") segments[laneIndex] = "Source Files";
    if (evidence.hasLegacyRawSourceFiles && segments[laneIndex] === "raw_source_files") segments[laneIndex] = "Originals";
    if (evidence.hasLegacyArrangedFiles && segments[laneIndex] === "arranged_files") segments[laneIndex] = "By Type";
    if (segments[laneIndex] === "By Type") {
      const categoryIndex = laneIndex + 1;
      if (LEGACY_CATEGORY_RENAMES.has(segments[categoryIndex])) {
        segments[categoryIndex] = LEGACY_CATEGORY_RENAMES.get(segments[categoryIndex]);
      }
    }
  }
  const basename = segments.at(-1) || "";
  if (csvFilenameRenames.has(basename)) segments[segments.length - 1] = csvFilenameRenames.get(basename);
  return normalizeRuntimeObjectKey(segments.join("/"));
}

function migrateLegacyMatterJsonText(originalText, dirRenameMap, csvFilenameRenames) {
  let parsed;
  try {
    parsed = JSON.parse(originalText);
  } catch {
    return null;
  }
  if (!parsed?.phase_1_intake) return null;
  const oldEntry = parsed.phase_1_intake;
  const remapPath = (value) => {
    if (typeof value !== "string") return value;
    let v = value;
    for (const [oldDir, newDir] of dirRenameMap.entries()) {
      if (v.includes(oldDir)) v = v.split(oldDir).join(newDir);
    }
    for (const [oldName, newName] of csvFilenameRenames.entries()) {
      if (v.endsWith(`/${oldName}`)) v = v.replace(new RegExp(`/${escapeRegExp(oldName)}$`), `/${newName}`);
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
  return `${JSON.stringify(next, null, 2)}\n`;
}

function buildVirtualPayloads({ fileItems, filesByPath, evidence, csvFilenameRenames, readPayload }) {
  const finalPayloads = new Map();
  for (const item of fileItems) {
    const oldPath = item.relativePath;
    const newPath = remapLegacyRelativePath(oldPath, evidence, csvFilenameRenames);
    if (filesByPath.has(newPath)) {
      finalPayloads.set(newPath, filesByPath.get(newPath).bytes);
    } else if (isDoctorTextCandidate(newPath)) {
      finalPayloads.set(newPath, readPayload(oldPath).bytes);
    } else {
      finalPayloads.set(newPath, null);
    }
  }
  for (const file of filesByPath.values()) {
    if (!finalPayloads.has(file.relativePath)) finalPayloads.set(file.relativePath, file.bytes);
  }
  return finalPayloads;
}

function validateRenameTargets(fileItems, evidence, csvFilenameRenames) {
  const targets = new Map();
  for (const item of fileItems) {
    const oldPath = item.relativePath;
    const newPath = remapLegacyRelativePath(oldPath, evidence, csvFilenameRenames);
    const previous = targets.get(newPath);
    if (previous && previous !== oldPath) {
      throw new Error(`Doctor fix would merge ${previous} and ${oldPath} into ${newPath}`);
    }
    targets.set(newPath, oldPath);
  }
}

function appendRenameLog(log, evidence = {}, fileItems = []) {
  if (evidence.legacyLoadDir) {
    log.push(`Renamed 00_Inbox/${evidence.legacyLoadDir} to 00_Inbox/Intake 01 - Initial`);
  }
  const intakeNames = new Set(fileItems
    .map((item) => remapLegacyRelativePath(item.relativePath, evidence, new Map()).split("/")[1] || "")
    .filter((name) => /^Intake \d+/.test(name)));
  for (const intakeName of intakeNames) {
    if (evidence.hasLegacyEvidenceFiles) log.push(`Renamed ${intakeName}/Evidence Files to Source Files`);
    if (evidence.hasLegacyRawSourceFiles) log.push(`Renamed ${intakeName}/raw_source_files to Originals`);
    if (evidence.hasLegacyArrangedFiles) log.push(`Renamed ${intakeName}/arranged_files to By Type`);
    for (const oldName of evidence.legacyCategoryDirs || []) {
      if (LEGACY_CATEGORY_RENAMES.has(oldName)) {
        log.push(`Renamed ${intakeName}/By Type/${oldName} to ${LEGACY_CATEGORY_RENAMES.get(oldName)}`);
      }
    }
    if (evidence.hasLegacyLoadCsv) log.push(`Renamed ${intakeName}/Inbox_Loads.csv to Intake Log.csv`);
    if (evidence.hasLegacyNormalizationCsv) log.push(`Renamed ${intakeName}/Inbox_Normalization_Log.csv to File Register.csv`);
  }
}

function isLegacyIntakeCsvPath(relativePath) {
  const normalizedPath = normalizeRuntimeObjectKey(relativePath);
  const segments = normalizedPath.split("/");
  return segments[0] === "00_Inbox"
    && (/^Load_\d+_/.test(segments[1] || "") || /^Intake \d+/.test(segments[1] || ""))
    && segments.length === 3
    && DOCTOR_CSV_NAMES.has(segments[2]);
}

function isDoctorTextCandidate(relativePath) {
  return normalizeRuntimeObjectKey(relativePath) === "matter.json" || isLegacyIntakeCsvPath(relativePath);
}

function legacyCsvBackupName(relativePath) {
  const segments = normalizeRuntimeObjectKey(relativePath).split("/");
  return `${segments[1] || "Intake"}__${segments[2] || path.posix.basename(relativePath)}`.replace(/[\/\\]/g, "_");
}

function legacyCsvLogName(relativePath) {
  const segments = normalizeRuntimeObjectKey(relativePath).split("/");
  return `${segments[1] || "Intake"}/${segments[2] || path.posix.basename(relativePath)}`;
}

function doctorStamp(generatedAt) {
  const raw = String(generatedAt || new Date().toISOString()).trim() || new Date().toISOString();
  return raw.replace(/[:.]/g, "-").replace(/[^A-Za-z0-9_-]/g, "-");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

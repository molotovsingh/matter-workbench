import path from "node:path";

import { parseCsvRow } from "../shared/csv.mjs";
import {
  buildLegacyDescription,
  LEGACY_CATEGORY_RENAMES,
  LEGACY_CSV_COLUMN_RENAMES,
} from "./doctor-legacy-layout.mjs";
import { readRuntimeDbPayloadText } from "./runtime-db-payload-read-model.mjs";
import { runtimeWorkspaceFilePaths } from "./runtime-db-workspace-read-model.mjs";

export function runRuntimeDbDoctorScan({
  matter = {},
  workspace = {},
  readPayloadRow,
} = {}) {
  if (!matter?.name) throw new Error("runtime DB matter is required");
  if (typeof readPayloadRow !== "function") throw new Error("runtime DB payload reader is required");
  const paths = runtimeWorkspaceFilePaths(workspace.tree || workspace.root || {});
  const warnings = [];
  const readText = (relativePath) => readRuntimeDbPayloadText({ matter, relativePath, readPayloadRow, warnings });
  const legacy = detectRuntimeDbLegacyLayout({ paths, readText });
  return {
    issues: legacy ? [legacy] : [],
    warnings,
  };
}

export function detectRuntimeDbLegacyLayout({ paths = [], readText = () => null } = {}) {
  const filePaths = paths.map((item) => item.path).filter(Boolean);
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

  for (const relativePath of filePaths) {
    const loadMatch = relativePath.match(/^00_Inbox\/(Load_\d+_[^/]+)(?:\/|$)/);
    if (loadMatch && !evidence.legacyLoadDir) evidence.legacyLoadDir = loadMatch[1];
    if (/(^|\/)Evidence Files(\/|$)/.test(relativePath)) evidence.hasLegacyEvidenceFiles = true;
    if (/(^|\/)raw_source_files(\/|$)/.test(relativePath)) evidence.hasLegacyRawSourceFiles = true;
    if (/(^|\/)arranged_files(\/|$)/.test(relativePath)) evidence.hasLegacyArrangedFiles = true;
    const arrangedCategory = relativePath.match(/\/(?:arranged_files|By Type)\/([^/]+)(?:\/|$)/);
    if (arrangedCategory && LEGACY_CATEGORY_RENAMES.has(arrangedCategory[1])) {
      pushUnique(evidence.legacyCategoryDirs, arrangedCategory[1]);
    }
    const basename = path.posix.basename(relativePath);
    if (basename === "Inbox_Loads.csv") evidence.hasLegacyLoadCsv = true;
    if (basename === "Inbox_Normalization_Log.csv") evidence.hasLegacyNormalizationCsv = true;
  }

  for (const relativePath of filePaths.filter(isDoctorCsvCandidatePath)) {
    const body = readText(relativePath);
    if (!body) continue;
    const firstLine = String(body).split(/\r?\n/)[0] || "";
    let headers = [];
    try {
      headers = parseCsvRow(firstLine);
    } catch {
      continue;
    }
    for (const header of headers) {
      if (LEGACY_CSV_COLUMN_RENAMES.has(header)) pushUnique(evidence.legacyCsvColumns, header);
    }
  }

  const matterJsonText = readText("matter.json");
  if (matterJsonText) {
    try {
      const matterJson = JSON.parse(matterJsonText);
      evidence.hasLegacyMatterJsonKey = Boolean(matterJson.phase_1_intake && !Array.isArray(matterJson.intakes));
    } catch {
      // Invalid matter.json is not a legacy-layout signal.
    }
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

function isDoctorCsvCandidatePath(relativePath) {
  return /(^|\/)(Inbox_Loads|Inbox_Normalization_Log|Intake Log|File Register)\.csv$/i.test(relativePath);
}

function pushUnique(items, value) {
  if (value && !items.includes(value)) items.push(value);
}

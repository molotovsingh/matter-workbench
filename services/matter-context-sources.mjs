import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "../shared/csv.mjs";
import { SOURCE_INDEX_RELATIVE } from "../shared/matter-artifacts.mjs";
import {
  isExcludedMatterContextPath,
  toMatterContextPacketPath,
} from "./matter-context-path-policy.mjs";
import {
  effectiveShortSourceLabel,
  effectiveSourceLabel,
  sourceLabelContainsFileId,
} from "../shared/source-labels.mjs";

export { SOURCE_INDEX_RELATIVE };

const EXTRACTION_RECORD_SCHEMA_VERSION = "extraction-record/v1";
const SOURCE_INDEX_SCHEMA_VERSION = "source-index/v1";

export async function readMatterContextSources(root, warnings = []) {
  const matterJson = await readMatterJson(root);
  const intakes = await discoverIntakes(root, matterJson);
  const fileRegisters = await readFileRegisters(root, intakes, warnings);
  const registerByFileId = buildRegisterIndex(fileRegisters);
  const sourceDescriptors = await readTrustedSourceDescriptors(root, registerByFileId, warnings);
  const records = await readExtractionRecords(root, intakes, warnings);
  return {
    matterJson,
    intakes,
    fileRegisters,
    registerByFileId,
    sourceDescriptors,
    records,
  };
}

async function readMatterJson(root) {
  const matterJsonPath = path.join(root, "matter.json");
  try {
    return JSON.parse(await readFile(matterJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`matter.json not found or invalid at ${matterJsonPath}: ${error.message}`);
  }
}

async function discoverIntakes(root, matterJson) {
  const byDir = new Map();
  for (const intake of matterIntakes(matterJson)) {
    if (!intake?.intake_dir) continue;
    const intakeDir = toMatterContextPacketPath(intake.intake_dir);
    byDir.set(intakeDir, {
      intake_id: intake.intake_id || intakeIdFromDir(intake.intake_dir),
      intake_dir: intakeDir,
    });
  }

  const inboxDir = path.join(root, "00_Inbox");
  let entries = [];
  try {
    entries = await readdir(inboxDir, { withFileTypes: true });
  } catch {
    return [...byDir.values()].sort(compareIntakes);
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("Intake ")) continue;
    const intakeDir = `00_Inbox/${entry.name}`;
    if (!byDir.has(intakeDir)) {
      byDir.set(intakeDir, {
        intake_id: intakeIdFromDir(entry.name),
        intake_dir: intakeDir,
      });
    }
  }

  return [...byDir.values()].sort(compareIntakes);
}

function matterIntakes(matterJson) {
  const intakes = Array.isArray(matterJson.intakes) ? [...matterJson.intakes] : [];
  if (!intakes.length && matterJson.phase_1_intake) {
    intakes.push({
      intake_id: matterJson.phase_1_intake.intake_id || "INTAKE-01",
      intake_dir: matterJson.phase_1_intake.intake_dir || "00_Inbox/Intake 01 - Initial",
    });
  }
  return intakes;
}

function intakeIdFromDir(intakeDir) {
  const match = String(intakeDir).match(/Intake\s+(\d+)/i);
  return match ? `INTAKE-${match[1].padStart(2, "0")}` : "INTAKE-XX";
}

function compareIntakes(a, b) {
  return a.intake_dir.localeCompare(b.intake_dir, undefined, { numeric: true });
}

async function readFileRegisters(root, intakes, warnings) {
  const registers = [];
  for (const intake of intakes) {
    const relativePath = `${intake.intake_dir}/File Register.csv`;
    const registerPath = path.join(root, relativePath);
    let rows = [];
    try {
      rows = parseCsv(await readFile(registerPath, "utf8"))
        .filter((row) => !shouldExcludeRegisterRow(row))
        .map((row) => normalizeRegisterRow(row, intake));
    } catch (error) {
      if (error.code !== "ENOENT") {
        warnings.push(`Skipped invalid file register ${relativePath}: ${error.message}`);
      }
      continue;
    }

    registers.push({
      intake_id: intake.intake_id,
      intake_dir: intake.intake_dir,
      path: relativePath,
      rows,
    });
  }
  return registers;
}

function normalizeRegisterRow(row, intake) {
  return {
    file_id: row.file_id || "",
    intake_id: row.intake_id || intake.intake_id,
    source_path: toMatterContextPacketPath(row.source_path || ""),
    original_path: toMatterContextPacketPath(row.original_path || ""),
    working_copy_path: toMatterContextPacketPath(row.working_copy_path || ""),
    category: row.category || "",
    original_name: row.original_name || path.basename(row.source_path || ""),
    sha256: row.sha256 || "",
    size_bytes: row.size_bytes || "",
    duplicate_of: row.duplicate_of || "",
    status: row.status || "",
  };
}

function buildRegisterIndex(fileRegisters) {
  const byFileId = new Map();
  for (const register of fileRegisters) {
    for (const row of register.rows) {
      if (!row.file_id || byFileId.has(row.file_id)) continue;
      byFileId.set(row.file_id, {
        ...row,
        intake_dir: register.intake_dir,
      });
    }
  }
  return byFileId;
}

function shouldExcludeRegisterRow(row = {}) {
  const candidates = [
    row.source_path,
    row.original_path,
    row.working_copy_path,
    row.original_name,
  ].filter(Boolean);
  return candidates.some(isExcludedMatterContextPath);
}

async function readTrustedSourceDescriptors(root, registerByFileId, warnings) {
  const sourceIndexPath = path.join(root, SOURCE_INDEX_RELATIVE);
  let artifact = null;
  try {
    artifact = JSON.parse(await readFile(sourceIndexPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      warnings.push(`Skipped invalid ${SOURCE_INDEX_RELATIVE}: ${error.message}`);
    }
    return new Map();
  }

  if (artifact?.schema_version !== SOURCE_INDEX_SCHEMA_VERSION || !Array.isArray(artifact.sources)) {
    warnings.push(`Skipped ${SOURCE_INDEX_RELATIVE}: unrecognized source index schema`);
    return new Map();
  }

  const byFileId = new Map();
  for (const descriptor of artifact.sources) {
    const fileId = descriptor?.file_id || "";
    if (!fileId) continue;
    const row = registerByFileId.get(fileId);
    if (!row) {
      warnings.push(`Ignored Source Index descriptor for ${fileId}: file_id is not in current registers`);
      continue;
    }
    if (descriptor.sha256 && row.sha256 && descriptor.sha256 !== row.sha256) {
      warnings.push(`Ignored Source Index descriptor for ${fileId}: sha256 does not match current register`);
      continue;
    }
    const registeredPaths = [row.working_copy_path, row.source_path].filter(Boolean);
    if (descriptor.source_path && registeredPaths.length && !registeredPaths.includes(descriptor.source_path)) {
      warnings.push(`Ignored Source Index descriptor for ${fileId}: source_path does not match current register`);
      continue;
    }
    if (
      sourceLabelContainsFileId(descriptor.display_label)
      || sourceLabelContainsFileId(descriptor.short_label)
      || sourceLabelContainsFileId(descriptor.suggested_label)
      || sourceLabelContainsFileId(descriptor.confirmed_label)
    ) {
      warnings.push(`Ignored Source Index labels for ${fileId}: human label contains a FILE-NNNN identifier`);
      continue;
    }
    byFileId.set(fileId, normalizeTrustedSourceDescriptor(descriptor));
  }
  return byFileId;
}

function normalizeTrustedSourceDescriptor(descriptor = {}) {
  const displayLabel = effectiveSourceLabel(descriptor);
  const shortLabel = effectiveShortSourceLabel(descriptor, displayLabel);
  return {
    ...descriptor,
    source_id: descriptor.source_id || descriptor.file_id || "",
    content_hash: descriptor.content_hash || descriptor.sha256 || "",
    display_label: displayLabel,
    short_label: shortLabel,
  };
}

async function readExtractionRecords(root, intakes, warnings) {
  const records = [];
  for (const intake of intakes) {
    const extractedRelative = `${intake.intake_dir}/_extracted`;
    const extractedDir = path.join(root, extractedRelative);
    let entries = [];
    try {
      entries = await readdir(extractedDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.filter((item) => item.isFile() && /^FILE-\d+\.json$/.test(item.name))) {
      const recordPath = path.join(extractedDir, entry.name);
      try {
        const record = JSON.parse(await readFile(recordPath, "utf8"));
        if (record.schema_version !== EXTRACTION_RECORD_SCHEMA_VERSION || !record.file_id) continue;
        records.push({
          ...record,
          intake_id: intake.intake_id,
          intake_dir: intake.intake_dir,
          record_path: `${extractedRelative}/${entry.name}`,
        });
      } catch (error) {
        warnings.push(`Skipped invalid extraction record ${extractedRelative}/${entry.name}: ${error.message}`);
      }
    }
  }
  return records.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id), undefined, { numeric: true }));
}

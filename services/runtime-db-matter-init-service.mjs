import path from "node:path";

import { toCsv } from "../shared/csv.mjs";
import {
  classifyFile,
  FILE_REGISTER_HEADERS,
  INITIAL_INTAKE_DIR_NAME,
  INITIAL_INTAKE_ID,
  INTAKE_LOG_HEADERS,
  MATTER_INIT_ENGINE_VERSION,
  MATTER_WORKSPACE_LANES,
  normalizeWorkingCopyName,
} from "../shared/matter-contract.mjs";
import { runtimeWorkspaceFilePaths } from "./runtime-db-preparation-read-model.mjs";
import { normalizeRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";
import { sha256Bytes } from "./runtime-db-bytes.mjs";

export function buildRuntimeDbMatterInit({
  matter = {},
  workspace = {},
  matterJson: existingMatter = {},
  readPayloadRow,
  options = {},
} = {}) {
  if (!matter?.name) throw new Error("runtime DB matter is required");
  if (typeof readPayloadRow !== "function") throw new Error("runtime DB payload reader is required");

  const metadata = options.metadata || {};
  const dryRun = Boolean(options.dryRun);
  const defaultIntake = firstExistingIntake(existingMatter);
  const intakeId = options.intakeId || defaultIntake?.intake_id || INITIAL_INTAKE_ID;
  const intakeDirName = options.intakeDirName || basenameFromMatterPath(defaultIntake?.intake_dir) || INITIAL_INTAKE_DIR_NAME;
  const fileIdStart = Number.isFinite(options.fileIdStart) ? options.fileIdStart : 1;
  const receivedDate = options.receivedDate || defaultIntake?.received_date || new Date().toISOString().slice(0, 10);
  const intakeLabel = options.intakeLabel || defaultIntake?.label || (intakeDirName === INITIAL_INTAKE_DIR_NAME ? "Initial" : "");
  const paths = resolveRuntimeMatterInitPaths(intakeDirName);
  const workspaceLanes = MATTER_WORKSPACE_LANES.map((lane) => ({
    path: lane.path,
    label: lane.label,
    purpose: lane.purpose,
  }));
  const sourceRows = runtimeSourceFilesForIntake({ workspace, intakeDir: paths.sourceDir });
  if (!sourceRows.length) {
    throw new Error(`Intake source folder is missing or empty in DB custody: ${paths.sourceDir}`);
  }

  const seenByHash = new Map();
  const fileRegisterRows = [];
  const artifactFiles = [];

  for (const [index, source] of sourceRows.entries()) {
    const payload = readPayloadRow({ matter, relativePath: source.path });
    const fileId = `FILE-${String(fileIdStart + index).padStart(4, "0")}`;
    const sourceHash = sha256Bytes(payload.bytes);
    const relativeSource = source.path.slice(`${paths.sourceDir}/`.length);
    const category = classifyFile(source.path);
    const originalPath = normalizeRuntimeObjectKey(`${paths.originalsDir}/${relativeSource}`);
    const workingCopyName = `${fileId}__${normalizeWorkingCopyName(path.posix.basename(source.path))}`;
    const workingCopyPath = normalizeRuntimeObjectKey(`${paths.byTypeDir}/${category}/${workingCopyName}`);
    const intraBatchDup = seenByHash.get(sourceHash) || "";
    if (!intraBatchDup) seenByHash.set(sourceHash, fileId);

    artifactFiles.push(
      { relativePath: originalPath, bytes: payload.bytes },
      { relativePath: workingCopyPath, bytes: payload.bytes },
    );

    fileRegisterRows.push({
      file_id: fileId,
      intake_id: intakeId,
      source_path: source.path,
      original_path: originalPath,
      working_copy_path: workingCopyPath,
      category,
      original_name: path.posix.basename(source.path),
      sha256: sourceHash,
      size_bytes: payload.sizeBytes || payload.bytes.length,
      duplicate_of: intraBatchDup,
      status: intraBatchDup ? "exact-duplicate" : "unique",
      engine_version: MATTER_INIT_ENGINE_VERSION,
      notes: intraBatchDup ? `Exact duplicate of ${intraBatchDup}.` : "First-seen file for this checksum.",
    });
  }

  const uniqueFiles = fileRegisterRows.filter((row) => row.status === "unique").length;
  const duplicatesInBatch = fileRegisterRows.filter((row) => row.status === "exact-duplicate").length;
  const duplicatesOfPrior = 0;
  const intakeLogRows = [{
    intake_id: intakeId,
    intake_dir: paths.intakeDir,
    received_date: receivedDate,
    label: intakeLabel,
    source_dir: paths.sourceDir,
    originals_dir: paths.originalsDir,
    by_type_dir: paths.byTypeDir,
    scanned_files: fileRegisterRows.length,
    unique_files: uniqueFiles,
    duplicates_in_batch: duplicatesInBatch,
    duplicates_of_prior: duplicatesOfPrior,
    originals_copied: fileRegisterRows.length,
    working_copies_copied: fileRegisterRows.length,
    loose_root_files_seen: 0,
    loose_root_files_staged: 0,
    engine_version: MATTER_INIT_ENGINE_VERSION,
    notes: "Deterministic DB-custody intake. Source files are copied into Originals and By Type custody objects when needed; source payloads are not modified.",
  }];

  const newIntakeEntry = {
    intake_id: intakeId,
    engine_version: MATTER_INIT_ENGINE_VERSION,
    intake_dir: paths.intakeDir,
    received_date: receivedDate,
    label: intakeLabel,
    source_dir: paths.sourceDir,
    originals_dir: paths.originalsDir,
    by_type_dir: paths.byTypeDir,
    intake_log: paths.intakeLogPath,
    file_register: paths.fileRegisterPath,
    scanned_files: fileRegisterRows.length,
    unique_files: uniqueFiles,
    duplicates_in_batch: duplicatesInBatch,
    duplicates_of_prior: duplicatesOfPrior,
    loose_root_files_seen: 0,
    loose_root_files_staged: 0,
    loose_root_source_files: [],
  };
  const intakesArray = mergedIntakes(existingMatter, newIntakeEntry, intakeId);
  const matterJson = {
    ...existingMatter,
    matter_name: metadata.matterName || existingMatter.matter_name || matter.matterName || matter.name || "",
    matter_type: metadata.matterType || existingMatter.matter_type || matter.matterType || "",
    client_name: metadata.clientName || existingMatter.client_name || matter.clientName || "",
    opposite_party: metadata.oppositeParty || existingMatter.opposite_party || matter.oppositeParty || "",
    jurisdiction: metadata.jurisdiction || existingMatter.jurisdiction || matter.jurisdiction || "",
    brief_description: metadata.briefDescription || existingMatter.brief_description || matter.briefDescription || "",
    workspace_mode: existingMatter.workspace_mode || "legal",
    workspace_lanes: workspaceLanes,
    intakes: intakesArray,
  };
  delete matterJson.phase_1_intake;

  artifactFiles.push(
    { relativePath: paths.intakeLogPath, text: toCsv(intakeLogRows, INTAKE_LOG_HEADERS) },
    { relativePath: paths.fileRegisterPath, text: toCsv(fileRegisterRows, FILE_REGISTER_HEADERS) },
    { relativePath: "matter.json", text: `${JSON.stringify(matterJson, null, 2)}\n` },
  );

  return {
    operationResult: {
      dryRun,
      matterRoot: `postgres:${matter.name}`,
      paths: {
        intakeDir: paths.intakeDir,
        sourceDir: paths.sourceDir,
        originalsDir: paths.originalsDir,
        byTypeDir: paths.byTypeDir,
        intakeLogPath: paths.intakeLogPath,
        fileRegisterPath: paths.fileRegisterPath,
        matterJsonPath: "matter.json",
      },
      counts: {
        scannedFiles: fileRegisterRows.length,
        uniqueFiles,
        duplicatesInBatch,
        duplicatesOfPrior,
        originalsCopied: fileRegisterRows.length,
        workingCopiesCopied: fileRegisterRows.length,
        looseRootFilesSeen: 0,
        looseRootFilesStaged: 0,
        workspaceLanes: workspaceLanes.length,
      },
      intake: {
        intake_id: intakeId,
        intake_dir_name: intakeDirName,
        received_date: receivedDate,
        label: intakeLabel,
      },
      categories: fileRegisterRows.reduce((accumulator, row) => {
        accumulator[row.category] = (accumulator[row.category] || 0) + 1;
        return accumulator;
      }, {}),
      matterJson,
      logs: {
        intakeLogRows,
        rootStagingRows: [],
        fileRegisterRows,
      },
      outputLines: [
        "> workbench.run /matter-init",
        "[intake] staged loose root files: none found",
        `[intake] source: ${paths.sourceDir}`,
        `[intake] scanned ${fileRegisterRows.length} files`,
        `[intake] unique files: ${uniqueFiles}`,
        `[intake] exact duplicates in batch: ${duplicatesInBatch}`,
        "[intake] duplicates of prior intake: 0",
        `[intake] originals: ${paths.originalsDir}`,
        `[intake] by type: ${paths.byTypeDir}`,
        `[workspace] lanes: ${workspaceLanes.map((lane) => lane.path).join(", ")}`,
        `[intake] wrote logs: ${paths.intakeLogPath}, ${paths.fileRegisterPath}`,
        "[intake] status: complete - deterministic intake ready for lawyer review",
      ],
    },
    files: dryRun ? [] : artifactFiles,
  };
}

function resolveRuntimeMatterInitPaths(intakeDirName) {
  const intakeDir = normalizeRuntimeObjectKey(`00_Inbox/${intakeDirName}`);
  return {
    intakeDir,
    sourceDir: `${intakeDir}/Source Files`,
    originalsDir: `${intakeDir}/Originals`,
    byTypeDir: `${intakeDir}/By Type`,
    intakeLogPath: `${intakeDir}/Intake Log.csv`,
    fileRegisterPath: `${intakeDir}/File Register.csv`,
  };
}

function runtimeSourceFilesForIntake({ workspace, intakeDir }) {
  const prefix = `${intakeDir}/`;
  return runtimeWorkspaceFilePaths(workspace.tree || workspace.root || {})
    .filter((item) => item.path.startsWith(prefix) && item.path.includes("/Source Files/"))
    .filter((item) => !isIgnoredRuntimeMatterInitPath(item.path))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function isIgnoredRuntimeMatterInitPath(relativePath = "") {
  return relativePath.split("/").some((part) => (
    part === ".DS_Store"
    || part === "Thumbs.db"
    || part.startsWith(".")
    || part.startsWith("~$")
    || part === "Originals"
    || part === "By Type"
  ));
}

function firstExistingIntake(existingMatter = {}) {
  const intakes = Array.isArray(existingMatter.intakes) ? existingMatter.intakes : [];
  if (intakes.length > 0) return intakes[0];
  if (existingMatter.phase_1_intake) return existingMatter.phase_1_intake;
  return null;
}

function basenameFromMatterPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return "";
  return path.posix.basename(normalizeRuntimeObjectKey(relativePath));
}

function mergedIntakes(existingMatter, newIntakeEntry, intakeId) {
  let priorIntakes = Array.isArray(existingMatter.intakes) ? [...existingMatter.intakes] : [];
  if (!priorIntakes.length && existingMatter.phase_1_intake) {
    priorIntakes = [{
      ...existingMatter.phase_1_intake,
      intake_id: existingMatter.phase_1_intake.intake_id || "INTAKE-01",
      intake_dir: existingMatter.phase_1_intake.intake_dir || "00_Inbox/Intake 01 - Initial",
      received_date: existingMatter.phase_1_intake.received_date || "",
      label: existingMatter.phase_1_intake.label || "Initial",
    }];
  }
  return [
    ...priorIntakes.filter((entry) => entry.intake_id !== intakeId),
    newIntakeEntry,
  ];
}

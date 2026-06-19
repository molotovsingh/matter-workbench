import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import { Readable } from "node:stream";
import path from "node:path";
import process from "node:process";

import { buildListOfDatesSourceLabelRefresh } from "./listofdates-label-refresh-service.mjs";
import { makeHttpError, toPosix } from "../shared/safe-paths.mjs";
import {
  WORKSPACE_PREVIEW_LIMITS,
  getWorkspaceRawContentType,
  getWorkspaceTextPreviewLimit,
  isWorkspaceTextPreviewExtension,
} from "../shared/workspace-preview-policy.mjs";
import { runtimeDbUserFromRequestContext } from "./request-context.mjs";
import {
  runtimeArtifactMimeTypeForPath,
  runtimeArtifactRoleForPath,
} from "./runtime-db-artifact-policy.mjs";
import {
  planNewRuntimeMatterUpload,
  planRuntimeAddFilesUpload,
  validateRuntimeUploadInputs,
} from "./runtime-db-upload-intake-planner.mjs";
import { buildRuntimeUploadIntake } from "./runtime-db-upload-materializer.mjs";
import { validatedRelativePathFromRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";
import {
  buildRuntimeWorkspaceTree,
  normalizeRuntimeWorkspaceObjectRow,
  publicRuntimeWorkspaceTree,
} from "./runtime-db-workspace-read-model.mjs";
import {
  runtimeMatterStatusFromWorkspaceState,
  runtimePrepareMatterPlanFromStatus,
  runtimeWorkspaceFilePaths,
} from "./runtime-db-preparation-read-model.mjs";
import {
  listRuntimeMatterFiles,
  materializeRuntimeWorkspacePayloads,
  sha256Bytes,
  synthesizeMissingFileRegisters,
} from "./runtime-db-materialized-workspace.mjs";
import {
  buildMaterializedDeletionPersistenceSql,
  buildMaterializedFilePersistenceSql,
  materializedDeletionRowsForFiles,
  materializedRowsForFiles,
  summarizeMaterializedDeletionRows,
  summarizeMaterializedRows,
} from "./runtime-db-materialized-persistence-sql.mjs";
import { runRuntimeDbDoctorScan } from "./runtime-db-doctor-scan.mjs";
import { buildRuntimeDbMatterContextPacket } from "./runtime-db-matter-context-packet.mjs";
import { queryRuntimeDbJson } from "./runtime-db-query.mjs";
import {
  buildAdvisorySnapshotSql,
  buildMatterAddFilesAllocationSql,
  buildMatterByNameSql,
  buildPayloadSql,
  buildUploadOverlapSql,
  buildWorkspaceSql,
} from "./runtime-db-storage-query-sql.mjs";
import { stringValue } from "./runtime-db-sql-format.mjs";
import {
  buildRuntimeUploadPersistenceSql,
  createMatterAddFilesSql,
  createMatterUploadSql,
  runtimeDbActorSqls,
} from "./runtime-db-upload-persistence-sql.mjs";
import { isBlockedWorkspacePath } from "./workspace-path-policy.mjs";

const {
  maxRawBytes,
} = WORKSPACE_PREVIEW_LIMITS;
const DEFAULT_PSQL_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

export function createRuntimeDbStorageService({
  databaseUrl = "",
  tenantId = "",
  spawn = spawnSync,
  tempRoot = os.tmpdir(),
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);

  async function readWorkspace(matter) {
    const workspace = readWorkspaceForMaterialization(matter);
    return {
      ...workspace,
      tree: publicRuntimeWorkspaceTree(workspace.tree),
    };
  }

  function readWorkspaceForMaterialization(matter) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const { dbMatter, tree } = readWorkspaceState(normalizedMatter);
    return {
      folderName: dbMatter.name,
      inputLabel: `postgres:${dbMatter.name}`,
      metadata: {
        matterName: dbMatter.matterName || dbMatter.name,
        clientName: dbMatter.clientName,
        oppositeParty: dbMatter.oppositeParty,
        matterType: dbMatter.matterType,
        jurisdiction: dbMatter.jurisdiction,
        briefDescription: dbMatter.briefDescription,
      },
      fileCount: tree.fileCount,
      directoryCount: tree.directoryCount,
      tree: tree.root,
    };
  }

  function readWorkspaceState(normalizedMatter) {
    const result = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildWorkspaceSql({ tenantId, matter: normalizedMatter }),
    });
    if (!result?.matter?.id) {
      throw runtimeDbReadError({
        message: `Matter not found in runtime database storage: ${normalizedMatter.name}`,
        statusCode: 404,
        code: "runtime_db.read.matter_not_found",
      });
    }
    const objects = Array.isArray(result.objects) ? result.objects.map(normalizeRuntimeWorkspaceObjectRow) : [];
    const dbMatter = normalizeMatter({ ...normalizedMatter, ...(result.matter || {}) });
    const tree = buildRuntimeWorkspaceTree({ matter: dbMatter, objects });
    return {
      dbMatter,
      objects,
      tree,
    };
  }

  async function readFilePreview(relativePath, matter) {
    ensureEnabled();
    const normalizedPath = normalizeMatterRelativePath(relativePath);
    const extension = path.extname(normalizedPath).toLowerCase();
    if (!isWorkspaceTextPreviewExtension(normalizedPath)) {
      throw runtimeDbReadError({
        message: "File type is not previewable as text",
        statusCode: 415,
        code: "runtime_db.read.unsupported_preview_type",
      });
    }
    const payload = readPayloadRow({ matter: normalizeMatter(matter), relativePath: normalizedPath });
    if (payload.sizeBytes > getWorkspaceTextPreviewLimit(normalizedPath)) {
      throw runtimeDbReadError({
        message: "File is too large to preview",
        statusCode: 413,
        code: "runtime_db.read.file_too_large_preview",
      });
    }
    return {
      path: normalizedPath,
      name: path.posix.basename(normalizedPath),
      ext: extension.replace(/^\./, ""),
      content: payload.bytes.toString("utf8"),
    };
  }

  async function getRawFile(relativePath, matter) {
    ensureEnabled();
    const normalizedPath = normalizeMatterRelativePath(relativePath);
    const payload = readPayloadRow({ matter: normalizeMatter(matter), relativePath: normalizedPath });
    if (payload.sizeBytes > maxRawBytes) {
      throw runtimeDbReadError({
        message: "File is too large to display inline",
        statusCode: 413,
        code: "runtime_db.read.file_too_large_raw",
      });
    }
    return {
      contentType: payload.mimeType || getWorkspaceRawContentType(normalizedPath),
      fileSize: payload.sizeBytes,
      safeFilename: path.posix.basename(normalizedPath).replace(/[\r\n"]/g, "_"),
      stream: Readable.from(payload.bytes),
    };
  }

  async function createMatterFromUploadedFiles({
    name = "",
    metadata = {},
    files = [],
    relativePaths = [],
  } = {}) {
    ensureEnabled();
    const actor = runtimeDbUserFromRequestContext();
    const uploadPlan = planNewRuntimeMatterUpload({ name, metadata, files, relativePaths, actor });
    const matter = uploadPlan.matter;
    const matterName = matter.name;
    const existing = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildMatterByNameSql({ tenantId, name: matterName }),
    });
    if (existing?.id) throw makeHttpError(`A matter named "${matterName}" already exists`, 409, "runtime_db.upload.matter_exists");

    const { storageFiles, importItems } = await buildRuntimeUploadIntake({
      ...uploadPlan.buildIntakeArgs,
      tempRoot,
    });

    persistRuntimeUploadIntakeRecords({
      databaseUrl,
      tenantId,
      spawn,
      actor,
      matter,
      uploadPlan,
      storageFiles,
      importItems,
      uploadSqls: createMatterUploadSql({
        matter,
        actor,
        intakeId: uploadPlan.intakeDbId,
        uploadSessionId: uploadPlan.uploadSessionId,
        importBatchId: uploadPlan.importBatchId,
        importItems,
        expectedFileCount: importItems.length,
        receivedDate: uploadPlan.receivedDate,
      }),
    });
    return matter;
  }

  async function addUploadedFilesToMatter({
    matter = {},
    label = "",
    files = [],
    relativePaths = [],
  } = {}) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    if (!normalizedMatter.id) throw makeHttpError("Matter id is required for runtime DB upload", 400, "runtime_db.upload.matter_id_required");
    const safeRelativePaths = validateRuntimeUploadInputs({ files, relativePaths, action: "adding files" });

    const actor = runtimeDbUserFromRequestContext();
    const allocation = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildMatterAddFilesAllocationSql({
        tenantId,
        matter: normalizedMatter,
        expectedFileCount: files.length,
        label,
        receivedDate: new Date().toISOString().slice(0, 10),
        actor,
      }),
    });
    if (!allocation?.matter?.id) throw makeHttpError(`Matter not found in runtime database: ${normalizedMatter.name}`, 404, "runtime_db.upload.matter_not_found");
    const uploadPlan = planRuntimeAddFilesUpload({
      matter: normalizedMatter,
      allocation,
      label,
      files,
      relativePaths: safeRelativePaths,
    });
    const dbMatter = uploadPlan.matter;
    const { storageFiles, importItems } = await buildRuntimeUploadIntake({
      ...uploadPlan.buildIntakeArgs,
      tempRoot,
      existingFiles: await readWorkspacePayloadFiles(dbMatter),
    });

    persistRuntimeUploadIntakeRecords({
      databaseUrl,
      tenantId,
      spawn,
      actor,
      matter: dbMatter,
      uploadPlan,
      storageFiles,
      importItems,
      uploadSqls: createMatterAddFilesSql({
        matter: dbMatter,
        actor,
        intakeDbId: uploadPlan.intakeDbId,
        intakeNumber: uploadPlan.intakeNumber,
        uploadSessionId: uploadPlan.uploadSessionId,
        importBatchId: uploadPlan.importBatchId,
        importItems,
        expectedFileCount: importItems.length,
        label,
        receivedDate: uploadPlan.receivedDate,
      }),
    });
    return {
      intakeId: uploadPlan.intakeId,
      intakeDirName: uploadPlan.intakeDirName,
      receivedDate: uploadPlan.receivedDate,
      label,
      scanned: importItems.length,
      unique: importItems.length,
      duplicatesInBatch: 0,
      duplicatesOfPrior: 0,
    };
  }

  async function checkUploadedFileOverlap(hashes = []) {
    ensureEnabled();
    const normalizedHashes = (Array.isArray(hashes) ? hashes : [])
      .map((hash) => stringValue(hash).toLowerCase())
      .filter((hash) => /^[0-9a-f]{64}$/i.test(hash));
    if (!normalizedHashes.length) return { warnings: [] };
    const result = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildUploadOverlapSql({ tenantId, hashes: normalizedHashes }),
    });
    return {
      warnings: normalizeOverlapWarnings(result?.warnings),
    };
  }

  async function readMatterStatus(matter) {
    const normalizedMatter = normalizeMatter(matter);
    return matterStatusFromState(normalizedMatter, readWorkspaceState(normalizedMatter));
  }

  function matterStatusFromState(normalizedMatter, { objects, tree }) {
    return runtimeMatterStatusFromWorkspaceState({ matter: normalizedMatter, objects, tree });
  }

  async function readPrepareMatterPlan(matter) {
    const normalizedMatter = normalizeMatter(matter);
    const state = readWorkspaceState(normalizedMatter);
    const status = matterStatusFromState(normalizedMatter, state);
    return runtimePrepareMatterPlanFromStatus({ matter: normalizedMatter, dbMatter: state.dbMatter, status });
  }

  async function readMatterContextPacket(matter, options = {}) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    return buildRuntimeDbMatterContextPacket({
      matter: normalizedMatter,
      workspace,
      readPayloadRow,
      options,
    });
  }

  async function readRerunAdvice(skill, matter) {
    ensureEnabled();
    const normalizedSkill = normalizeWorkflowSkill(skill);
    if (!["/describe_sources", "/create_listofdates"].includes(normalizedSkill)) {
      throw makeHttpError(`Rerun advice is not available for ${skill || "unknown skill"}`, 400, "rerun_advice.unsupported_skill");
    }
    const normalizedMatter = normalizeMatter(matter);
    const status = matterStatusFromState(normalizedMatter, readWorkspaceState(normalizedMatter));
    const stage = status.stages.find((item) => item.slash === normalizedSkill);
    return stage?.rerunAdvice || null;
  }

  async function artifactExists(matter, relativePath) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    try {
      readPayloadRow({ matter: normalizedMatter, relativePath: normalizeMatterRelativePath(relativePath) });
      return true;
    } catch (error) {
      if (error?.statusCode === 404) return false;
      if (error?.statusCode === 409) return true;
      throw error;
    }
  }

  async function persistTextArtifacts(matter, files = []) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const normalizedFiles = files.map((file) => {
      const relativePath = normalizeMatterRelativePath(file.relativePath);
      const bytes = Buffer.isBuffer(file.bytes)
        ? file.bytes
        : Buffer.from(String(file.text || ""), "utf8");
      const sha256 = file.sha256 || sha256Bytes(bytes);
      return {
        relativePath,
        bytes,
        sha256,
        sizeBytes: bytes.length,
        objectRole: file.objectRole || runtimeArtifactRoleForPath(relativePath),
        mimeType: file.mimeType || runtimeArtifactMimeTypeForPath(relativePath),
      };
    });
    return normalizedFiles.length
      ? persistMaterializedFiles({ databaseUrl, tenantId, spawn, matter: normalizedMatter, files: normalizedFiles })
      : [];
  }

  async function refreshListOfDatesSourceLabels(matter, options = {}) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const matterJson = readRuntimeDbJsonPayload({
      matter: normalizedMatter,
      relativePath: "matter.json",
      label: "matter.json",
      readPayloadRow,
      missingMessage: "matter.json is missing from DB payload custody. Run /matter-init first.",
      missingCode: "runtime_db.listofdates_refresh.matter_missing",
    });
    const listJson = readRuntimeDbJsonPayload({
      matter: normalizedMatter,
      relativePath: "10_Library/List of Dates.json",
      label: "List of Dates",
      readPayloadRow,
      missingMessage: "List of Dates artifact is missing from DB payload custody. Run /create_listofdates first.",
      missingCode: "runtime_db.listofdates_refresh.list_missing",
    });
    const sourceIndex = readRuntimeDbJsonPayload({
      matter: normalizedMatter,
      relativePath: "10_Library/Source Index.json",
      label: "Source Index",
      readPayloadRow,
      missingMessage: "Source Index artifact is missing from DB payload custody. Run /describe_sources first.",
      missingCode: "runtime_db.listofdates_refresh.source_index_missing",
    });
    const { response, files } = buildListOfDatesSourceLabelRefresh({
      matterRoot: `postgres:${normalizedMatter.name}`,
      matterJson,
      listJson,
      sourceIndex,
      dryRun: Boolean(options.dryRun),
      generatedAt: options.generatedAt,
    });
    const filesToPersist = files.map((file) => {
      const bytes = Buffer.from(file.text || "", "utf8");
      const sha256 = sha256Bytes(bytes);
      return {
        relativePath: file.relativePath,
        bytes,
        sha256,
        sizeBytes: bytes.length,
        objectRole: runtimeArtifactRoleForPath(file.relativePath),
        mimeType: runtimeArtifactMimeTypeForPath(file.relativePath),
      };
    });
    const persisted = options.dryRun
      ? []
      : persistMaterializedFiles({ databaseUrl, tenantId, spawn, matter: normalizedMatter, files: filesToPersist });
    return {
      operationResult: response,
      persisted,
    };
  }

  async function readDoctorScan(matter) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    return runRuntimeDbDoctorScan({
      matter: normalizedMatter,
      workspace,
      readPayloadRow,
    });
  }

  async function readMatterAttention(matter) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const result = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildAdvisorySnapshotSql({ tenantId, matter: normalizedMatter }),
    });
    if (result?.schema_version) return result;
    return emptyAttention(normalizedMatter);
  }

  async function runMaterializedMatterWrite(matter, operation) {
    ensureEnabled();
    if (typeof operation !== "function") throw makeHttpError("Runtime DB write operation is required", 500, "runtime_db.materialized_write.operation_required");
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    const workDir = await mkdtemp(path.join(tempRoot || os.tmpdir(), "mwb-runtime-db-"));
    const matterRoot = path.join(workDir, normalizedMatter.name);
    const initialHashes = new Map();
    try {
      await mkdir(matterRoot, { recursive: true });
      const materializedPaths = await materializeRuntimeWorkspacePayloads({
        matterRoot,
        matter: normalizedMatter,
        workspace,
        readPayloadRow,
      });
      for (const relativePath of materializedPaths) {
        const bytes = await readFile(path.join(matterRoot, ...relativePath.split("/")));
        initialHashes.set(relativePath, sha256Bytes(bytes));
      }
      await synthesizeMissingFileRegisters({
        matterRoot,
        workspace,
        normalizeRelativePath: normalizeMatterRelativePath,
      });
      const operationResult = await operation({ matterRoot, matter: normalizedMatter });
      const files = await listRuntimeMatterFiles(matterRoot);
      const currentPaths = new Set(files.map((file) => file.relativePath));
      const changedFiles = [];
      for (const file of files) {
        const bytes = await readFile(path.join(matterRoot, ...file.relativePath.split("/")));
        const sha256 = sha256Bytes(bytes);
        if (initialHashes.get(file.relativePath) === sha256) continue;
        changedFiles.push({
          relativePath: file.relativePath,
          bytes,
          sha256,
          sizeBytes: bytes.length,
          objectRole: runtimeArtifactRoleForPath(file.relativePath),
          mimeType: runtimeArtifactMimeTypeForPath(file.relativePath),
        });
      }
      const persisted = changedFiles.length
        ? persistMaterializedFiles({ databaseUrl, tenantId, spawn, matter: normalizedMatter, files: changedFiles })
        : [];
      const deletedFiles = [...initialHashes.keys()]
        .filter((relativePath) => !currentPaths.has(relativePath))
        .map((relativePath) => ({
          relativePath,
          objectKey: `${normalizedMatter.name}/${relativePath}`,
        }));
      const deleted = deletedFiles.length
        ? persistMaterializedDeletions({ databaseUrl, tenantId, spawn, matter: normalizedMatter, files: deletedFiles })
        : [];
      return {
        operationResult,
        persisted,
        deleted,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async function readWorkspacePayloadFiles(matter) {
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    const rows = [];
    for (const item of runtimeWorkspaceFilePaths(workspace.tree)) {
      const payload = readPayloadRow({ matter: normalizedMatter, relativePath: item.path });
      rows.push({
        relativePath: item.path,
        bytes: payload.bytes,
      });
    }
    return rows;
  }

  async function runMaterializedMatterRead(matter, operation) {
    ensureEnabled();
    if (typeof operation !== "function") throw makeHttpError("Runtime DB read operation is required", 500, "runtime_db.materialized_read.operation_required");
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    const workDir = await mkdtemp(path.join(tempRoot || os.tmpdir(), "mwb-runtime-db-"));
    const matterRoot = path.join(workDir, normalizedMatter.name);
    try {
      await mkdir(matterRoot, { recursive: true });
      await materializeRuntimeWorkspacePayloads({
        matterRoot,
        matter: normalizedMatter,
        workspace,
        readPayloadRow,
      });
      await synthesizeMissingFileRegisters({
        matterRoot,
        workspace,
        normalizeRelativePath: normalizeMatterRelativePath,
      });
      return await operation({ matterRoot, matter: normalizedMatter });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  function readPayloadRow({ matter, relativePath }) {
    const result = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildPayloadSql({ tenantId, matter, relativePath }),
    });
    if (!result || typeof result !== "object" || !result.objectKey) {
      throw runtimeDbReadError({
        message: `File not found in runtime database storage: ${relativePath}`,
        statusCode: 404,
        code: "runtime_db.read.file_not_found",
      });
    }
    if (!result.hasPayload) {
      throw runtimeDbReadError({
        message: `Runtime DB payload is missing for ${relativePath}`,
        statusCode: 409,
        code: "runtime_db.read.payload_missing",
      });
    }
    const payloadBase64 = stringValue(result.payloadBase64);
    const bytes = Buffer.from(payloadBase64, "base64");
    const sizeBytes = Number(result.sizeBytes);
    return {
      objectKey: stringValue(result.objectKey),
      mimeType: stringValue(result.mimeType),
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : bytes.length,
      bytes,
    };
  }

  function ensureEnabled() {
    if (!enabled) {
      throw runtimeDbReadError({
        message: "Runtime DB storage is not configured",
        statusCode: 503,
        code: "runtime_db.storage.not_configured",
      });
    }
  }

  return {
    addUploadedFilesToMatter,
    artifactExists,
    checkUploadedFileOverlap,
    enabled,
    createMatterFromUploadedFiles,
    getRawFile,
    readDoctorScan,
    readMatterAttention,
    refreshListOfDatesSourceLabels,
    readMatterContextPacket,
    readMatterStatus,
    readPrepareMatterPlan,
    readRerunAdvice,
    persistTextArtifacts,
    readFilePreview,
    readWorkspace,
    runMaterializedMatterRead,
    runMaterializedMatterWrite,
  };
}

export function isRuntimeDbStorageModeEnabled(env = process.env) {
  return String(env.MWB_RUNTIME_DB_STORAGE || "").trim().toLowerCase() === "postgres";
}

function queryJson({ databaseUrl, tenantId, spawn, sql }) {
  return queryRuntimeDbJson({
    databaseUrl,
    spawn,
    sql,
    maxBuffer: runtimeDbStoragePsqlMaxBuffer(),
    errorPrefix: "runtime DB storage query failed",
    errorCode: "runtime_db.storage.query_failed",
    noJsonMessage: "runtime DB storage query returned no JSON.",
    noJsonCode: "runtime_db.storage.no_json",
    invalidJsonMessage: "runtime DB storage query returned invalid JSON.",
    invalidJsonCode: "runtime_db.storage.invalid_json",
  });
}

function runtimeDbStoragePsqlMaxBuffer() {
  const configured = Number(process.env.MWB_RUNTIME_DB_STORAGE_PSQL_MAX_BUFFER_BYTES);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_PSQL_MAX_BUFFER_BYTES;
}

function readRuntimeDbJsonPayload({
  matter,
  relativePath,
  label,
  readPayloadRow,
  missingMessage,
  missingCode,
} = {}) {
  let payload;
  try {
    payload = readPayloadRow({ matter, relativePath });
  } catch (error) {
    if (error?.statusCode === 404) {
      throw makeHttpError(missingMessage || `${label} is missing from DB payload custody.`, 404, missingCode || "runtime_db.json_payload.missing");
    }
    throw error;
  }
  try {
    return JSON.parse(payload.bytes.toString("utf8"));
  } catch (error) {
    throw makeHttpError(`${label} payload is invalid JSON: ${error.message}`, 400, "runtime_db.json_payload.invalid_json");
  }
}

function normalizeWorkflowSkill(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const withSlash = text.startsWith("/") ? text : `/${text}`;
  return withSlash.replace(/-/g, "_");
}

function normalizeMatterRelativePath(value) {
  const raw = String(value || "").replaceAll("\\", "/").trim();
  if (!raw) {
    throw runtimeDbReadError({
      message: "File path is required",
      statusCode: 400,
      code: "runtime_db.read.path_required",
    });
  }
  if (raw.startsWith("/")) {
    throw runtimeDbReadError({
      message: "Requested path is outside the matter root",
      statusCode: 400,
      code: "runtime_db.read.path_outside_matter",
    });
  }
  const normalized = toPosix(path.posix.normalize(raw)).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw runtimeDbReadError({
      message: "Requested path is outside the matter root",
      statusCode: 400,
      code: "runtime_db.read.path_outside_matter",
    });
  }
  if (isBlockedWorkspacePath(normalized)) {
    throw runtimeDbReadError({
      message: "Requested path is hidden from workspace preview",
      statusCode: 403,
      code: "runtime_db.read.path_hidden",
    });
  }
  return normalized;
}

function runtimeDbReadError({ message, statusCode, code }) {
  return makeHttpError(message, statusCode, code);
}

function persistMaterializedFiles({ databaseUrl, tenantId, spawn, matter, files }) {
  const rows = materializedRowsForFiles({ matter, files });
  const sql = buildMaterializedFilePersistenceSql({ tenantId, matter, rows });
  queryJson({
    databaseUrl,
    tenantId,
    spawn,
    sql,
  });
  return summarizeMaterializedRows(rows);
}

function persistMaterializedDeletions({ databaseUrl, tenantId, spawn, matter, files }) {
  const rows = materializedDeletionRowsForFiles({ matter, files });
  if (!rows.length) return [];
  const sql = buildMaterializedDeletionPersistenceSql({ tenantId, matter, rows });
  queryJson({
    databaseUrl,
    tenantId,
    spawn,
    sql,
  });
  return summarizeMaterializedDeletionRows(rows);
}

function persistRuntimeUploadIntakeRecords({
  databaseUrl,
  tenantId,
  spawn,
  actor,
  matter,
  uploadPlan,
  storageFiles = [],
  importItems = [],
  uploadSqls = [],
}) {
  const filesToPersist = storageFiles.map((file) => ({
    ...file,
    sha256: sha256Bytes(file.bytes),
    sizeBytes: file.bytes.length,
  }));
  const persistedRows = materializedRowsForFiles({ matter, files: filesToPersist });
  const sql = buildRuntimeUploadPersistenceSql({
    tenantId,
    actor,
    matter,
    uploadPlan,
    importItems,
    persistedRows,
    uploadSqls,
  });
  queryJson({ databaseUrl, tenantId, spawn, sql });
  return { persistedRows };
}

function emptyAttention(matter) {
  return {
    schema_version: "matter-attention/v1",
    generated_at: new Date(0).toISOString(),
    matterName: matter.matterName || matter.name,
    matterRoot: `postgres:${matter.name}`,
    summary: { total: 0, blocker: 0, warning: 0, info: 0, state: "clear" },
    items: [],
  };
}

function normalizeMatter(matter = {}) {
  return {
    id: stringValue(matter.id),
    name: stringValue(matter.name || matter.folderName || matter.matterName),
    folderName: stringValue(matter.folderName || matter.name),
    matterName: stringValue(matter.matterName || matter.name),
    clientName: stringValue(matter.clientName),
    oppositeParty: stringValue(matter.oppositeParty),
    matterType: stringValue(matter.matterType),
    jurisdiction: stringValue(matter.jurisdiction),
    briefDescription: stringValue(matter.briefDescription),
  };
}

function normalizeOverlapWarnings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((warning) => ({
    matterName: stringValue(warning.matterName),
    overlapCount: Number(warning.overlapCount) || 0,
    totalIncoming: Number(warning.totalIncoming) || 0,
    matterTotalFiles: Number(warning.matterTotalFiles) || 0,
    overlapPercent: Number(warning.overlapPercent) || 0,
  })).filter((warning) => warning.matterName && warning.overlapCount > 0);
}

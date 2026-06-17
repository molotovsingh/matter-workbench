import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { Readable } from "node:stream";
import path from "node:path";
import process from "node:process";

import {
  classifyFile,
  FILE_REGISTER_HEADERS,
} from "../shared/matter-contract.mjs";
import { toCsv } from "../shared/csv.mjs";
import { makeHttpError, toPosix, validateRelativePath } from "../shared/safe-paths.mjs";
import {
  WORKSPACE_PREVIEW_LIMITS,
  getWorkspaceRawContentType,
  getWorkspaceTextPreviewLimit,
  isWorkspaceTextPreviewExtension,
} from "../shared/workspace-preview-policy.mjs";
import { runtimeDbUserFromRequestContext } from "./request-context.mjs";
import {
  runtimeArtifactMetadataForRow,
  runtimeArtifactMimeTypeForPath,
  runtimeArtifactRoleForPath,
} from "./runtime-db-artifact-policy.mjs";
import {
  planNewRuntimeMatterUpload,
  planRuntimeAddFilesUpload,
  validateRuntimeUploadInputs,
} from "./runtime-db-upload-intake-planner.mjs";
import { buildRuntimeUploadIntake } from "./runtime-db-upload-materializer.mjs";
import {
  normalizeRuntimeObjectKey,
  runtimeObjectKeyCandidates,
  runtimeObjectKeyForMatterPath,
  validatedRelativePathFromRuntimeObjectKey,
} from "./runtime-db-object-key-policy.mjs";
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
import { queryRuntimeDbJson } from "./runtime-db-query.mjs";
import { wrapRuntimeDbWriteTransaction } from "./runtime-db-sql-safety.mjs";
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
      const materializedPaths = await materializeWorkspacePayloads({
        matterRoot,
        matter: normalizedMatter,
        workspace,
        readPayloadRow,
      });
      for (const relativePath of materializedPaths) {
        const bytes = await readFile(path.join(matterRoot, ...relativePath.split("/")));
        initialHashes.set(relativePath, sha256Bytes(bytes));
      }
      await synthesizeMissingFileRegisters({ matterRoot, workspace });
      const operationResult = await operation({ matterRoot, matter: normalizedMatter });
      const files = await listMatterFiles(matterRoot);
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
      await materializeWorkspacePayloads({
        matterRoot,
        matter: normalizedMatter,
        workspace,
        readPayloadRow,
      });
      await synthesizeMissingFileRegisters({ matterRoot, workspace });
      return await operation({ matterRoot, matter: normalizedMatter });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async function materializeWorkspacePayloads({
    matterRoot,
    matter,
    workspace,
    readPayloadRow,
  }) {
    const materializedPaths = [];
    for (const item of runtimeWorkspaceFilePaths(workspace.tree)) {
      const relativePath = validateRelativePath(item.path);
      const payload = readPayloadRow({ matter, relativePath });
      const absolutePath = path.join(matterRoot, ...relativePath.split("/"));
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, payload.bytes);
      materializedPaths.push(relativePath);
    }
    if (!materializedPaths.includes("matter.json")) {
      const bytes = Buffer.from(`${JSON.stringify(runtimeMatterJson(matter), null, 2)}\n`);
      await writeFile(path.join(matterRoot, "matter.json"), bytes);
      materializedPaths.push("matter.json");
    }
    return materializedPaths;
  }

  async function synthesizeMissingFileRegisters({ matterRoot, workspace }) {
    let matterJson;
    try {
      matterJson = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
    } catch {
      return [];
    }
    const intakes = normalizeMatterJsonIntakes(matterJson);
    if (!intakes.length) return [];
    const fileNodes = runtimeWorkspaceFilePaths(workspace.tree);
    const created = [];

    for (const intake of intakes) {
      const intakeDir = normalizeMatterRelativePath(intake.intakeDir);
      const registerPath = `${intakeDir}/File Register.csv`;
      try {
        await readFile(path.join(matterRoot, ...registerPath.split("/")));
        continue;
      } catch {
        // Missing legacy register: synthesize from runtime DB custody rows below.
      }
      const sourcePrefix = `${intakeDir}/Source Files/`;
      const rows = fileNodes
        .filter((item) => item.path.startsWith(sourcePrefix) && item.fileId)
        .sort((a, b) => a.fileId.localeCompare(b.fileId, undefined, { numeric: true }))
        .map((item) => ({
          file_id: item.fileId,
          intake_id: intake.intakeId,
          source_path: item.path,
          original_path: item.path,
          working_copy_path: item.path,
          category: classifyFile(item.path),
          original_name: item.originalName || path.posix.basename(item.path),
          sha256: item.documentSha || item.sha256,
          size_bytes: String(item.documentSizeBytes || item.size || ""),
          duplicate_of: item.duplicateOf || "",
          status: item.duplicateOf ? "exact-duplicate" : "unique",
          engine_version: "runtime-db-storage-synthetic-register-v1",
          notes: "Synthesized from runtime DB document custody.",
        }));
      if (!rows.length) continue;
      const absoluteRegisterPath = path.join(matterRoot, ...registerPath.split("/"));
      await mkdir(path.dirname(absoluteRegisterPath), { recursive: true });
      await writeFile(absoluteRegisterPath, Buffer.from(toCsv(rows, FILE_REGISTER_HEADERS)));
      created.push(registerPath);
    }

    return created;
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
    checkUploadedFileOverlap,
    enabled,
    createMatterFromUploadedFiles,
    getRawFile,
    readMatterAttention,
    readMatterStatus,
    readPrepareMatterPlan,
    readFilePreview,
    readWorkspace,
    runMaterializedMatterRead,
    runMaterializedMatterWrite,
  };
}

export function isRuntimeDbStorageModeEnabled(env = process.env) {
  return String(env.MWB_RUNTIME_DB_STORAGE || "").trim().toLowerCase() === "postgres";
}

function buildWorkspaceSql({ tenantId, matter }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with target_matter as (",
    "  select",
    "    id, name, client_name, opposite_party, matter_type, jurisdiction, brief_description",
    "  from matters",
    "  where tenant_id = current_app_tenant_id()",
    `    and id = ${sqlUuid(matter.id)}`,
    "), object_rows as (",
    "  select distinct on (so.id)",
    "    so.object_key,",
    "    so.object_role,",
    "    so.mime_type,",
    "    coalesce(sop.size_bytes, so.size_bytes, 0)::bigint as size_bytes,",
    "    coalesce(sop.sha256, so.sha256, '') as sha256,",
    "    coalesce(sop.updated_at, sop.verified_at, so.verified_at, so.uploaded_at, so.updated_at, so.created_at) as updated_at,",
    "    coalesce(d.file_id, '') as file_id,",
    "    coalesce(d.original_name, '') as original_name,",
    "    coalesce(d.sha256, '') as document_sha,",
    "    coalesce(d.size_bytes, 0)::bigint as document_size_bytes,",
    "    coalesce(duplicate_source.file_id, '') as duplicate_of,",
    "    (sop.id is not null) as has_payload",
    "  from storage_objects so",
    "  join storage_object_payloads sop on sop.storage_object_id = so.id and sop.tenant_id = so.tenant_id",
    "  left join document_blobs db on db.storage_object_id = so.id and db.tenant_id = so.tenant_id and db.matter_id = so.matter_id and db.blob_kind = 'original'",
    "  left join documents d on d.id = db.document_id and d.tenant_id = db.tenant_id and d.matter_id = db.matter_id",
    "  left join documents duplicate_source on duplicate_source.id = d.duplicate_of_document_id and duplicate_source.tenant_id = d.tenant_id and duplicate_source.matter_id = d.matter_id",
    "  where so.tenant_id = current_app_tenant_id()",
    `    and so.matter_id = ${sqlUuid(matter.id)}`,
    "    and so.state in ('uploaded', 'verified')",
    "    and so.object_key is not null",
    "  order by so.id, d.file_id nulls last",
    ")",
    "select jsonb_build_object(",
    "  'matter', coalesce((select jsonb_build_object(",
    "    'id', id::text,",
    "    'name', name,",
    "    'matterName', name,",
    "    'clientName', coalesce(client_name, ''),",
    "    'oppositeParty', coalesce(opposite_party, ''),",
    "    'matterType', coalesce(matter_type, ''),",
    "    'jurisdiction', coalesce(jurisdiction, ''),",
    "    'briefDescription', coalesce(brief_description, '')",
    "  ) from target_matter), '{}'::jsonb),",
    "  'objects', coalesce((select jsonb_agg(jsonb_build_object(",
    "    'objectKey', object_key,",
    "    'objectRole', object_role,",
    "    'mimeType', coalesce(mime_type, ''),",
    "    'sizeBytes', size_bytes,",
    "    'sha256', coalesce(sha256, ''),",
    "    'updatedAt', updated_at,",
    "    'fileId', file_id,",
    "    'originalName', original_name,",
    "    'documentSha', document_sha,",
    "    'documentSizeBytes', document_size_bytes,",
    "    'duplicateOf', duplicate_of,",
    "    'hasPayload', has_payload",
    "  ) order by object_key) from object_rows), '[]'::jsonb)",
    ")::text;",
    "",
  ].join("\n");
}

function buildMatterByNameSql({ tenantId, name }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "select coalesce((",
    "  select jsonb_build_object('id', id::text, 'name', name)",
    "  from matters",
    "  where tenant_id = current_app_tenant_id()",
    "    and status = 'active'",
    `    and lower(name) = lower(${sqlString(name)})`,
    "  limit 1",
    "), '{}'::jsonb)::text;",
    "",
  ].join("\n");
}

function buildMatterAddFilesAllocationSql({
  tenantId,
  matter,
  expectedFileCount,
  label,
  receivedDate,
  actor,
}) {
  const uploadKeyPattern = `^runtime-db-upload:${matter.id}:([0-9]+)$`;
  const displayLabelSql = `coalesce(nullif(${sqlString(label)}, ''), 'Intake ' || lpad(a.next_intake_number::text, 2, '0'))`;
  return wrapRuntimeDbWriteTransaction([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    ...runtimeDbActorSqls({ actor, tenantId }),
    "with target_matter as (",
    "  select",
    "    id, name, client_name, opposite_party, matter_type, jurisdiction, brief_description, next_file_number",
    "  from matters",
    "  where tenant_id = current_app_tenant_id()",
    `    and id = ${sqlUuid(matter.id)}`,
    "    and status = 'active'",
    "  for update",
    "), object_state as (",
    "  select",
    "    coalesce(max(nullif(substring(so.object_key from 'Intake ([0-9]+)'), '')::int), 0) as max_intake_number",
    "  from storage_objects so",
    "  where so.tenant_id = current_app_tenant_id()",
    `    and so.matter_id = ${sqlUuid(matter.id)}`,
    "    and so.object_key is not null",
    "), upload_state as (",
    "  select",
    `    coalesce(max(nullif(substring(us.idempotency_key from ${sqlString(uploadKeyPattern)}), '')::int), 0) as max_upload_intake_number`,
    "  from upload_sessions us",
    "  where us.tenant_id = current_app_tenant_id()",
    `    and us.matter_id = ${sqlUuid(matter.id)}`,
    "), allocation as (",
    "  select",
    "    tm.*,",
    "    coalesce(tm.next_file_number, 1) as file_id_start,",
    "    greatest(coalesce(os.max_intake_number, 0), coalesce(us.max_upload_intake_number, 0)) + 1 as next_intake_number",
    "  from target_matter tm",
    "  cross join object_state os",
    "  cross join upload_state us",
    "), reserved_matter as (",
    "  update matters m",
    `  set next_file_number = coalesce(m.next_file_number, 1) + ${sqlInteger(expectedFileCount)}, updated_at = now()`,
    "  from allocation a",
    "  where m.tenant_id = current_app_tenant_id()",
    "    and m.id = a.id",
    "  returning m.id",
    "), reserved_intake as (",
    "  insert into matter_intakes (tenant_id, matter_id, label, received_at, created_by_user_id, created_at)",
    `  select current_app_tenant_id(), a.id, ${displayLabelSql}, ${sqlString(receivedDate)}::date, ${sqlUuidOrNull(actor?.id)}, now()`,
    "  from allocation a",
    "  returning id",
    "), reserved_upload as (",
    "  insert into upload_sessions (tenant_id, matter_id, intake_id, idempotency_key, created_by_user_id, status, expected_file_count, created_at)",
    `  select current_app_tenant_id(), a.id, ri.id, 'runtime-db-upload:' || a.id::text || ':' || a.next_intake_number::text, ${sqlUuidOrNull(actor?.id)}, 'pending', ${sqlInteger(expectedFileCount)}, now()`,
    "  from allocation a",
    "  cross join reserved_intake ri",
    "  returning id",
    ")",
    "select coalesce((",
    "  select jsonb_build_object(",
    "    'matter', jsonb_build_object(",
    "      'id', a.id::text,",
    "      'name', a.name,",
    "      'matterName', a.name,",
    "      'clientName', coalesce(a.client_name, ''),",
    "      'oppositeParty', coalesce(a.opposite_party, ''),",
    "      'matterType', coalesce(a.matter_type, ''),",
    "      'jurisdiction', coalesce(a.jurisdiction, ''),",
    "      'briefDescription', coalesce(a.brief_description, ''),",
    "      'nextFileNumber', a.file_id_start",
    "    ),",
    "    'nextIntakeNumber', a.next_intake_number,",
    "    'fileIdStart', a.file_id_start,",
    "    'intakeDbId', ri.id::text,",
    "    'uploadSessionId', ru.id::text,",
    `    'receivedDate', ${sqlString(receivedDate)}`,
    "  )",
    "  from allocation a",
    "  cross join reserved_matter rm",
    "  cross join reserved_intake ri",
    "  cross join reserved_upload ru",
    "), '{}'::jsonb)::text;",
    "",
  ].join("\n"));
}

function buildPayloadSql({ tenantId, matter, relativePath }) {
  const keys = runtimeObjectKeyCandidates({ matter, relativePath });
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with candidates as (",
    `  select unnest(${sqlTextArray(keys)}) as object_key`,
    "), payload_rows as (",
    "  select",
    "    so.object_key,",
    "    coalesce(so.mime_type, '') as mime_type,",
    "    coalesce(sop.size_bytes, so.size_bytes, 0)::bigint as size_bytes,",
    "    (sop.id is not null) as has_payload,",
    "    case when sop.id is null then '' else encode(sop.payload, 'base64') end as payload_base64",
    "  from candidates c",
    "  join storage_objects so on so.object_key = c.object_key and so.tenant_id = current_app_tenant_id()",
    "  left join storage_object_payloads sop on sop.storage_object_id = so.id and sop.tenant_id = so.tenant_id",
    `  where so.matter_id = ${sqlUuid(matter.id)}`,
    "    and so.state in ('uploaded', 'verified')",
    "  order by array_position(" + sqlTextArray(keys) + ", so.object_key)",
    "  limit 1",
    ")",
    "select coalesce((select jsonb_build_object(",
    "  'objectKey', object_key,",
    "  'mimeType', mime_type,",
    "  'sizeBytes', size_bytes,",
    "  'hasPayload', has_payload,",
    "  'payloadBase64', payload_base64",
    ") from payload_rows), '{}'::jsonb)::text;",
    "",
  ].join("\n");
}

function buildUploadOverlapSql({ tenantId, hashes }) {
  const incomingHashes = Array.isArray(hashes) ? hashes : [];
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with incoming as (",
    "  select row_number() over () as ordinal, lower(value) as sha256",
    `  from unnest(${sqlTextArray(incomingHashes)}) as value`,
    "), incoming_count as (",
    "  select count(*)::int as total_incoming from incoming",
    "), matter_totals as (",
    "  select matter_id, count(*)::int as matter_total_files",
    "  from documents d",
    "  where d.tenant_id = current_app_tenant_id()",
    "    and d.status <> 'deleted_pending'",
    "  group by matter_id",
    "), overlap_rows as (",
    "  select",
    "    m.name as matter_name,",
    "    count(i.ordinal)::int as overlap_count,",
    "    coalesce(mt.matter_total_files, 0)::int as matter_total_files,",
    "    ic.total_incoming",
    "  from matters m",
    "  cross join incoming_count ic",
    "  join incoming i on exists (",
    "    select 1",
    "    from documents d",
    "    where d.tenant_id = current_app_tenant_id()",
    "      and d.matter_id = m.id",
    "      and d.status <> 'deleted_pending'",
    "      and lower(coalesce(d.sha256, '')) = i.sha256",
    "  )",
    "  left join matter_totals mt on mt.matter_id = m.id",
    "  where m.tenant_id = current_app_tenant_id()",
    "    and m.status = 'active'",
    "  group by m.name, mt.matter_total_files, ic.total_incoming",
    ")",
    "select jsonb_build_object(",
    "  'warnings', coalesce((select jsonb_agg(jsonb_build_object(",
    "    'matterName', matter_name,",
    "    'overlapCount', overlap_count,",
    "    'totalIncoming', total_incoming,",
    "    'matterTotalFiles', matter_total_files,",
    "    'overlapPercent', case when total_incoming > 0 then round((overlap_count::numeric / total_incoming::numeric) * 100)::int else 0 end",
    "  ) order by case when total_incoming > 0 then round((overlap_count::numeric / total_incoming::numeric) * 100)::int else 0 end desc, matter_name) from overlap_rows), '[]'::jsonb)",
    ")::text;",
    "",
  ].join("\n");
}

function buildAdvisorySnapshotSql({ tenantId, matter }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with latest_snapshot as (",
    "  select",
    "    pas.rendered_summary_json,",
    "    pas.created_at,",
    "    m.name as matter_name",
    "  from preparation_advisory_snapshots pas",
    "  join matters m on m.id = pas.matter_id and m.tenant_id = pas.tenant_id",
    "  where pas.tenant_id = current_app_tenant_id()",
    `    and pas.matter_id = ${sqlUuid(matter.id)}`,
    "  order by pas.created_at desc",
    "  limit 1",
    ")",
    "select coalesce((select jsonb_build_object(",
    "  'schema_version', 'matter-attention/v1',",
    "  'generated_at', created_at,",
    "  'matterName', matter_name,",
    "  'matterRoot', 'postgres:' || matter_name,",
    "  'summary', coalesce(rendered_summary_json->'summary', '{}'::jsonb),",
    "  'items', coalesce(rendered_summary_json->'items', '[]'::jsonb)",
    ") from latest_snapshot), '{}'::jsonb)::text;",
    "",
  ].join("\n");
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

async function listMatterFiles(root, relativePrefix = "") {
  const rows = [];
  const directory = relativePrefix ? path.join(root, ...relativePrefix.split("/")) : root;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" && relativePrefix) return rows;
    throw error;
  }
  for (const entry of entries) {
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      rows.push(...await listMatterFiles(root, relativePath));
      continue;
    }
    if (entry.isFile()) rows.push({ relativePath: normalizeRuntimeObjectKey(relativePath) });
  }
  return rows.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function persistMaterializedFiles({ databaseUrl, tenantId, spawn, matter, files }) {
  const rows = materializedRowsForFiles({ matter, files });
  const sql = wrapRuntimeDbWriteTransaction([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    ...rows.flatMap((row) => [
      ...materializedFileUpsertSql({ matter, row }),
      ...matterArtifactUpsertSql({ matter, row }),
      ...extractionRecordUpsertSql({ matter, row }),
      ...sourceDescriptorUpsertSql({ matter, row }),
    ]),
    "select '{}'::jsonb::text;",
    "",
  ].join("\n"));
  queryJson({
    databaseUrl,
    tenantId,
    spawn,
    sql,
  });
  return rows.map(({ relativePath, objectKey, objectRole, sizeBytes, sha256 }) => ({
    relativePath,
    objectKey,
    objectRole,
    sizeBytes,
    sha256,
  }));
}

function persistMaterializedDeletions({ databaseUrl, tenantId, spawn, matter, files }) {
  const rows = files
    .map((file) => {
      const relativePath = normalizeRuntimeObjectKey(file.relativePath);
      return {
        relativePath,
        objectKey: normalizeRuntimeObjectKey(file.objectKey || runtimeObjectKeyForMatterPath({ matter, relativePath })),
      };
    })
    .filter((row) => row.relativePath && row.objectKey);
  if (!rows.length) return [];
  const sql = wrapRuntimeDbWriteTransaction([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    ...rows.flatMap((row) => materializedFileTombstoneSql({ matter, row })),
    "select '{}'::jsonb::text;",
    "",
  ].join("\n"));
  queryJson({
    databaseUrl,
    tenantId,
    spawn,
    sql,
  });
  return rows.map(({ relativePath, objectKey }) => ({ relativePath, objectKey }));
}

function materializedRowsForFiles({ matter, files }) {
  const rows = [];
  for (const file of files) {
    const objectKey = runtimeObjectKeyForMatterPath({ matter, relativePath: file.relativePath });
    const storageObjectId = deterministicUuid(`runtime-storage:${matter.id}:${objectKey}`);
    const payloadId = deterministicUuid(`runtime-storage-payload:${storageObjectId}`);
    rows.push({
      relativePath: file.relativePath,
      objectKey,
      storageObjectId,
      payloadId,
      objectRole: file.objectRole,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      payloadHex: Buffer.from(file.bytes).toString("hex"),
    });
  }
  return rows;
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

function buildRuntimeUploadPersistenceSql({
  tenantId,
  actor,
  matter,
  uploadPlan,
  importItems,
  persistedRows,
  uploadSqls,
}) {
  return wrapRuntimeDbWriteTransaction([
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    ...runtimeDbActorSqls({ actor, tenantId }),
    ...uploadSqls,
    ...persistedRows.flatMap((row) => materializedFileUpsertSql({ matter, row })),
    ...documentIdentityUpsertSqls({
      matter,
      intakeId: uploadPlan.intakeDbId,
      uploadSessionId: uploadPlan.uploadSessionId,
      importItems,
      persistedRows,
    }),
    ...matterImportItemUpsertSqls({ matter, importBatchId: uploadPlan.importBatchId, importItems, persistedRows }),
    "select '{}'::jsonb::text;",
    "",
  ].join("\n"));
}

function createMatterUploadSql({
  matter,
  actor,
  intakeId,
  uploadSessionId,
  importBatchId,
  importItems,
  expectedFileCount,
  receivedDate,
}) {
  return [
    "insert into matters (id, tenant_id, created_by_user_id, name, client_name, opposite_party, matter_type, jurisdiction, brief_description, status, next_file_number, created_at, updated_at)",
    `values (${sqlUuid(matter.id)}, current_app_tenant_id(), ${sqlUuidOrNull(actor?.id)}, ${sqlString(matter.name)}, ${sqlString(matter.clientName)}, ${sqlString(matter.oppositeParty)}, ${sqlString(matter.matterType)}, ${sqlString(matter.jurisdiction)}, ${sqlString(matter.briefDescription)}, 'active', ${sqlInteger(expectedFileCount + 1)}, now(), now())`,
    "on conflict (id) do update set",
    "  name = excluded.name,",
    "  created_by_user_id = coalesce(matters.created_by_user_id, excluded.created_by_user_id),",
    "  client_name = excluded.client_name,",
    "  opposite_party = excluded.opposite_party,",
    "  matter_type = excluded.matter_type,",
    "  jurisdiction = excluded.jurisdiction,",
    "  brief_description = excluded.brief_description,",
    "  next_file_number = excluded.next_file_number,",
    "  updated_at = excluded.updated_at;",
    ...matterMembershipSqls({ matter, actor }),
    "insert into matter_intakes (id, tenant_id, matter_id, label, received_at, created_by_user_id, created_at)",
    `values (${sqlUuid(intakeId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, 'Initial', ${sqlString(receivedDate)}::date, ${sqlUuidOrNull(actor?.id)}, now())`,
    "on conflict (id) do nothing;",
    "insert into upload_sessions (id, tenant_id, matter_id, intake_id, idempotency_key, created_by_user_id, status, expected_file_count, created_at, finished_at)",
    `values (${sqlUuid(uploadSessionId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(intakeId)}, ${sqlString(`runtime-db-upload:${matter.id}:1`)}, ${sqlUuidOrNull(actor?.id)}, 'verified', ${sqlInteger(expectedFileCount)}, now(), now())`,
    "on conflict (tenant_id, idempotency_key) do update set status = excluded.status, expected_file_count = excluded.expected_file_count, finished_at = excluded.finished_at;",
    "insert into matter_import_batches (id, tenant_id, matter_id, created_by_user_id, source_kind, source_label, source_root_hint, collision_policy, status, idempotency_key, files_expected, files_imported, files_failed, started_at, finished_at)",
    `values (${sqlUuid(importBatchId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuidOrNull(actor?.id)}, 'zip_upload', ${sqlString(matter.name)}, ${sqlString(matter.name)}, 'fail_closed', 'succeeded', ${sqlString(`runtime-db-upload:${matter.id}:import:1`)}, ${sqlInteger(expectedFileCount)}, ${sqlInteger(expectedFileCount)}, 0, now(), now())`,
    "on conflict (tenant_id, idempotency_key) do update set files_expected = excluded.files_expected, files_imported = excluded.files_imported, files_failed = excluded.files_failed, status = excluded.status, finished_at = excluded.finished_at;",
  ];
}

function runtimeDbActorSqls({ actor, tenantId }) {
  if (!actor?.id) return [];
  const tenantRole = actor.role === "superuser" || actor.role === "operator" ? "admin" : "member";
  return [
    "insert into users (id, email, name, status, created_at, updated_at)",
    `values (${sqlUuid(actor.id)}, ${sqlString(actor.email)}, ${sqlString(actor.displayName || actor.username)}, 'active', now(), now())`,
    "on conflict (id) do update set",
    "  email = excluded.email,",
    "  name = excluded.name,",
    "  status = 'active',",
    "  updated_at = excluded.updated_at;",
    "insert into tenant_memberships (id, tenant_id, user_id, role, status, created_at, updated_at)",
    `values (${sqlUuid(deterministicUuid(`runtime-db-tenant-membership:${tenantId}:${actor.id}`))}, current_app_tenant_id(), ${sqlUuid(actor.id)}, ${sqlString(tenantRole)}, 'active', now(), now())`,
    "on conflict (tenant_id, user_id) do update set",
    "  role = excluded.role,",
    "  status = excluded.status,",
    "  updated_at = excluded.updated_at;",
  ];
}

function matterMembershipSqls({ matter, actor }) {
  if (!actor?.id || !matter?.id) return [];
  return [
    "insert into matter_memberships (id, tenant_id, matter_id, user_id, role, status, created_at, updated_at)",
    `values (${sqlUuid(deterministicUuid(`runtime-db-matter-membership:${matter.id}:${actor.id}`))}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(actor.id)}, 'owner', 'active', now(), now())`,
    "on conflict (matter_id, user_id) do update set",
    "  role = excluded.role,",
    "  status = excluded.status,",
    "  updated_at = excluded.updated_at;",
  ];
}

function createMatterAddFilesSql({
  matter,
  actor,
  intakeDbId,
  intakeNumber,
  uploadSessionId,
  importBatchId,
  importItems,
  expectedFileCount,
  label,
  receivedDate,
}) {
  const displayLabel = stringValue(label) || `Intake ${String(intakeNumber).padStart(2, "0")}`;
  return [
    ...matterMembershipSqls({ matter, actor }),
    "insert into matter_intakes (id, tenant_id, matter_id, label, received_at, created_by_user_id, created_at)",
    `values (${sqlUuid(intakeDbId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlString(displayLabel)}, ${sqlString(receivedDate)}::date, ${sqlUuidOrNull(actor?.id)}, now())`,
    "on conflict (id) do nothing;",
    "insert into upload_sessions (id, tenant_id, matter_id, intake_id, idempotency_key, created_by_user_id, status, expected_file_count, created_at, finished_at)",
    `values (${sqlUuid(uploadSessionId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(intakeDbId)}, ${sqlString(`runtime-db-upload:${matter.id}:${intakeNumber}`)}, ${sqlUuidOrNull(actor?.id)}, 'verified', ${sqlInteger(expectedFileCount)}, now(), now())`,
    "on conflict (tenant_id, idempotency_key) do update set status = excluded.status, expected_file_count = excluded.expected_file_count, finished_at = excluded.finished_at;",
    "insert into matter_import_batches (id, tenant_id, matter_id, created_by_user_id, source_kind, source_label, source_root_hint, collision_policy, status, idempotency_key, files_expected, files_imported, files_failed, started_at, finished_at)",
    `values (${sqlUuid(importBatchId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuidOrNull(actor?.id)}, 'zip_upload', ${sqlString(displayLabel)}, ${sqlString(matter.name)}, 'fail_closed', 'succeeded', ${sqlString(`runtime-db-upload:${matter.id}:import:${intakeNumber}`)}, ${sqlInteger(expectedFileCount)}, ${sqlInteger(expectedFileCount)}, 0, now(), now())`,
    "on conflict (tenant_id, idempotency_key) do update set files_expected = excluded.files_expected, files_imported = excluded.files_imported, files_failed = excluded.files_failed, status = excluded.status, finished_at = excluded.finished_at;",
  ];
}

function matterImportItemUpsertSqls({ matter, importBatchId, importItems, persistedRows }) {
  const storageByRelativePath = new Map(persistedRows.map((row) => [row.relativePath, row]));
  return importItems.map((item) => {
    const row = storageRowForImportItem(storageByRelativePath, item);
    if (!row) throw new Error(`Runtime DB upload did not persist a source payload for ${item.fileId}`);
    const documentId = documentIdForImportItem(matter, item);
    return [
      "insert into matter_import_items (id, tenant_id, import_batch_id, matter_id, document_id, storage_object_id, original_file_id, original_relative_path, source_sha256, target_file_number, target_file_id, status)",
      `values (${sqlUuid(deterministicUuid(`runtime-db-import-item:${importBatchId}:${item.relativePath}`))}, current_app_tenant_id(), ${sqlUuid(importBatchId)}, ${sqlUuid(matter.id)}, ${sqlUuid(documentId)}, ${sqlUuid(row.storageObjectId)}, ${sqlString(item.fileId)}, ${sqlString(item.originalRelativePath)}, ${sqlString(item.sha256)}, ${sqlInteger(item.fileNumber)}, ${sqlString(item.fileId)}, 'imported')`,
      "on conflict (tenant_id, import_batch_id, original_relative_path) do update set document_id = excluded.document_id, storage_object_id = excluded.storage_object_id, source_sha256 = excluded.source_sha256, target_file_number = excluded.target_file_number, target_file_id = excluded.target_file_id, status = excluded.status;",
    ].join("\n");
  });
}

function documentIdentityUpsertSqls({ matter, intakeId, uploadSessionId, importItems, persistedRows }) {
  const storageByRelativePath = new Map(persistedRows.map((row) => [row.relativePath, row]));
  return importItems.flatMap((item) => {
    const row = storageRowForImportItem(storageByRelativePath, item);
    if (!row) throw new Error(`Runtime DB upload did not persist a source payload for ${item.fileId}`);
    const documentId = documentIdForImportItem(matter, item);
    const blobId = documentBlobIdForImportItem(matter, item);
    const originalName = path.posix.basename(normalizeRuntimeObjectKey(item.originalRelativePath || item.relativePath));
    const duplicateDocumentIdSql = duplicateDocumentIdForImportItemSql({ matter, item });
    return [
      [
        "insert into documents (id, tenant_id, matter_id, intake_id, upload_session_id, file_number, file_id, original_name, category, sha256, size_bytes, duplicate_of_document_id, status)",
        `values (${sqlUuid(documentId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(intakeId)}, ${sqlUuid(uploadSessionId)}, ${sqlInteger(item.fileNumber)}, ${sqlString(item.fileId)}, ${sqlString(originalName)}, 'source_upload', ${sqlString(item.sha256)}, ${sqlInteger(row.sizeBytes)}, ${duplicateDocumentIdSql}, 'verified')`,
        "on conflict (matter_id, file_id) do update set",
        "  intake_id = excluded.intake_id,",
        "  upload_session_id = excluded.upload_session_id,",
        "  file_number = excluded.file_number,",
        "  original_name = excluded.original_name,",
        "  category = excluded.category,",
        "  sha256 = excluded.sha256,",
        "  size_bytes = excluded.size_bytes,",
        "  duplicate_of_document_id = excluded.duplicate_of_document_id,",
        "  status = excluded.status,",
        "  updated_at = now();",
      ].join("\n"),
      [
        "insert into document_blobs (id, tenant_id, matter_id, document_id, blob_kind, object_key, mime_type, size_bytes, sha256, state, storage_object_id, verified_at)",
        `values (${sqlUuid(blobId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(documentId)}, 'original', ${sqlString(row.objectKey)}, ${sqlString(row.mimeType)}, ${sqlInteger(row.sizeBytes)}, ${sqlString(row.sha256)}, 'verified', ${sqlUuid(row.storageObjectId)}, now())`,
        "on conflict (tenant_id, object_key) do update set",
        "  document_id = excluded.document_id,",
        "  blob_kind = excluded.blob_kind,",
        "  mime_type = excluded.mime_type,",
        "  size_bytes = excluded.size_bytes,",
        "  sha256 = excluded.sha256,",
        "  state = excluded.state,",
        "  storage_object_id = excluded.storage_object_id,",
        "  verified_at = excluded.verified_at;",
      ].join("\n"),
    ];
  });
}

function storageRowForImportItem(storageByRelativePath, item) {
  for (const candidate of [item.workingCopyPath, item.originalPath, item.relativePath]) {
    const normalized = normalizeRuntimeObjectKey(candidate);
    if (!normalized) continue;
    const row = storageByRelativePath.get(normalized);
    if (row) return row;
  }
  return null;
}

function documentIdForImportItem(matter, item) {
  return deterministicUuid(`runtime-db-document:${matter.id}:${item.fileId}`);
}

function documentBlobIdForImportItem(matter, item) {
  return deterministicUuid(`runtime-db-document-blob:${matter.id}:${item.fileId}:original`);
}

function duplicateDocumentIdForImportItemSql({ matter, item }) {
  const duplicateOf = stringValue(item.duplicateOf).toUpperCase();
  if (!/^FILE-\d{4}$/.test(duplicateOf) || duplicateOf === item.fileId) return "null";
  return [
    "(select id from documents",
    " where tenant_id = current_app_tenant_id()",
    `   and matter_id = ${sqlUuid(matter.id)}`,
    `   and file_id = ${sqlString(duplicateOf)}`,
    " limit 1)",
  ].join("");
}

function materializedFileUpsertSql({ matter, row }) {
  return [
    "insert into storage_objects (id, tenant_id, matter_id, object_key, bucket, storage_provider, object_role, state, mime_type, size_bytes, sha256, idempotency_key, uploaded_at, verified_at)",
    `values (${sqlUuid(row.storageObjectId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlString(row.objectKey)}, 'local-db-runtime', 'postgres', ${sqlString(row.objectRole)}, 'verified', ${sqlString(row.mimeType)}, ${sqlInteger(row.sizeBytes)}, ${sqlString(row.sha256)}, ${sqlString(`runtime-db:${row.objectKey}`)}, now(), now())`,
    "on conflict (tenant_id, object_key) do update set",
    "  matter_id = excluded.matter_id,",
    "  bucket = excluded.bucket,",
    "  storage_provider = excluded.storage_provider,",
    "  object_role = excluded.object_role,",
    "  state = excluded.state,",
    "  mime_type = excluded.mime_type,",
    "  size_bytes = excluded.size_bytes,",
    "  sha256 = excluded.sha256,",
    "  idempotency_key = excluded.idempotency_key,",
    "  uploaded_at = excluded.uploaded_at,",
    "  verified_at = excluded.verified_at;",
    "insert into storage_object_payloads (id, tenant_id, matter_id, storage_object_id, payload, sha256, size_bytes, verified_at)",
    `values (${sqlUuid(row.payloadId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlUuid(row.storageObjectId)}, decode(${sqlString(row.payloadHex)}, 'hex'), ${sqlString(row.sha256)}, ${sqlInteger(row.sizeBytes)}, now())`,
    "on conflict (tenant_id, storage_object_id) do update set",
    "  matter_id = excluded.matter_id,",
    "  payload = excluded.payload,",
    "  sha256 = excluded.sha256,",
    "  size_bytes = excluded.size_bytes,",
    "  verified_at = excluded.verified_at;",
  ];
}

function materializedFileTombstoneSql({ matter, row }) {
  return [
    "update storage_objects",
    "set state = 'deleted_pending', deleted_at = now(), updated_at = now()",
    "where tenant_id = current_app_tenant_id()",
    `  and matter_id = ${sqlUuid(matter.id)}`,
    `  and object_key = ${sqlString(row.objectKey)}`,
    "  and state in ('pending', 'uploading', 'uploaded', 'verified', 'failed', 'orphaned');",
    "update matter_artifacts",
    "set is_current = false",
    "where tenant_id = current_app_tenant_id()",
    `  and matter_id = ${sqlUuid(matter.id)}`,
    `  and object_key = ${sqlString(row.objectKey)};`,
    "update extraction_records",
    "set superseded_at = now()",
    "where tenant_id = current_app_tenant_id()",
    `  and matter_id = ${sqlUuid(matter.id)}`,
    "  and superseded_at is null",
    "  and storage_object_id in (",
    "    select id from storage_objects",
    "    where tenant_id = current_app_tenant_id()",
    `      and matter_id = ${sqlUuid(matter.id)}`,
    `      and object_key = ${sqlString(row.objectKey)}`,
    "  );",
    "update source_descriptors",
    "set superseded_at = now(), updated_at = now()",
    "where tenant_id = current_app_tenant_id()",
    `  and matter_id = ${sqlUuid(matter.id)}`,
    "  and superseded_at is null",
    "  and storage_object_id in (",
    "    select id from storage_objects",
    "    where tenant_id = current_app_tenant_id()",
    `      and matter_id = ${sqlUuid(matter.id)}`,
    `      and object_key = ${sqlString(row.objectKey)}`,
    "  );",
  ];
}

function matterArtifactUpsertSql({ matter, row }) {
  const artifact = runtimeArtifactMetadataForRow(row);
  if (!artifact) return [];
  const artifactId = deterministicUuid(`runtime-db-artifact:${matter.id}:${row.objectKey}`);
  return [
    "update matter_artifacts",
    "set is_current = false",
    "where tenant_id = current_app_tenant_id()",
    `  and matter_id = ${sqlUuid(matter.id)}`,
    `  and artifact_family = ${sqlString(artifact.family)}`,
    `  and mode = ${sqlString(artifact.mode)}`,
    `  and profile_key = ${sqlString(artifact.profileKey)}`,
    `  and format = ${sqlString(artifact.format)}`,
    `  and id <> ${sqlUuid(artifactId)};`,
    "insert into matter_artifacts (id, tenant_id, matter_id, artifact_family, mode, profile_key, format, object_key, content_hash, storage_object_id, is_current, created_at)",
    `values (${sqlUuid(artifactId)}, current_app_tenant_id(), ${sqlUuid(matter.id)}, ${sqlString(artifact.family)}, ${sqlString(artifact.mode)}, ${sqlString(artifact.profileKey)}, ${sqlString(artifact.format)}, ${sqlString(row.objectKey)}, ${sqlString(row.sha256)}, ${sqlUuid(row.storageObjectId)}, true, now())`,
    "on conflict (id) do update set",
    "  object_key = excluded.object_key,",
    "  content_hash = excluded.content_hash,",
    "  storage_object_id = excluded.storage_object_id,",
    "  is_current = excluded.is_current;",
  ];
}

function extractionRecordUpsertSql({ matter, row }) {
  if (row.objectRole !== "extraction_payload") return [];
  const fileId = fileIdForExtractionPayloadPath(row.relativePath);
  if (!fileId) return [];
  const extractionId = deterministicUuid(`runtime-db-extraction:${matter.id}:${fileId}:${row.objectKey}`);
  return [
    "insert into extraction_records (id, tenant_id, matter_id, document_id, document_blob_id, status, engine, ocr_applied, needs_review, payload_object_key, content_hash, storage_object_id, created_at)",
    "values (",
    `  ${sqlUuid(extractionId)},`,
    "  current_app_tenant_id(),",
    `  ${sqlUuid(matter.id)},`,
    "  (select id from documents where tenant_id = current_app_tenant_id() and matter_id = " + sqlUuid(matter.id) + " and file_id = " + sqlString(fileId) + " limit 1),",
    "  (select db.id from document_blobs db join documents d on d.id = db.document_id and d.tenant_id = db.tenant_id where db.tenant_id = current_app_tenant_id() and db.matter_id = " + sqlUuid(matter.id) + " and d.file_id = " + sqlString(fileId) + " and db.blob_kind = 'original' order by db.created_at desc limit 1),",
    "  'succeeded',",
    "  'materialized-extract',",
    "  false,",
    "  false,",
    `  ${sqlString(row.objectKey)},`,
    `  ${sqlString(row.sha256)},`,
    `  ${sqlUuid(row.storageObjectId)},`,
    "  now()",
    ")",
    "on conflict (id) do update set",
    "  status = excluded.status,",
    "  engine = excluded.engine,",
    "  payload_object_key = excluded.payload_object_key,",
    "  content_hash = excluded.content_hash,",
    "  storage_object_id = excluded.storage_object_id;",
  ];
}

function sourceDescriptorUpsertSql({ matter, row }) {
  if (normalizeRuntimeObjectKey(row.relativePath) !== "10_Library/Source Index.json") return [];
  let artifact;
  try {
    artifact = JSON.parse(Buffer.from(row.payloadHex || "", "hex").toString("utf8"));
  } catch {
    return [];
  }
  const sources = Array.isArray(artifact?.sources) ? artifact.sources : [];
  return sources.flatMap((source, index) => {
    const fileId = stringValue(source.file_id || source.source_id).toUpperCase();
    if (!/^FILE-\d{4}$/.test(fileId)) return [];
    const descriptorId = deterministicUuid(`runtime-db-source-descriptor:${matter.id}:${fileId}`);
    const labelStatus = normalizeSourceLabelStatus(source.label_status);
    return [
      "insert into source_descriptors (id, tenant_id, matter_id, document_id, extraction_record_id, suggested_label, confirmed_label, label_status, label_source, document_type, document_date, needs_review, storage_object_id, created_at, updated_at)",
      "values (",
      `  ${sqlUuid(descriptorId)},`,
      "  current_app_tenant_id(),",
      `  ${sqlUuid(matter.id)},`,
      "  (select id from documents where tenant_id = current_app_tenant_id() and matter_id = " + sqlUuid(matter.id) + " and file_id = " + sqlString(fileId) + " limit 1),",
      "  (select id from extraction_records where tenant_id = current_app_tenant_id() and matter_id = " + sqlUuid(matter.id) + " and document_id = (select id from documents where tenant_id = current_app_tenant_id() and matter_id = " + sqlUuid(matter.id) + " and file_id = " + sqlString(fileId) + " limit 1) order by created_at desc limit 1),",
      `  ${sqlString(stringValue(source.source_label || source.suggested_label) || fileId)},`,
      `  ${sqlNullableString(source.confirmed_label)},`,
      `  ${sqlString(labelStatus)},`,
      `  ${sqlString(stringValue(source.label_source) || "model")},`,
      `  ${sqlString(stringValue(source.document_type))},`,
      `  ${sqlDateOrNull(source.document_date)},`,
      `  ${sqlBoolean(Boolean(source.needs_review) || labelStatus === "needs_review")},`,
      `  ${sqlUuid(row.storageObjectId)},`,
      "  now(),",
      "  now()",
      ")",
      "on conflict (id) do update set",
      "  extraction_record_id = excluded.extraction_record_id,",
      "  suggested_label = excluded.suggested_label,",
      "  confirmed_label = excluded.confirmed_label,",
      "  label_status = excluded.label_status,",
      "  label_source = excluded.label_source,",
      "  document_type = excluded.document_type,",
      "  document_date = excluded.document_date,",
      "  needs_review = excluded.needs_review,",
      "  storage_object_id = excluded.storage_object_id,",
      "  updated_at = excluded.updated_at;",
    ].join("\n");
  });
}

function normalizeSourceLabelStatus(value) {
  const status = stringValue(value);
  if (["suggested", "confirmed", "overridden", "needs_review"].includes(status)) return status;
  return "suggested";
}

function fileIdForExtractionPayloadPath(relativePath) {
  const normalized = normalizeRuntimeObjectKey(relativePath);
  const match = normalized.match(/(^|\/)_extracted\/(FILE-\d{4})\.json$/i);
  return match ? match[2].toUpperCase() : "";
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

function runtimeMatterJson(matter = {}) {
  return {
    matter_name: stringValue(matter.matterName || matter.name),
    client_name: stringValue(matter.clientName),
    opposite_party: stringValue(matter.oppositeParty),
    matter_type: stringValue(matter.matterType),
    jurisdiction: stringValue(matter.jurisdiction),
    brief_description: stringValue(matter.briefDescription),
    intakes: [],
  };
}

function normalizeMatterJsonIntakes(matterJson = {}) {
  const intakes = Array.isArray(matterJson.intakes) ? matterJson.intakes : [];
  return intakes
    .map((intake, index) => ({
      intakeId: stringValue(intake.intake_id || intake.intakeId) || `INTAKE-${String(index + 1).padStart(2, "0")}`,
      intakeDir: stringValue(intake.intake_dir || intake.intakeDir),
    }))
    .filter((intake) => intake.intakeDir);
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

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function sqlUuidOrNull(value) {
  return stringValue(value) ? sqlUuid(value) : "null";
}

function sqlInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "0";
}

function sqlTextArray(values = []) {
  if (!values.length) return "ARRAY[]::text[]";
  return `ARRAY[${values.map((value) => sqlString(value)).join(", ")}]::text[]`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlNullableString(value) {
  const text = stringValue(value);
  return text ? sqlString(text) : "null";
}

function sqlDateOrNull(value) {
  const text = stringValue(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${sqlString(text)}::date` : "null";
}

function sqlBoolean(value) {
  return value ? "true" : "false";
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

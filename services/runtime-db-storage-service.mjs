import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import os from "node:os";
import { Readable } from "node:stream";
import path from "node:path";
import process from "node:process";

import { buildCreateListOfDatesFromRecords } from "../create-listofdates-engine.mjs";
import { buildCreateListOfDatesTwoPassFromRecords } from "../listofdates/two-pass-runner.mjs";
import { isTwoPassListOfDatesEnabled } from "../listofdates/run-config.mjs";
import { buildListOfDatesSourceLabelRefresh } from "./listofdates-label-refresh-service.mjs";
import { buildSourceDescriptorsFromRecords } from "../source-descriptors-engine.mjs";
import {
  CASE_TIMELINE_SKILL_SLASH,
  LEGACY_LIST_OF_DATES_SKILL_SLASH,
} from "../shared/case-timeline-operation.mjs";
import { CASE_TIMELINE_JSON_RELATIVE_CANDIDATES, SOURCE_INDEX_RELATIVE } from "../shared/matter-artifacts.mjs";
import { makeHttpError, toPosix } from "../shared/safe-paths.mjs";
import { planNewMatterIdentity } from "../shared/upload-intake-planner.mjs";
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
import { readUploadFilePayloadBytes } from "./upload-file-payload.mjs";
import { validatedRelativePathFromRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";
import {
  buildRuntimeWorkspaceTree,
  normalizeRuntimeWorkspaceObjectRow,
  publicRuntimeWorkspaceTree,
  runtimeWorkspaceFilePaths,
} from "./runtime-db-workspace-read-model.mjs";
import {
  runtimeMatterStatusFromWorkspaceState,
  runtimePrepareMatterPlanFromStatus,
} from "./runtime-db-preparation-read-model.mjs";
import { buildDiagnosisStatus } from "./procedural-posture-diagnosis-service.mjs";
import { sha256Bytes } from "./runtime-db-bytes.mjs";
import {
  buildMaterializedDeletionPersistenceSql,
  buildMaterializedFilePersistenceSql,
  materializedDeletionRowsForFiles,
  materializedRowsForFiles,
  summarizeMaterializedDeletionRows,
  summarizeMaterializedRows,
} from "./runtime-db-materialized-persistence-sql.mjs";
import { runRuntimeDbDoctorFix } from "./runtime-db-doctor-fix.mjs";
import { runRuntimeDbDoctorScan } from "./runtime-db-doctor-scan.mjs";
import { buildRuntimeDbMatterContextPacket } from "./runtime-db-matter-context-packet.mjs";
import { runRuntimeDbExtract } from "./runtime-db-extract-service.mjs";
import { buildRuntimeDbMatterInit } from "./runtime-db-matter-init-service.mjs";
import {
  queryRuntimeDbJson,
  redactRuntimeDbError,
} from "./runtime-db-query.mjs";
import { runtimeDbSafeRoleGuardSql } from "./runtime-db-sql-safety.mjs";
import { createRuntimeDbProcessingJobStore } from "./runtime-db-processing-job-store.mjs";
import { createRuntimeDbSourceRemovalPreviewStore } from "./runtime-db-source-removal-preview-store.mjs";
import {
  buildAdvisorySnapshotSql,
  buildMatterAddFilesAllocationSql,
  buildMatterByNameSql,
  buildPayloadSql,
  buildUploadOverlapSql,
  buildWorkspaceSql,
} from "./runtime-db-storage-query-sql.mjs";
import { parseCsv } from "../shared/csv.mjs";
import { stringValue } from "./runtime-db-sql-format.mjs";
import {
  buildRuntimeUploadPersistenceSql,
  createMatterAddFilesSessionCommitSql,
  createMatterAddFilesSql,
  createMatterSessionCommitSql,
  createMatterUploadSql,
  runtimeUploadPayloadUpsertQuery,
  runtimeDbActorSqls,
} from "./runtime-db-upload-persistence-sql.mjs";
import { isBlockedWorkspacePath } from "./workspace-path-policy.mjs";

const {
  maxRawBytes,
} = WORKSPACE_PREVIEW_LIMITS;
const DEFAULT_PSQL_MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const DEFAULT_RUNTIME_UPLOAD_PARAMETERIZED_THRESHOLD_BYTES = 32 * 1024 * 1024;

export function createRuntimeDbStorageService({
  databaseUrl = "",
  tenantId = "",
  spawn = spawnSync,
  tempRoot = os.tmpdir(),
  createPgClient = defaultCreatePgClient,
  runtimeUploadParameterizedThresholdBytes = DEFAULT_RUNTIME_UPLOAD_PARAMETERIZED_THRESHOLD_BYTES,
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);
  const matterWriteQueues = new Map();
  const {
    claimNextProcessingJob,
    completeProcessingJob,
    enqueueProcessingJob,
    failProcessingJob,
    listProcessingJobs,
  } = createRuntimeDbProcessingJobStore({
    withRuntimeDbClient,
    ensureEnabled,
    actorProvider: runtimeDbUserFromRequestContext,
    persistActor: persistRuntimeDbActor,
    normalizeMatter,
  });
  const { readSourceRemovalPreviewState } = createRuntimeDbSourceRemovalPreviewStore({
    withRuntimeDbClient,
    ensureEnabled,
    normalizeMatter,
  });

  async function readWorkspace(matter) {
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    const matterJson = await readMatterJson(normalizedMatter);
    return {
      ...workspace,
      metadata: runtimeWorkspaceMetadataFromMatterJson(workspace.metadata, matterJson),
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

    await persistRuntimeUploadIntakeRecords({
      databaseUrl,
      tenantId,
      spawn,
      createPgClient,
      parameterizedThresholdBytes: runtimeUploadParameterizedThresholdBytes,
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

    return withSerializedMatterWrite(normalizedMatter, async () => {
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

      await persistRuntimeUploadIntakeRecords({
        databaseUrl,
        tenantId,
        spawn,
        createPgClient,
        parameterizedThresholdBytes: runtimeUploadParameterizedThresholdBytes,
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
    });
  }

  async function createUploadSession(options = {}) {
    ensureEnabled();
    const actor = runtimeDbUserFromRequestContext();
    const action = normalizeUploadSessionAction(options.action);
    const expectedFileCount = positiveUploadInteger(options.expectedFileCount ?? options.fileCount, 0);
    if (expectedFileCount < 1) {
      throw makeHttpError("Upload session requires at least one expected file.", 400, "upload_session.expected_files_required");
    }
    const expectedBytes = positiveUploadInteger(options.expectedBytes, 0);
    const label = cleanUploadText(options.label, 200);

    if (action === "add_files") {
      const matter = await resolveRuntimeDbMatterForUploadSession(options.matter || { name: options.matterName || options.name });
      const allocation = queryJson({
        databaseUrl,
        tenantId,
        spawn,
        sql: buildMatterAddFilesAllocationSql({
          tenantId,
          matter,
          expectedFileCount,
          label,
          receivedDate: dateOnlyValue(options.receivedDate),
          actor,
        }),
      });
      if (!allocation?.uploadSessionId) {
        throw makeHttpError("Runtime DB upload session allocation failed.", 503, "upload_session.allocation_failed");
      }
      await withRuntimeDbClient(async (client) => {
        await client.query([
          "update upload_sessions",
          "set action = 'add_files',",
          "    matter_name = $2,",
          "    label = $3,",
          "    metadata_json = $4::jsonb,",
          "    expected_bytes = $5::bigint,",
          "    updated_at = now()",
          "where tenant_id = current_app_tenant_id() and id = $1::uuid",
        ].join("\n"), [
          allocation.uploadSessionId,
          matter.name,
          label,
          JSON.stringify({ allocation }),
          expectedBytes,
        ]);
      });
      return readUploadSession(allocation.uploadSessionId);
    }

    const identityPlan = planNewMatterIdentity({
      name: cleanUploadText(options.name || options.matterName, 300),
      metadata: normalizeUploadMetadata(options.metadata),
    });
    const matterName = identityPlan.storageName;
    if (!matterName) {
      throw makeHttpError("Matter name is required", 400, "upload.invalid_matter_name");
    }
    const idempotencyKey = cleanUploadText(options.idempotencyKey, 240) || `first-class-upload:${action}:${randomUUID()}`;
    return withRuntimeDbClient(async (client) => {
      await persistRuntimeDbActor(client, actor);
      const existing = await client.query(
        "select id from matters where tenant_id = current_app_tenant_id() and status = 'active' and lower(name) = lower($1) limit 1",
        [matterName],
      );
      if (existing.rows[0]?.id) {
        throw makeHttpError(`A matter named "${matterName}" already exists`, 409, "upload.matter_exists");
      }
      const inserted = await client.query([
        "insert into upload_sessions (tenant_id, matter_id, intake_id, idempotency_key, created_by_user_id, status, expected_file_count, action, matter_name, label, metadata_json, expected_bytes, created_at, updated_at)",
        "values (current_app_tenant_id(), null, null, $1, $2::uuid, 'pending', $3::int, 'create_matter', $4, '', $5::jsonb, $6::bigint, now(), now())",
        "on conflict (tenant_id, idempotency_key) do update set updated_at = now()",
        "returning id::text, matter_id::text, intake_id::text, idempotency_key, status, expected_file_count, action, matter_name, label, metadata_json, expected_bytes::text, received_file_count, received_bytes::text, created_at, updated_at, finished_at, committed_at, error_code, error_message",
      ].join("\n"), [
        idempotencyKey,
        actor?.id || null,
        expectedFileCount,
        matterName,
        JSON.stringify(identityPlan.metadata || {}),
        expectedBytes,
      ]);
      return normalizeUploadSessionRow(inserted.rows[0], []);
    });
  }

  async function readUploadSession(sessionId) {
    ensureEnabled();
    const session = await withRuntimeDbClient(async (client) => readUploadSessionWithClient(client, sessionId, { includePayload: false }));
    if (!session) throw makeHttpError("Upload session not found.", 404, "upload_session.not_found");
    return session;
  }

  async function appendUploadSessionFiles({ sessionId, files = [], relativePaths = [], fileIndexes = [] } = {}) {
    ensureEnabled();
    const uploadFiles = Array.isArray(files) ? files : [];
    const safeRelativePaths = validateRuntimeUploadInputs({
      files: uploadFiles.map((file, index) => ({ ...file, index })),
      relativePaths,
      action: "uploading session files",
    });
    return withRuntimeDbClient(async (client) => {
      const session = await readUploadSessionWithClient(client, sessionId, { includePayload: false, forUpdate: true });
      if (!session) throw makeHttpError("Upload session not found.", 404, "upload_session.not_found");
      if (["committed", "failed", "cancelled"].includes(session.status)) {
        throw makeHttpError("This upload session is no longer accepting files.", 409, "upload_session.closed");
      }
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const file = uploadFiles[index];
        const fileIndex = positiveUploadInteger(fileIndexes[index], Number.isInteger(file?.index) ? file.index : index);
        const bytes = await readUploadFilePayloadBytes(file);
        const sha256 = sha256Bytes(bytes);
        await client.query([
          "insert into upload_session_items (tenant_id, upload_session_id, file_index, relative_path, original_name, mime_type, expected_size_bytes, received_size_bytes, sha256, payload, status, created_at, updated_at)",
          "values (current_app_tenant_id(), $1::uuid, $2::int, $3, $4, $5, $6::bigint, $7::bigint, $8, $9::bytea, 'uploaded', now(), now())",
          "on conflict (tenant_id, upload_session_id, file_index) do update set",
          "  relative_path = excluded.relative_path,",
          "  original_name = excluded.original_name,",
          "  mime_type = excluded.mime_type,",
          "  expected_size_bytes = excluded.expected_size_bytes,",
          "  received_size_bytes = excluded.received_size_bytes,",
          "  sha256 = excluded.sha256,",
          "  payload = excluded.payload,",
          "  status = 'uploaded',",
          "  error_code = null,",
          "  error_message = null,",
          "  updated_at = now()",
        ].join("\n"), [
          session.id,
          fileIndex,
          safeRelativePaths[index],
          cleanUploadText(file.filename || path.posix.basename(safeRelativePaths[index]), 500),
          cleanUploadText(file.mimeType || file.type || "", 200),
          bytes.length,
          bytes.length,
          sha256,
          bytes,
        ]);
      }
      await refreshUploadSessionCounts(client, session.id);
      return readUploadSessionWithClient(client, session.id, { includePayload: false });
    });
  }

  function uploadSessionSerializationMatter(session = {}, sessionId = "") {
    const matter = normalizeMatter(session.matter || session.metadata?.allocation?.matter || {
      id: session.matterId,
      name: session.matterName,
    });
    if (matter.id || matter.name) return matter;
    return { name: `upload-session:${sessionId}` };
  }

  async function enqueuePostUploadExtraction({ session = {}, matter = null, intakeId = "" } = {}) {
    const normalizedMatter = normalizeMatter(matter || session.matter || {
      id: session.matterId,
      name: session.matterName,
    });
    if (!normalizedMatter.id) return null;
    return enqueueProcessingJob({
      matter: normalizedMatter,
      kind: "extract",
      idempotencyKey: `upload-session:${session.id}:extract`,
      metadata: {
        uploadSessionId: session.id,
        ...(intakeId ? { intakeId } : {}),
        preparationChain: "post_upload/v1",
        preparationChainId: session.id,
        stage: "extract",
      },
    });
  }

  async function commitUploadSession(sessionId) {
    ensureEnabled();
    const initialSession = await readUploadSession(sessionId);
    return withSerializedMatterWrite(uploadSessionSerializationMatter(initialSession, sessionId), async () => {
      const { session, items } = await readUploadSessionForCommit(sessionId);
      if (!session) throw makeHttpError("Upload session not found.", 404, "upload_session.not_found");
      if (session.status === "committed") {
        await enqueuePostUploadExtraction({ session, matter: session.matter || initialSession.matter });
        return { session, matter: session.matter || null, alreadyCommitted: true };
      }
      if (["failed", "cancelled"].includes(session.status)) {
        throw makeHttpError("This upload session cannot be committed.", 409, "upload_session.closed");
      }
      if (items.length < session.expectedFileCount || items.some((item) => item.status !== "uploaded" || !item.payload)) {
        throw makeHttpError("Upload session is incomplete. Upload or retry the missing files before committing.", 409, "upload_session.incomplete");
      }
      const actor = runtimeDbUserFromRequestContext();
      const { denseFiles, relativePaths } = uploadSessionFilesAndPaths(items);

      if (session.action === "add_files") {
        return commitAddFilesUploadSession({ session, items, denseFiles, relativePaths, actor });
      }
      return commitCreateMatterUploadSession({ session, items, denseFiles, relativePaths, actor });
    });
  }

  async function commitCreateMatterUploadSession({ session, denseFiles, relativePaths, actor }) {
    const metadata = normalizeUploadMetadata(session.metadata);
    const uploadPlan = planNewRuntimeMatterUpload({
      name: session.matterName,
      metadata,
      files: denseFiles,
      relativePaths,
      actor,
    });
    uploadPlan.uploadSessionId = session.id;
    uploadPlan.buildIntakeArgs.uploadSessionId = session.id;
    const matter = uploadPlan.matter;
    const existing = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildMatterByNameSql({ tenantId, name: matter.name }),
    });
    if (existing?.id && existing.id !== matter.id) {
      throw makeHttpError(`A matter named "${matter.name}" already exists`, 409, "upload.matter_exists");
    }
    const { storageFiles, importItems } = await buildRuntimeUploadIntake({
      ...uploadPlan.buildIntakeArgs,
      tempRoot,
    });
    await persistRuntimeUploadIntakeRecords({
      databaseUrl,
      tenantId,
      spawn,
      createPgClient,
      parameterizedThresholdBytes: runtimeUploadParameterizedThresholdBytes,
      actor,
      matter,
      uploadPlan,
      storageFiles,
      importItems,
      uploadSqls: createMatterSessionCommitSql({
        matter,
        actor,
        intakeId: uploadPlan.intakeDbId,
        uploadSessionId: uploadPlan.uploadSessionId,
        importBatchId: uploadPlan.importBatchId,
        expectedFileCount: importItems.length,
        receivedDate: uploadPlan.receivedDate,
      }),
    });
    await enqueuePostUploadExtraction({ session, matter });
    return {
      session: await readUploadSession(session.id),
      matter,
      committed: true,
    };
  }

  async function commitAddFilesUploadSession({ session, denseFiles, relativePaths, actor }) {
    const allocation = session.metadata?.allocation || {};
    const dbMatter = normalizeMatter(allocation.matter || session.matter || {});
    const uploadPlan = planRuntimeAddFilesUpload({
      matter: dbMatter,
      allocation: {
        ...allocation,
        uploadSessionId: session.id,
      },
      label: session.label,
      files: denseFiles,
      relativePaths,
    });
    uploadPlan.uploadSessionId = session.id;
    uploadPlan.buildIntakeArgs.uploadSessionId = session.id;
    const matter = uploadPlan.matter;
    const { storageFiles, importItems } = await buildRuntimeUploadIntake({
      ...uploadPlan.buildIntakeArgs,
      tempRoot,
      existingFiles: await readWorkspacePayloadFiles(matter),
    });
    await persistRuntimeUploadIntakeRecords({
      databaseUrl,
      tenantId,
      spawn,
      createPgClient,
      parameterizedThresholdBytes: runtimeUploadParameterizedThresholdBytes,
      actor,
      matter,
      uploadPlan,
      storageFiles,
      importItems,
      uploadSqls: createMatterAddFilesSessionCommitSql({
        matter,
        actor,
        intakeDbId: uploadPlan.intakeDbId,
        intakeNumber: uploadPlan.intakeNumber,
        uploadSessionId: uploadPlan.uploadSessionId,
        importBatchId: uploadPlan.importBatchId,
        expectedFileCount: importItems.length,
        label: session.label,
        receivedDate: uploadPlan.receivedDate,
      }),
    });
    await enqueuePostUploadExtraction({ session, matter, intakeId: uploadPlan.intakeId });
    return {
      session: await readUploadSession(session.id),
      matter,
      intakeAdded: {
        intakeId: uploadPlan.intakeId,
        intakeDirName: uploadPlan.intakeDirName,
        receivedDate: uploadPlan.receivedDate,
        label: session.label,
        scanned: importItems.length,
        unique: importItems.length,
        duplicatesInBatch: 0,
        duplicatesOfPrior: 0,
      },
      committed: true,
    };
  }

  async function cancelUploadSession(sessionId) {
    ensureEnabled();
    const initialSession = await readUploadSession(sessionId);
    return withSerializedMatterWrite(uploadSessionSerializationMatter(initialSession, sessionId), async () => {
      return withRuntimeDbClient(async (client) => {
        const session = await readUploadSessionWithClient(client, sessionId, { includePayload: false, forUpdate: true });
        if (!session) throw makeHttpError("Upload session not found.", 404, "upload_session.not_found");
        if (["committed", "cancelled", "failed"].includes(session.status)) return session;
        const result = await client.query([
          "update upload_sessions",
          "set status = 'cancelled',",
          "    error_code = null,",
          "    error_message = null,",
          "    finished_at = coalesce(finished_at, now()),",
          "    updated_at = now()",
          "where tenant_id = current_app_tenant_id() and id = $1::uuid",
          "  and status not in ('committed', 'cancelled', 'failed')",
          "returning id",
        ].join("\n"), [session.id]);
        if (!result.rows?.length) return readUploadSessionWithClient(client, session.id, { includePayload: false });
        await client.query([
          "update upload_session_items",
          "set status = 'cancelled', payload = null, updated_at = now()",
          "where tenant_id = current_app_tenant_id() and upload_session_id = $1::uuid",
          "  and status <> 'committed'",
        ].join("\n"), [session.id]);
        return readUploadSessionWithClient(client, session.id, { includePayload: false });
      });
    });
  }

  async function readUploadSessionForCommit(sessionId) {
    return withRuntimeDbClient(async (client) => {
      const session = await readUploadSessionWithClient(client, sessionId, { includePayload: true, forUpdate: true });
      return { session, items: session?.items || [] };
    });
  }

  async function readUploadSessionWithClient(client, sessionId, { includePayload = false, forUpdate = false } = {}) {
    const sessionResult = await client.query([
      "select us.id::text, us.matter_id::text, us.intake_id::text, us.idempotency_key, us.status, us.expected_file_count, us.action, us.matter_name, us.label, us.metadata_json, us.expected_bytes::text, us.received_file_count, us.received_bytes::text, us.created_at, us.updated_at, us.finished_at, us.committed_at, us.error_code, us.error_message,",
      "       case when m.id is null then null else jsonb_build_object('id', m.id::text, 'name', m.name, 'matterName', m.name, 'clientName', coalesce(m.client_name,''), 'oppositeParty', coalesce(m.opposite_party,''), 'matterType', coalesce(m.matter_type,''), 'jurisdiction', coalesce(m.jurisdiction,''), 'briefDescription', coalesce(m.brief_description,'')) end as matter",
      "from upload_sessions us",
      "left join matters m on m.id = us.matter_id and m.tenant_id = us.tenant_id",
      "where us.tenant_id = current_app_tenant_id() and us.id = $1::uuid",
      forUpdate ? "for update of us" : "",
    ].filter(Boolean).join("\n"), [sessionId]);
    const row = sessionResult.rows[0];
    if (!row) return null;
    const itemColumns = includePayload
      ? "id::text, file_index, relative_path, original_name, mime_type, expected_size_bytes::text, received_size_bytes::text, sha256, payload, status, error_code, error_message, created_at, updated_at"
      : "id::text, file_index, relative_path, original_name, mime_type, expected_size_bytes::text, received_size_bytes::text, sha256, null::bytea as payload, status, error_code, error_message, created_at, updated_at";
    const itemsResult = await client.query([
      `select ${itemColumns}`,
      "from upload_session_items",
      "where tenant_id = current_app_tenant_id() and upload_session_id = $1::uuid",
      "order by file_index asc",
    ].join("\n"), [row.id]);
    return normalizeUploadSessionRow(row, itemsResult.rows.map(normalizeUploadSessionItemRow));
  }

  async function refreshUploadSessionCounts(client, sessionId) {
    await client.query([
      "with counts as (",
      "  select count(*) filter (where status in ('uploaded','verified','committed'))::int as received_file_count,",
      "         coalesce(sum(received_size_bytes) filter (where status in ('uploaded','verified','committed')), 0)::bigint as received_bytes",
      "  from upload_session_items",
      "  where tenant_id = current_app_tenant_id() and upload_session_id = $1::uuid",
      ")",
      "update upload_sessions us",
      "set received_file_count = c.received_file_count,",
      "    received_bytes = c.received_bytes,",
      "    status = case when c.received_file_count >= us.expected_file_count then 'uploaded' else 'uploading' end,",
      "    updated_at = now()",
      "from counts c",
      "where us.tenant_id = current_app_tenant_id() and us.id = $1::uuid",
    ].join("\n"), [sessionId]);
  }

  async function resolveRuntimeDbMatterForUploadSession(input = {}) {
    const normalized = normalizeMatter(input);
    if (normalized.id) return normalized;
    const name = normalized.name;
    if (!name) throw makeHttpError("Matter is required for add-files upload session.", 400, "upload_session.matter_required");
    const result = await withRuntimeDbClient(async (client) => client.query([
      "select id::text, name, name as matter_name, coalesce(client_name,'') as client_name, coalesce(opposite_party,'') as opposite_party, coalesce(matter_type,'') as matter_type, coalesce(jurisdiction,'') as jurisdiction, coalesce(brief_description,'') as brief_description, next_file_number",
      "from matters",
      "where tenant_id = current_app_tenant_id() and status = 'active' and lower(name) = lower($1)",
      "limit 1",
    ].join("\n"), [name]));
    const row = result.rows[0];
    if (!row) throw makeHttpError(`Matter not found in runtime database: ${name}`, 404, "runtime_db.upload.matter_not_found");
    return normalizeMatter({
      id: row.id,
      name: row.name,
      matterName: row.matter_name,
      clientName: row.client_name,
      oppositeParty: row.opposite_party,
      matterType: row.matter_type,
      jurisdiction: row.jurisdiction,
      briefDescription: row.brief_description,
      nextFileNumber: row.next_file_number,
    });
  }

  async function withRuntimeDbClient(operation) {
    const client = await createPgClient(databaseUrl);
    try {
      await client.connect();
      await client.query("begin");
      await client.query(runtimeDbSafeRoleGuardSql());
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      if (error?.statusCode) throw error;
      throw makeHttpError(
        `Runtime DB upload session failed: ${redactRuntimeDbError(error?.message || String(error))}`,
        503,
        "upload_session.storage_failed",
      );
    } finally {
      await client.end().catch(() => {});
    }
  }

  async function persistRuntimeDbActor(client, actor) {
    const sql = runtimeDbActorSqls({ actor, tenantId }).join("\n").trim();
    if (sql) await client.query(sql);
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

  async function readPrepareMatterPlan(matter, options = {}) {
    const normalizedMatter = normalizeMatter(matter);
    const state = readWorkspaceState(normalizedMatter);
    const status = matterStatusFromState(normalizedMatter, state);
    const matterJson = options.includeDisputeStory ? await readMatterJson(normalizedMatter) : null;
    return runtimePrepareMatterPlanFromStatus({
      matter: normalizedMatter,
      dbMatter: runtimeWorkspaceMetadataFromMatterJson(state.dbMatter, matterJson || {}),
      status,
      workspaceFiles: runtimeWorkspaceFilePaths(state.tree.root),
      disputeStory: options.includeDisputeStory ? { hasActiveSkill: true, matterJson } : null,
    });
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
    if (!["/describe_sources", CASE_TIMELINE_SKILL_SLASH].includes(normalizedSkill)) {
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

  async function artifactStat(matter, relativePath) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const normalizedPath = normalizeMatterRelativePath(relativePath);
    const state = readWorkspaceState(normalizedMatter);
    const row = state.objects.find((object) => validatedRelativePathFromRuntimeObjectKey(object.objectKey, normalizedMatter.name) === normalizedPath);
    if (!row) return null;
    const updatedMs = Date.parse(row.updatedAt || "") || 0;
    return {
      mtime: new Date(updatedMs || Date.now()),
      mtimeMs: updatedMs,
      updatedAt: row.updatedAt || "",
      isFile: () => true,
    };
  }

  async function readProceduralPostureDiagnosisStatus(matter) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    return buildDiagnosisStatus({
      matterRoot: `postgres:${normalizedMatter.name}`,
      artifactReader: async (relativePath) => (await readFilePreview(relativePath, normalizedMatter)).content,
      artifactStatReader: (relativePath) => artifactStat(normalizedMatter, relativePath),
    });
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

  async function readMatterJson(matter) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    try {
      return readRuntimeDbJsonPayload({
        matter: normalizedMatter,
        relativePath: "matter.json",
        label: "matter.json",
        readPayloadRow,
        missingMessage: "matter.json is missing from DB payload custody.",
        missingCode: "runtime_db.matter_json.missing",
      });
    } catch (error) {
      if (error?.statusCode === 404) return runtimeMatterJsonForStorage(normalizedMatter);
      throw error;
    }
  }

  async function persistMatterJson(matter, matterJson = {}) {
    return persistTextArtifacts(matter, [{
      relativePath: "matter.json",
      text: `${JSON.stringify(matterJson, null, 2)}\n`,
      objectRole: "matter_artifact",
      mimeType: "application/json",
    }]);
  }

  async function describeSources(matter, options = {}) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    const matterJson = await readMatterJson(normalizedMatter);
    const records = readRuntimeDbExtractionRecords({
      matter: normalizedMatter,
      workspace,
      readPayloadRow,
    });
    const response = await buildSourceDescriptorsFromRecords({
      ...options,
      matterRoot: `postgres:${normalizedMatter.name}`,
      matterJson,
      records,
      dryRun: Boolean(options.dryRun),
    });
    const persisted = options.dryRun
      ? []
      : await persistTextArtifacts(normalizedMatter, [{
        relativePath: response.outputPaths.json,
        text: `${JSON.stringify(response.artifact, null, 2)}\n`,
      }]);
    return {
      operationResult: response,
      persisted,
    };
  }

  async function initializeMatter(matter, options = {}) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    const matterJson = await readMatterJson(normalizedMatter);
    const result = buildRuntimeDbMatterInit({
      matter: normalizedMatter,
      workspace,
      matterJson,
      readPayloadRow,
      options,
    });
    const persisted = options.dryRun || !result.files.length
      ? []
      : await persistTextArtifacts(normalizedMatter, result.files);
    return {
      operationResult: result.operationResult,
      persisted,
    };
  }

  async function extractDocuments(matter, options = {}) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    const matterJson = await readMatterJson(normalizedMatter);
    return runRuntimeDbExtract({
      matter: normalizedMatter,
      workspace,
      matterJson,
      readPayloadRow,
      persistTextArtifacts,
      tempRoot,
      options,
    });
  }

  async function createListOfDates(matter, options = {}) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    const matterJson = await readMatterJson(normalizedMatter);
    const records = readRuntimeDbExtractionRecords({
      matter: normalizedMatter,
      workspace,
      readPayloadRow,
    });
    const blocksFileIndex = readRuntimeDbFileRegisterIndex({
      matter: normalizedMatter,
      workspace,
      readPayloadRow,
    });
    const sourceIndexArtifact = readRuntimeDbOptionalJsonPayload({
      matter: normalizedMatter,
      relativePath: "10_Library/Source Index.json",
      readPayloadRow,
    });
    if (isTwoPassListOfDatesEnabled({ env: options.env || process.env, options })) {
      const persistedByPath = new Map();
      const persistGeneratedFiles = async (files = []) => {
        if (options.dryRun || !files.length) return [];
        const rows = await persistTextArtifacts(normalizedMatter, files);
        for (const row of rows) persistedByPath.set(row.relativePath, row);
        return rows;
      };
      const response = await buildCreateListOfDatesTwoPassFromRecords({
        ...options,
        matterRoot: `postgres:${normalizedMatter.name}`,
        matterJson,
        records,
        fileIndex: blocksFileIndex,
        sourceIndexArtifact,
        dryRun: Boolean(options.dryRun),
        candidateLedgerWriter: (file) => persistGeneratedFiles([file]),
        artifactWriter: ({ files }) => persistGeneratedFiles(files),
      });
      return {
        operationResult: response,
        persisted: [...persistedByPath.values()],
      };
    }

    const response = await buildCreateListOfDatesFromRecords({
      ...options,
      matterRoot: `postgres:${normalizedMatter.name}`,
      matterJson,
      records,
      fileIndex: blocksFileIndex,
      sourceIndexArtifact,
      dryRun: Boolean(options.dryRun),
    });
    const persisted = options.dryRun
      ? []
      : await persistTextArtifacts(normalizedMatter, response.artifactFiles);
    return {
      operationResult: response,
      persisted,
    };
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
    const listJson = readFirstRuntimeDbJsonPayload({
      matter: normalizedMatter,
      relativePaths: CASE_TIMELINE_JSON_RELATIVE_CANDIDATES,
      label: "Case Timeline",
      readPayloadRow,
      missingMessage: "Case Timeline artifact is missing from DB payload custody. Run /create_case_timeline first.",
      missingCode: "runtime_db.listofdates_refresh.list_missing",
    });
    const sourceIndex = readRuntimeDbJsonPayload({
      matter: normalizedMatter,
      relativePath: SOURCE_INDEX_RELATIVE,
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

  async function fixDoctorIssues(matter, fixIds = [], options = {}) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const workspace = readWorkspaceForMaterialization(normalizedMatter);
    const result = runRuntimeDbDoctorFix({
      matter: normalizedMatter,
      workspace,
      readPayloadRow,
      fixIds,
      generatedAt: options.generatedAt,
    });
    const filesToPersist = result.files.map((file) => {
      const bytes = Buffer.from(file.bytes || "");
      return {
        relativePath: file.relativePath,
        bytes,
        sha256: sha256Bytes(bytes),
        sizeBytes: bytes.length,
        objectRole: runtimeArtifactRoleForPath(file.relativePath),
        mimeType: runtimeArtifactMimeTypeForPath(file.relativePath),
      };
    });
    const persisted = filesToPersist.length
      ? persistMaterializedFiles({ databaseUrl, tenantId, spawn, matter: normalizedMatter, files: filesToPersist })
      : [];
    const deleted = result.deleted.length
      ? persistMaterializedDeletions({ databaseUrl, tenantId, spawn, matter: normalizedMatter, files: result.deleted })
      : [];
    return {
      operationResult: result.operationResult,
      persisted,
      deleted,
    };
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

  async function withSerializedMatterWrite(matter, operation) {
    const normalizedMatter = normalizeMatter(matter);
    return withMatterWriteQueue(normalizedMatter, async () => {
      const identity = normalizedMatter.id ? `id:${normalizedMatter.id}` : `name:${normalizedMatter.name}`;
      if (!identity) return operation();
      return withRuntimeDbClient(async (client) => {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${tenantId}:${identity}`]);
        return operation();
      });
    });
  }

  async function withMatterWriteQueue(matter, operation) {
    const normalizedMatter = normalizeMatter(matter);
    const key = normalizedMatter.id ? `id:${normalizedMatter.id}` : `name:${normalizedMatter.name}`;
    if (!key) return operation();
    const previous = matterWriteQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    matterWriteQueues.set(key, current);
    try {
      return await current;
    } finally {
      if (matterWriteQueues.get(key) === current) matterWriteQueues.delete(key);
    }
  }

  return {
    addUploadedFilesToMatter,
    appendUploadSessionFiles,
    artifactExists,
    artifactStat,
    checkUploadedFileOverlap,
    createListOfDates,
    describeSources,
    enqueueProcessingJob,
    enabled,
    extractDocuments,
    claimNextProcessingJob,
    commitUploadSession,
    cancelUploadSession,
    completeProcessingJob,
    createMatterFromUploadedFiles,
    createUploadSession,
    getRawFile,
    initializeMatter,
    failProcessingJob,
    fixDoctorIssues,
    listProcessingJobs,
    readDoctorScan,
    readMatterAttention,
    readMatterJson,
    readUploadSession,
    readProceduralPostureDiagnosisStatus,
    refreshListOfDatesSourceLabels,
    readMatterContextPacket,
    readMatterStatus,
    readPrepareMatterPlan,
    readRerunAdvice,
    readSourceRemovalPreviewState,
    persistMatterJson,
    persistTextArtifacts,
    readFilePreview,
    readWorkspace,
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

function uploadSessionFilesAndPaths(items = []) {
  const orderedItems = [...items].sort((left, right) => left.fileIndex - right.fileIndex);
  return {
    denseFiles: orderedItems.map((item, index) => ({
      index,
      filename: item.originalName,
      payloadBytes: item.payload,
      bytes: item.receivedSizeBytes,
    })),
    relativePaths: orderedItems.map((item) => item.relativePath),
  };
}

function normalizeUploadSessionAction(value) {
  const text = String(value || "").trim();
  if (text === "add_files") return "add_files";
  return "create_matter";
}

function positiveUploadInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
}

function cleanUploadText(value, maxLength = 200) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function normalizeUploadMetadata(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) continue;
    if (item == null) continue;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      normalized[key] = String(item).replace(/[\r\n\t]+/g, " ").trim().slice(0, 1000);
    }
  }
  return normalized;
}

function dateOnlyValue(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function normalizeUploadSessionRow(row = {}, items = []) {
  const expectedFileCount = Number(row.expected_file_count ?? row.expectedFileCount);
  const receivedFileCount = Number(row.received_file_count ?? row.receivedFileCount);
  const expectedBytes = Number(row.expected_bytes ?? row.expectedBytes);
  const receivedBytes = Number(row.received_bytes ?? row.receivedBytes);
  return {
    id: stringValue(row.id),
    matterId: stringValue(row.matter_id ?? row.matterId),
    intakeId: stringValue(row.intake_id ?? row.intakeId),
    idempotencyKey: stringValue(row.idempotency_key ?? row.idempotencyKey),
    status: stringValue(row.status) || "pending",
    action: stringValue(row.action) || "create_matter",
    matterName: stringValue(row.matter_name ?? row.matterName),
    label: stringValue(row.label),
    metadata: parseUploadJsonObject(row.metadata_json ?? row.metadataJson),
    expectedFileCount: Number.isFinite(expectedFileCount) ? expectedFileCount : 0,
    receivedFileCount: Number.isFinite(receivedFileCount) ? receivedFileCount : 0,
    expectedBytes: Number.isFinite(expectedBytes) ? expectedBytes : 0,
    receivedBytes: Number.isFinite(receivedBytes) ? receivedBytes : 0,
    createdAt: isoStringOrEmpty(row.created_at ?? row.createdAt),
    updatedAt: isoStringOrEmpty(row.updated_at ?? row.updatedAt),
    finishedAt: isoStringOrEmpty(row.finished_at ?? row.finishedAt),
    committedAt: isoStringOrEmpty(row.committed_at ?? row.committedAt),
    errorCode: stringValue(row.error_code ?? row.errorCode),
    errorMessage: stringValue(row.error_message ?? row.errorMessage),
    matter: row.matter && typeof row.matter === "object" ? normalizeMatter(row.matter) : null,
    items,
  };
}

function normalizeUploadSessionItemRow(row = {}) {
  const expectedSizeBytes = Number(row.expected_size_bytes ?? row.expectedSizeBytes);
  const receivedSizeBytes = Number(row.received_size_bytes ?? row.receivedSizeBytes);
  return {
    id: stringValue(row.id),
    fileIndex: positiveUploadInteger(row.file_index ?? row.fileIndex, 0),
    relativePath: stringValue(row.relative_path ?? row.relativePath),
    originalName: stringValue(row.original_name ?? row.originalName),
    mimeType: stringValue(row.mime_type ?? row.mimeType),
    expectedSizeBytes: Number.isFinite(expectedSizeBytes) ? expectedSizeBytes : 0,
    receivedSizeBytes: Number.isFinite(receivedSizeBytes) ? receivedSizeBytes : 0,
    sha256: stringValue(row.sha256),
    payload: row.payload ? Buffer.from(row.payload) : null,
    status: stringValue(row.status) || "pending",
    errorCode: stringValue(row.error_code ?? row.errorCode),
    errorMessage: stringValue(row.error_message ?? row.errorMessage),
    createdAt: isoStringOrEmpty(row.created_at ?? row.createdAt),
    updatedAt: isoStringOrEmpty(row.updated_at ?? row.updatedAt),
  };
}

function parseUploadJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isoStringOrEmpty(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : String(value);
}

function readFirstRuntimeDbJsonPayload({
  matter,
  relativePaths = [],
  label,
  readPayloadRow,
  missingMessage,
  missingCode,
} = {}) {
  let lastMissing = null;
  for (const relativePath of relativePaths) {
    try {
      return readRuntimeDbJsonPayload({ matter, relativePath, label, readPayloadRow, missingMessage, missingCode });
    } catch (error) {
      if (error?.statusCode !== 404) throw error;
      lastMissing = error;
    }
  }
  throw lastMissing || makeHttpError(missingMessage || `${label} is missing from DB payload custody.`, 404, missingCode || "runtime_db.json_payload.missing");
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
  const normalized = withSlash.replace(/-/g, "_");
  return normalized === LEGACY_LIST_OF_DATES_SKILL_SLASH ? CASE_TIMELINE_SKILL_SLASH : normalized;
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

function runtimeMatterJsonForStorage(matter = {}) {
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

function runtimeWorkspaceMetadataFromMatterJson(metadata = {}, matterJson = {}) {
  return {
    ...metadata,
    matterName: stringValue(matterJson.matter_name) || metadata.matterName || metadata.name || "",
    clientName: stringValue(matterJson.client_name) || metadata.clientName || "",
    oppositeParty: stringValue(matterJson.opposite_party) || metadata.oppositeParty || "",
    matterType: stringValue(matterJson.matter_type) || metadata.matterType || "",
    jurisdiction: stringValue(matterJson.jurisdiction) || metadata.jurisdiction || "",
    briefDescription: stringValue(matterJson.brief_description) || metadata.briefDescription || "",
    originalIntakeNote: stringValue(matterJson.original_intake_note) || metadata.originalIntakeNote || "",
    briefDescriptionSource: normalizeRuntimeBriefDescriptionSource(matterJson.brief_description_source || metadata.briefDescriptionSource),
  };
}

function normalizeRuntimeBriefDescriptionSource(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  return {
    type: stringValue(source.type),
    author: stringValue(source.author),
    slash: stringValue(source.slash),
    artifact: stringValue(source.artifact),
    basedOn: stringValue(source.based_on || source.basedOn),
    basisArtifact: stringValue(source.basis_artifact || source.basisArtifact),
    updatedAt: stringValue(source.updated_at || source.updatedAt),
  };
}

function readRuntimeDbExtractionRecords({ matter, workspace, readPayloadRow } = {}) {
  const records = [];
  const paths = runtimeWorkspaceFilePaths(workspace.tree || workspace.root || {});
  for (const item of paths) {
    const relativePath = item.path || "";
    if (!/(^|\/)\_extracted\/FILE-\d+\.json$/i.test(relativePath)) continue;
    try {
      const payload = readPayloadRow({ matter, relativePath });
      const record = JSON.parse(payload.bytes.toString("utf8"));
      if (record?.schema_version === "extraction-record/v1" && record.file_id) records.push(record);
    } catch {
      // /doctor owns invalid extraction-record reporting; source descriptions skip bad records.
    }
  }
  return records.sort((left, right) => String(left.file_id || "").localeCompare(String(right.file_id || "")));
}

function readRuntimeDbFileRegisterIndex({ matter, workspace, readPayloadRow } = {}) {
  const index = new Map();
  const paths = runtimeWorkspaceFilePaths(workspace.tree || workspace.root || {});
  for (const item of paths) {
    const relativePath = item.path || "";
    if (!/(^|\/)File Register\.csv$/i.test(relativePath)) continue;
    try {
      const payload = readPayloadRow({ matter, relativePath });
      for (const row of parseCsv(payload.bytes.toString("utf8"))) {
        if (row.file_id) index.set(row.file_id, row);
      }
    } catch {
      // Missing or invalid historical registers should not block chronology from extraction records.
    }
  }
  return index;
}

function readRuntimeDbOptionalJsonPayload({ matter, relativePath, readPayloadRow } = {}) {
  try {
    const payload = readPayloadRow({ matter, relativePath });
    return JSON.parse(payload.bytes.toString("utf8"));
  } catch {
    return null;
  }
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

async function persistRuntimeUploadIntakeRecords({
  databaseUrl,
  tenantId,
  spawn,
  createPgClient,
  parameterizedThresholdBytes,
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
  const totalBytes = filesToPersist.reduce((sum, file) => sum + file.sizeBytes, 0);
  const useParameterizedPayloads = totalBytes > parameterizedThresholdBytes;
  const persistedRows = materializedRowsForFiles({
    matter,
    files: filesToPersist,
    includePayloadHex: !useParameterizedPayloads,
    includePayloadBytes: useParameterizedPayloads,
  });
  if (useParameterizedPayloads) {
    await persistRuntimeUploadIntakeRecordsWithPg({
      databaseUrl,
      tenantId,
      actor,
      matter,
      uploadPlan,
      persistedRows,
      importItems,
      uploadSqls,
      createPgClient,
    });
    return { persistedRows };
  }
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

async function persistRuntimeUploadIntakeRecordsWithPg({
  databaseUrl,
  tenantId,
  actor,
  matter,
  uploadPlan,
  persistedRows,
  importItems,
  uploadSqls,
  createPgClient,
}) {
  const client = await createPgClient(databaseUrl);
  try {
    await client.connect();
    await client.query("begin");
    await client.query(runtimeDbSafeRoleGuardSql());
    const metadataSql = buildRuntimeUploadPersistenceSql({
      tenantId,
      actor,
      matter,
      uploadPlan,
      importItems,
      persistedRows,
      uploadSqls,
      includePayloads: false,
      wrapTransaction: false,
    });
    await client.query(metadataSql);
    for (const row of persistedRows) {
      const { text, values } = runtimeUploadPayloadUpsertQuery({ matter, row });
      await client.query(text, values);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw makeHttpError(
      `Runtime DB upload persistence failed: ${redactRuntimeDbError(error?.message || String(error))}`,
      503,
      "runtime_db.upload.persistence_failed",
    );
  } finally {
    await client.end().catch(() => {});
  }
}

async function defaultCreatePgClient(connectionString) {
  const { Client } = await import("pg");
  return new Client({ connectionString });
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

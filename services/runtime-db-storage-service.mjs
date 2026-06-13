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

import { psqlConnectionArgs } from "../scripts/db-psql.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import {
  classifyFile,
  composeIntakeDirName,
  FILE_REGISTER_HEADERS,
  INTAKE_LOG_HEADERS,
} from "../shared/matter-contract.mjs";
import { toCsv } from "../shared/csv.mjs";
import { makeHttpError, toPosix, validateRelativePath } from "../shared/safe-paths.mjs";
import { PREPARATION_STAGE_ACTIONS } from "../shared/preparation-stage-actions.mjs";
import { RERUN_ADVICE_STATES } from "../shared/rerun-advice-states.mjs";
import {
  WORKSPACE_PREVIEW_LIMITS,
  classifyWorkspacePreview,
  getWorkspaceRawContentType,
  getWorkspaceTextPreviewLimit,
  isWorkspaceTextPreviewExtension,
} from "../shared/workspace-preview-policy.mjs";
import { runtimeDbUserFromRequestContext } from "./request-context.mjs";
import { ensureRuntimeDbSafeRoleSql, wrapRuntimeDbWriteTransaction } from "./runtime-db-sql-safety.mjs";
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
      tree: publicWorkspaceTree(workspace.tree),
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
    const objects = Array.isArray(result.objects) ? result.objects.map(normalizeObjectRow) : [];
    const dbMatter = normalizeMatter({ ...normalizedMatter, ...(result.matter || {}) });
    const tree = buildWorkspaceTree({ matter: dbMatter, objects });
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
      throw makeHttpError("File type is not previewable as text", 415);
    }
    const payload = readPayloadRow({ matter: normalizeMatter(matter), relativePath: normalizedPath });
    if (payload.sizeBytes > getWorkspaceTextPreviewLimit(normalizedPath)) throw makeHttpError("File is too large to preview", 413);
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
    if (payload.sizeBytes > maxRawBytes) throw makeHttpError("File is too large to display inline", 413);
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
    const matterName = normalizeMatterName(name);
    if (!matterName) throw makeHttpError("Matter name is required", 400);
    if (!Array.isArray(files) || !files.length) throw makeHttpError("No files attached", 400);
    if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
      throw makeHttpError("paths array must match file count", 400);
    }
    const existing = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildMatterByNameSql({ tenantId, name: matterName }),
    });
    if (existing?.id) throw makeHttpError(`A matter named "${matterName}" already exists`, 409);

    const actor = runtimeDbUserFromRequestContext();
    const matter = {
      id: deterministicUuid(`runtime-db-matter:${actor?.id || "anonymous"}:${matterName}`),
      name: matterName,
      folderName: matterName,
      matterName: stringValue(metadata.matterName) || matterName,
      clientName: stringValue(metadata.clientName),
      oppositeParty: stringValue(metadata.oppositeParty),
      matterType: stringValue(metadata.matterType),
      jurisdiction: stringValue(metadata.jurisdiction),
      briefDescription: stringValue(metadata.briefDescription),
      createdByUserId: actor?.id || "",
      runtimeStorageMode: "postgres",
    };
    const intakeDbId = deterministicUuid(`runtime-db-intake:${matter.id}:1`);
    const uploadSessionId = deterministicUuid(`runtime-db-upload-session:${matter.id}:1`);
    const importBatchId = deterministicUuid(`runtime-db-import-batch:${matter.id}:1`);
    const receivedDate = new Date().toISOString().slice(0, 10);
    const intakeDirName = "Intake 01 - Initial";
    const { storageFiles, importItems } = await buildRuntimeUploadIntake({
      matter,
      metadata,
      files,
      relativePaths,
      tempRoot,
      intakeId: "INTAKE-01",
      intakeDirName,
      intakeLabel: "Initial",
      receivedDate,
      fileIdStart: 1,
    });

    const filesToPersist = storageFiles.map((file) => ({
      ...file,
      sha256: sha256Bytes(file.bytes),
      sizeBytes: file.bytes.length,
    }));
    const persistedRows = materializedRowsForFiles({ matter, files: filesToPersist });
    const sql = wrapRuntimeDbWriteTransaction([
      `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
      ...runtimeDbActorSqls({ actor, tenantId }),
      ...createMatterUploadSql({
        matter,
        actor,
        intakeId: intakeDbId,
        uploadSessionId,
        importBatchId,
        importItems,
        expectedFileCount: importItems.length,
        receivedDate,
      }),
      ...persistedRows.flatMap((row) => materializedFileUpsertSql({ matter, row })),
      ...documentIdentityUpsertSqls({
        matter,
        intakeId: intakeDbId,
        uploadSessionId,
        importItems,
        persistedRows,
      }),
      ...matterImportItemUpsertSqls({ matter, importBatchId, importItems, persistedRows }),
      "select '{}'::jsonb::text;",
      "",
    ].join("\n"));
    queryJson({ databaseUrl, tenantId, spawn, sql });
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
    if (!normalizedMatter.id) throw makeHttpError("Matter id is required for runtime DB upload", 400);
    if (!Array.isArray(files) || !files.length) throw makeHttpError("No files attached", 400);
    if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
      throw makeHttpError("paths array must match file count", 400);
    }

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
    if (!allocation?.matter?.id) throw makeHttpError(`Matter not found in runtime database: ${normalizedMatter.name}`, 404);
    const dbMatter = normalizeMatter({ ...normalizedMatter, ...allocation.matter });
    const intakeNumber = positiveInteger(allocation.nextIntakeNumber, 1);
    const fileIdStart = positiveInteger(allocation.fileIdStart || allocation.matter.nextFileNumber, 1);
    const intakeDbId = stringValue(allocation.intakeDbId);
    const uploadSessionId = stringValue(allocation.uploadSessionId);
    const receivedDate = stringValue(allocation.receivedDate) || new Date().toISOString().slice(0, 10);
    if (!intakeDbId || !uploadSessionId) throw makeHttpError("Runtime DB upload allocation failed", 500);
    const intakeDirName = composeIntakeDirName(intakeNumber, label, receivedDate);
    const intakeDir = `00_Inbox/${intakeDirName}`;
    const intakeId = `INTAKE-${String(intakeNumber).padStart(2, "0")}`;
    const importBatchId = deterministicUuid(`runtime-db-import-batch:${dbMatter.id}:${intakeNumber}`);
    const { storageFiles, importItems } = await buildRuntimeUploadIntake({
      matter: dbMatter,
      metadata: dbMatter,
      files,
      relativePaths,
      tempRoot,
      intakeId,
      intakeDirName,
      intakeLabel: label,
      receivedDate,
      fileIdStart,
      materializeExisting: true,
      existingFiles: await readWorkspacePayloadFiles(dbMatter),
      persistPaths: [
        "matter.json",
        `${intakeDir}/`,
      ],
    });

    const filesToPersist = storageFiles.map((file) => ({
      ...file,
      sha256: sha256Bytes(file.bytes),
      sizeBytes: file.bytes.length,
    }));
    const persistedRows = materializedRowsForFiles({ matter: dbMatter, files: filesToPersist });
    const sql = wrapRuntimeDbWriteTransaction([
      `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
      ...runtimeDbActorSqls({ actor, tenantId }),
      ...createMatterAddFilesSql({
        matter: dbMatter,
        actor,
        intakeDbId,
        intakeNumber,
        uploadSessionId,
        importBatchId,
        importItems,
        expectedFileCount: importItems.length,
        label,
        receivedDate,
      }),
      ...persistedRows.flatMap((row) => materializedFileUpsertSql({ matter: dbMatter, row })),
      ...documentIdentityUpsertSqls({
        matter: dbMatter,
        intakeId: intakeDbId,
        uploadSessionId,
        importItems,
        persistedRows,
      }),
      ...matterImportItemUpsertSqls({ matter: dbMatter, importBatchId, importItems, persistedRows }),
      "select '{}'::jsonb::text;",
      "",
    ].join("\n"));
    queryJson({ databaseUrl, tenantId, spawn, sql });
    return {
      intakeId,
      intakeDirName,
      receivedDate,
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
    const { objects, tree } = readWorkspaceState(normalizedMatter);
    const paths = workspaceFilePaths(tree.root);
    const runtimeInputs = runtimeStatusInputs({ matter: normalizedMatter, objects });
    const stages = [
      statusStage({
        id: "matter-init",
        slash: "/matter-init",
        label: "Set Up Matter",
        present: paths.some((item) => /(^|\/)File Register\.csv$/i.test(item.path)) || Boolean(normalizedMatter.id),
        artifacts: paths.filter((item) => /(^|\/)File Register\.csv$/i.test(item.path)).map((item) => item.path),
      }),
      statusStage({
        id: "extract",
        slash: "/extract",
        label: "Extract Documents",
        present: paths.some((item) => /(^|\/)_extracted\/[^/]+\.json$/i.test(item.path)),
        artifacts: extractedArtifacts(paths),
      }),
      statusStage({
        id: "describe-sources",
        slash: "/describe_sources",
        label: "Source Labels / Document Index",
        present: paths.some((item) => item.path === "10_Library/Source Index.json"),
        artifacts: paths.filter((item) => item.path === "10_Library/Source Index.json").map((item) => item.path),
        rerunAdvice: runtimeSourceLabelsRerunAdvice(runtimeInputs),
      }),
      statusStage({
        id: "create-listofdates",
        slash: "/create_listofdates",
        label: "Create List of Dates",
        present: paths.some((item) => item.path === "10_Library/List of Dates.md" || item.path === "10_Library/List of Dates.json"),
        artifacts: paths
          .filter((item) => item.path === "10_Library/List of Dates.md" || item.path === "10_Library/List of Dates.json")
          .map((item) => item.path),
        rerunAdvice: runtimeListOfDatesRerunAdvice(runtimeInputs),
      }),
    ];
    return {
      matterRoot: `postgres:${normalizedMatter.name}`,
      matterName: normalizedMatter.name,
      stages,
    };
  }

  async function readPrepareMatterPlan(matter) {
    const normalizedMatter = normalizeMatter(matter);
    const status = await readMatterStatus(normalizedMatter);
    const stageBySlash = new Map(status.stages.map((stage) => [stage.slash, stage]));
    const setup = prepareStage("/matter-init", stageBySlash.get("/matter-init"));
    const extraction = prepareStage("/extract", stageBySlash.get("/extract"), setup);
    const sourceLabels = prepareStage("/describe_sources", stageBySlash.get("/describe_sources"), extraction);
    const listOfDates = prepareStage("/create_listofdates", stageBySlash.get("/create_listofdates"), sourceLabels);
    const stages = [setup, extraction, sourceLabels, listOfDates];
    const nextStep = stages.find((stage) => stage.action !== PREPARATION_STAGE_ACTIONS.SKIP_CURRENT);
    return {
      schema_version: "prepare-matter-plan/v1",
      matter: {
        name: normalizedMatter.matterName || normalizedMatter.name,
        folderName: normalizedMatter.name,
      },
      metadata: {
        missing: [],
        complete: true,
      },
      stages,
      downstream: {
        listOfDates,
      },
      nextStep: nextStep
        ? {
            state: nextStep.state,
            label: nextStep.label,
            message: nextStep.reason,
            stage: nextStep.id,
            slash: nextStep.slash,
          }
        : {
            state: "complete",
            label: "Core preparation is current",
            message: "Review the preparation advisory before drafting.",
            stage: "",
            slash: "",
          },
      warnings: [],
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

  async function runMaterializedMatterWrite(matter, operation) {
    ensureEnabled();
    if (typeof operation !== "function") throw makeHttpError("Runtime DB write operation is required", 500);
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
          objectRole: roleForMaterializedPath(file.relativePath),
          mimeType: mimeTypeForPath(file.relativePath),
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
    for (const item of workspaceFilePaths(workspace.tree)) {
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
    if (typeof operation !== "function") throw makeHttpError("Runtime DB read operation is required", 500);
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
    for (const item of workspaceFilePaths(workspace.tree)) {
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
    const fileNodes = workspaceFilePaths(workspace.tree);
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
          duplicate_of: "",
          status: "unique",
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
      throw makeHttpError("File not found in runtime database storage", 404);
    }
    if (!result.hasPayload) {
      throw makeHttpError(`Runtime DB payload is missing for ${relativePath}`, 409);
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
    if (!enabled) throw makeHttpError("Runtime DB storage is not configured", 503);
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

function buildWorkspaceTree({ matter, objects }) {
  const root = {
    name: matter.name,
    kind: "directory",
    path: "",
    children: [],
  };
  let fileCount = 0;
  const directoryPaths = new Set();

  for (const object of objects) {
    const relativePath = validatedRelativePathFromObjectKey(object.objectKey, matter.name);
    if (!relativePath) continue;
    const pathParts = relativePath.split("/").filter(Boolean);
    if (!pathParts.length) continue;
    let cursor = root;
    let cursorPath = "";
    for (let index = 0; index < pathParts.length; index += 1) {
      const name = pathParts[index];
      const isFile = index === pathParts.length - 1;
      cursorPath = cursorPath ? `${cursorPath}/${name}` : name;
      if (!isFile) {
        directoryPaths.add(cursorPath);
        let directory = cursor.children.find((child) => child.kind === "directory" && child.name === name);
        if (!directory) {
          directory = { name, kind: "directory", path: cursorPath, children: [] };
          cursor.children.push(directory);
        }
        cursor = directory;
        continue;
      }
      const size = object.sizeBytes || 0;
      const preview = classifyWorkspacePreview({
        relativePath: cursorPath,
        sizeBytes: size,
        hasPayload: Boolean(object.hasPayload),
      });
      cursor.children.push({
        name,
        kind: "file",
        path: cursorPath,
        size,
        previewable: preview.previewable,
        previewKind: preview.previewKind,
        objectRole: object.objectRole,
        sha256: object.sha256,
        updatedAt: object.updatedAt,
        fileId: object.fileId,
        originalName: object.originalName,
        documentSha: object.documentSha,
        documentSizeBytes: object.documentSizeBytes,
      });
      fileCount += 1;
    }
  }

  sortTree(root);
  return {
    root,
    fileCount,
    directoryCount: directoryPaths.size,
  };
}

function sortTree(node) {
  if (!Array.isArray(node.children)) return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTree(child);
}

function publicWorkspaceTree(node) {
  if (!node || typeof node !== "object") return node;
  if (node.kind === "file") {
    return {
      name: node.name,
      kind: "file",
      path: node.path,
      size: node.size || 0,
      previewable: Boolean(node.previewable),
      previewKind: node.previewKind || "none",
    };
  }
  return {
    name: node.name,
    kind: "directory",
    path: node.path,
    children: (node.children || []).map(publicWorkspaceTree),
  };
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
    "    (sop.id is not null) as has_payload",
    "  from storage_objects so",
    "  join storage_object_payloads sop on sop.storage_object_id = so.id and sop.tenant_id = so.tenant_id",
    "  left join document_blobs db on db.storage_object_id = so.id and db.tenant_id = so.tenant_id and db.matter_id = so.matter_id and db.blob_kind = 'original'",
    "  left join documents d on d.id = db.document_id and d.tenant_id = db.tenant_id and d.matter_id = db.matter_id",
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
  const keys = objectKeyCandidates({ matter, relativePath });
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
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: ensureRuntimeDbSafeRoleSql(sql),
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: runtimeDbStoragePsqlMaxBuffer(),
  });
  if (result.error) {
    throw makeHttpError(`runtime DB storage query failed: ${redactRuntimeDbError(result.error.message)}`, 503);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw makeHttpError(`runtime DB storage query failed: ${redactRuntimeDbError(detail)}`, 503);
  }
  return parsePsqlJson(result.stdout || "");
}

function runtimeDbStoragePsqlMaxBuffer() {
  const configured = Number(process.env.MWB_RUNTIME_DB_STORAGE_PSQL_MAX_BUFFER_BYTES);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_PSQL_MAX_BUFFER_BYTES;
}

function parsePsqlJson(stdout = "") {
  const text = String(stdout || "").trim();
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) throw makeHttpError("runtime DB storage query returned no JSON.", 503);
  const start = Math.min(...starts);
  const objectEnd = text.lastIndexOf("}");
  const arrayEnd = text.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw makeHttpError("runtime DB storage query returned invalid JSON.", 503);
  }
}

function relativePathFromObjectKey(objectKey, matterName) {
  const key = normalizeObjectKey(objectKey);
  const prefix = `${normalizeObjectKey(matterName)}/`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function validatedRelativePathFromObjectKey(objectKey, matterName) {
  const relativePath = relativePathFromObjectKey(objectKey, matterName);
  if (!relativePath) return "";
  try {
    return validateRelativePath(relativePath);
  } catch {
    throw makeHttpError("Stored object path is outside the matter root", 409);
  }
}

function objectKeyCandidates({ matter, relativePath }) {
  const names = [
    matter.name,
    matter.folderName,
    matter.matterName,
  ].map(normalizeObjectKey).filter(Boolean);
  const uniqueNames = [...new Set(names)];
  return uniqueNames.map((name) => `${name}/${relativePath}`);
}

function normalizeMatterRelativePath(value) {
  const raw = String(value || "").replaceAll("\\", "/").trim();
  if (!raw) throw makeHttpError("File path is required", 400);
  if (raw.startsWith("/")) throw makeHttpError("Requested path is outside the matter root", 400);
  const normalized = toPosix(path.posix.normalize(raw)).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw makeHttpError("Requested path is outside the matter root", 400);
  }
  if (isBlockedWorkspacePath(normalized)) {
    throw makeHttpError("Requested path is hidden from workspace preview", 403);
  }
  return normalized;
}

function workspaceFilePaths(root) {
  const rows = [];
  function visit(node) {
    if (!node) return;
    if (node.kind === "file" && node.path) {
      rows.push({
        path: node.path,
        size: node.size || 0,
        objectRole: node.objectRole || "",
        sha256: node.sha256 || "",
        updatedAt: node.updatedAt || "",
        fileId: node.fileId || "",
        originalName: node.originalName || "",
        documentSha: node.documentSha || "",
        documentSizeBytes: node.documentSizeBytes || 0,
      });
    }
    for (const child of node.children || []) visit(child);
  }
  visit(root);
  return rows;
}

function extractedArtifacts(paths = []) {
  const extracted = paths.filter((item) => /(^|\/)_extracted\/[^/]+\.json$/i.test(item.path));
  if (!extracted.length) return [];
  const byDirectory = new Map();
  for (const item of extracted) {
    const directory = item.path.replace(/\/[^/]+$/, "");
    byDirectory.set(directory, (byDirectory.get(directory) || 0) + 1);
  }
  return [...byDirectory.entries()].map(([directory, count]) => `${directory} (${count} record${count === 1 ? "" : "s"})`);
}

function runtimeStatusInputs({ matter, objects = [] } = {}) {
  const rows = objects.map((object) => ({
    ...object,
    relativePath: validatedRelativePathFromObjectKey(object.objectKey, matter.name),
    updatedMs: Date.parse(object.updatedAt || "") || 0,
  }));
  const byPath = new Map(rows.map((row) => [row.relativePath, row]));
  const extractionInputs = rows
    .filter((row) => /(^|\/)_extracted\/[^/]+\.json$/i.test(row.relativePath))
    .map((row) => runtimeInput(row, "extraction_record"));
  return {
    extractionInputs,
    sourceIndex: byPath.get("10_Library/Source Index.json") || null,
    listOfDatesMarkdown: byPath.get("10_Library/List of Dates.md") || null,
    listOfDatesJson: byPath.get("10_Library/List of Dates.json") || null,
  };
}

function runtimeSourceLabelsRerunAdvice(inputs = {}) {
  return buildRuntimeRerunAdvice({
    skill: "/describe_sources",
    label: "source descriptors",
    target: inputs.sourceIndex,
    upstreamInputs: inputs.extractionInputs || [],
    staleDescription: "newer extraction records were found in DB payload custody",
    currentDescription: "No newer extraction records were found in DB payload custody.",
  });
}

function runtimeListOfDatesRerunAdvice(inputs = {}) {
  const target = inputs.listOfDatesMarkdown || inputs.listOfDatesJson;
  const upstreamInputs = [
    ...(inputs.extractionInputs || []),
    ...(inputs.sourceIndex ? [runtimeInput(inputs.sourceIndex, "source_index")] : []),
  ];
  return buildRuntimeRerunAdvice({
    skill: "/create_listofdates",
    label: "list of dates",
    target,
    upstreamInputs,
    staleDescription: "newer extraction records or Source Index changes were found in DB payload custody",
    currentDescription: "No newer extraction records or Source Index changes were found in DB payload custody.",
  });
}

function buildRuntimeRerunAdvice({
  skill,
  label,
  target,
  upstreamInputs,
  staleDescription,
  currentDescription,
}) {
  if (!target) {
    return runtimeAdvice({ skill, label, state: RERUN_ADVICE_STATES.MISSING, shouldConfirm: false });
  }
  if (!upstreamInputs.length) {
    return runtimeAdvice({
      skill,
      label,
      state: RERUN_ADVICE_STATES.MISSING_UPSTREAM,
      shouldConfirm: false,
      artifactPath: target.relativePath,
      lastRunAt: target.updatedAt || "",
    });
  }
  const newestInput = upstreamInputs.reduce((newest, input) => (
    !newest || input.updatedMs > newest.updatedMs ? input : newest
  ), null);
  if (newestInput?.updatedMs > (Date.parse(target.updatedAt || "") || 0) + 1) {
    return runtimeAdvice({
      skill,
      label,
      state: RERUN_ADVICE_STATES.STALE,
      shouldConfirm: false,
      artifactPath: target.relativePath,
      lastRunAt: target.updatedAt || "",
      reason: staleDescription,
      newestInputPath: newestInput.relativePath,
      newestInputAt: newestInput.updatedAt || "",
    });
  }
  const advice = runtimeAdvice({
    skill,
    label,
    state: RERUN_ADVICE_STATES.CURRENT,
    shouldConfirm: true,
    artifactPath: target.relativePath,
    lastRunAt: target.updatedAt || "",
    reason: currentDescription,
    inputCount: upstreamInputs.length,
  });
  advice.message = `${skill} has a current ${label} artifact in DB payload custody. Run it again anyway?`;
  return advice;
}

function runtimeInput(row, inputKind) {
  return {
    inputKind,
    relativePath: row.relativePath,
    updatedAt: row.updatedAt || "",
    updatedMs: row.updatedMs || Date.parse(row.updatedAt || "") || 0,
    contentHash: row.sha256 || "",
  };
}

function runtimeAdvice({
  skill,
  label,
  state,
  shouldConfirm,
  artifactPath = "",
  lastRunAt = "",
  reason = "",
  newestInputPath = "",
  newestInputAt = "",
  inputCount = 0,
}) {
  return {
    skill,
    label,
    state,
    shouldConfirm,
    artifactPath,
    lastRunAt,
    reason,
    newestInputPath,
    newestInputAt,
    inputCount,
  };
}

function statusStage({ id, slash, label, present, artifacts = [], rerunAdvice = null }) {
  return {
    id,
    slash,
    label,
    present: Boolean(present),
    state: present ? "present" : "not_run",
    artifacts,
    ...(rerunAdvice ? { rerunAdvice } : {}),
  };
}

function prepareStage(slash, statusStageValue, previousStage = null) {
  const definition = stageDefinition(slash);
  const advice = statusStageValue?.rerunAdvice || null;
  const adviceState = advice?.state || (statusStageValue?.present ? RERUN_ADVICE_STATES.CURRENT : RERUN_ADVICE_STATES.MISSING);
  const base = {
    id: definition.id,
    slash,
    label: definition.label,
    description: definition.description,
    paidProviderCall: definition.paidProviderCall,
    artifacts: Array.isArray(statusStageValue?.artifacts) ? statusStageValue.artifacts : [],
    rerunAdvice: advice,
  };
  if (adviceState === RERUN_ADVICE_STATES.CURRENT) {
    return {
      ...base,
      state: "current",
      action: PREPARATION_STAGE_ACTIONS.SKIP_CURRENT,
      reason: `${definition.label} is available from DB payload custody.`,
    };
  }
  if (previousStage && previousStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: `Complete ${previousStage.label} before ${definition.label}.`,
    };
  }
  if (adviceState === RERUN_ADVICE_STATES.MISSING_UPSTREAM) {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: `${definition.label} inputs are missing from DB payload custody.`,
    };
  }
  if (adviceState === RERUN_ADVICE_STATES.STALE || adviceState === RERUN_ADVICE_STATES.FAILED) {
    return {
      ...base,
      state: adviceState,
      action: definition.paidProviderCall ? PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN : PREPARATION_STAGE_ACTIONS.RUN,
      reason: advice?.reason || `${definition.label} needs to run again.`,
    };
  }
  return {
    ...base,
    state: "missing",
    action: definition.paidProviderCall ? PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN : PREPARATION_STAGE_ACTIONS.RUN,
    reason: `${definition.label} is missing from DB payload custody.`,
  };
}

function stageDefinition(slash) {
  const definitions = {
    "/matter-init": {
      id: "matter-init",
      label: "Set up matter",
      description: "Create matter metadata, intake registers, and preserved source folders.",
      paidProviderCall: false,
    },
    "/extract": {
      id: "extract",
      label: "Extract documents",
      description: "Build source-backed extraction records from registered working copies.",
      paidProviderCall: false,
    },
    "/describe_sources": {
      id: "describe-sources",
      label: "Label sources",
      description: "Create lawyer-readable source labels in Source Index.json.",
      paidProviderCall: true,
    },
    "/create_listofdates": {
      id: "create-listofdates",
      label: "Create List of Dates",
      description: "Build a source-backed chronology for lawyer review.",
      paidProviderCall: true,
    },
  };
  return definitions[slash];
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
    if (entry.isFile()) rows.push({ relativePath: normalizeObjectKey(relativePath) });
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
    .map((file) => ({
      relativePath: normalizeObjectKey(file.relativePath),
      objectKey: normalizeObjectKey(file.objectKey || `${matter.name}/${file.relativePath}`),
    }))
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
    const objectKey = `${normalizeObjectKey(matter.name)}/${normalizeObjectKey(file.relativePath)}`;
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

async function buildRuntimeUploadIntake({
  matter,
  metadata = {},
  files = [],
  relativePaths = [],
  tempRoot = os.tmpdir(),
  intakeId,
  intakeDirName,
  intakeLabel,
  receivedDate,
  fileIdStart,
  materializeExisting = false,
  existingFiles = [],
  persistPaths = null,
}) {
  const workDir = await mkdtemp(path.join(tempRoot || os.tmpdir(), "mwb-runtime-db-upload-"));
  const matterRoot = path.join(workDir, matter.name);
  try {
    await mkdir(matterRoot, { recursive: true });
    if (materializeExisting) {
      if (!Array.isArray(existingFiles)) {
        throw new Error("materializeExisting requires runtime DB workspace context");
      }
      await writeExistingPayloadFilesToMatterRoot({ matterRoot, files: existingFiles });
    }
    const uploadedSourceBytes = await writeUploadedFilesToMatterRoot({
      matterRoot,
      intakeDirName,
      files,
      relativePaths,
    });
    const result = await runMatterInit({
      matterRoot,
      metadata,
      dryRun: false,
      intakeId,
      intakeDirName,
      intakeLabel,
      receivedDate,
      fileIdStart,
    });
    return uploadIntakeResultFromMatterRoot({
      matterRoot,
      result,
      persistPaths,
      uploadedSourceBytes,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function writeExistingPayloadFilesToMatterRoot({ matterRoot, files = [] }) {
  for (const file of files) {
    const relativePath = validateRelativePath(normalizeObjectKey(file.relativePath));
    if (!relativePath) continue;
    const absolutePath = path.join(matterRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.bytes || Buffer.alloc(0));
  }
}

async function writeUploadedFilesToMatterRoot({
  matterRoot,
  intakeDirName,
  files = [],
  relativePaths = [],
}) {
  const sourceRoot = path.join(matterRoot, "00_Inbox", intakeDirName, "Source Files");
  const uploadedSourceBytes = new Map();
  const sortedFiles = [...files].sort((left, right) => left.index - right.index);
  for (const file of sortedFiles) {
    const safeRel = validateRelativePath(relativePaths[file.index]);
    const bytes = await readFile(file.tempPath);
    const destination = path.join(sourceRoot, ...safeRel.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    uploadedSourceBytes.set(normalizeObjectKey(`00_Inbox/${intakeDirName}/Source Files/${safeRel}`), bytes);
  }
  return uploadedSourceBytes;
}

async function uploadIntakeResultFromMatterRoot({
  matterRoot,
  result,
  persistPaths = null,
  uploadedSourceBytes = new Map(),
}) {
  const matterFiles = await listMatterFiles(matterRoot);
  const shouldPersist = createPersistPathMatcher(persistPaths);
  const storageFiles = [];
  for (const file of matterFiles) {
    if (!shouldPersist(file.relativePath)) continue;
    const absolutePath = path.join(matterRoot, ...file.relativePath.split("/"));
    let bytes;
    try {
      bytes = await readFile(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    storageFiles.push({
      relativePath: file.relativePath,
      bytes,
      objectRole: roleForMaterializedPath(file.relativePath),
      mimeType: mimeTypeForPath(file.relativePath),
    });
  }
  const fileRegisterRows = Array.isArray(result?.logs?.fileRegisterRows)
    ? result.logs.fileRegisterRows
    : [];
  await upsertRegisteredSourceFiles(storageFiles, { matterRoot, fileRegisterRows, uploadedSourceBytes });
  upsertGeneratedIntakeArtifacts(storageFiles, result);
  const importItems = fileRegisterRows
    .filter((row) => stringValue(row.file_id) && stringValue(row.source_path))
    .map((row) => ({
      relativePath: normalizeObjectKey(row.source_path),
      originalPath: normalizeObjectKey(row.original_path),
      workingCopyPath: normalizeObjectKey(row.working_copy_path),
      originalRelativePath: sourceRelativePathForImport(row.source_path) || stringValue(row.original_name) || normalizeObjectKey(row.source_path),
      fileNumber: fileNumberForFileId(row.file_id),
      fileId: stringValue(row.file_id).toUpperCase(),
      sha256: stringValue(row.sha256),
      duplicateOf: stringValue(row.duplicate_of).toUpperCase(),
    }))
    .filter((row) => row.fileNumber > 0 && /^FILE-\d{4}$/.test(row.fileId));
  return {
    storageFiles,
    importItems,
    result,
  };
}

async function upsertRegisteredSourceFiles(storageFiles, {
  matterRoot,
  fileRegisterRows = [],
  uploadedSourceBytes = new Map(),
}) {
  for (const row of fileRegisterRows) {
    const sourcePath = normalizeObjectKey(row.source_path);
    const sourceBytes = sourcePath ? uploadedSourceBytes.get(sourcePath) : null;
    const registeredPaths = [sourcePath, row.original_path, row.working_copy_path]
      .map((value) => normalizeObjectKey(value))
      .filter(Boolean);
    for (const relativePath of registeredPaths) {
      const bytes = sourceBytes || await readRegisteredFileBytes({ matterRoot, relativePath });
      upsertStorageFile(storageFiles, {
        relativePath,
        bytes,
        objectRole: roleForMaterializedPath(relativePath),
        mimeType: mimeTypeForPath(relativePath),
      });
    }
  }
}

async function readRegisteredFileBytes({ matterRoot, relativePath }) {
  const absolutePath = path.join(matterRoot, ...relativePath.split("/"));
  return readFile(absolutePath);
}

function createPersistPathMatcher(persistPaths) {
  if (!Array.isArray(persistPaths) || persistPaths.length === 0) {
    return () => true;
  }
  const normalizedPaths = persistPaths
    .map((item) => normalizeObjectKey(item))
    .filter(Boolean);
  return (relativePath) => {
    const normalized = normalizeObjectKey(relativePath);
    return normalizedPaths.some((persistPath) => {
      if (persistPath.endsWith("/")) return normalized.startsWith(persistPath);
      return normalized === persistPath;
    });
  };
}

function upsertGeneratedIntakeArtifacts(storageFiles, result = {}) {
  const paths = result.paths || {};
  const fileRegisterRows = Array.isArray(result?.logs?.fileRegisterRows) ? result.logs.fileRegisterRows : [];
  const intakeLogRows = Array.isArray(result?.logs?.intakeLogRows) ? result.logs.intakeLogRows : [];
  if (paths.fileRegisterPath && fileRegisterRows.length) {
    upsertStorageFile(storageFiles, {
      relativePath: paths.fileRegisterPath,
      bytes: Buffer.from(toCsv(fileRegisterRows, FILE_REGISTER_HEADERS)),
      objectRole: "matter_artifact",
      mimeType: "text/csv",
    });
  }
  if (paths.intakeLogPath && intakeLogRows.length) {
    upsertStorageFile(storageFiles, {
      relativePath: paths.intakeLogPath,
      bytes: Buffer.from(toCsv(intakeLogRows, INTAKE_LOG_HEADERS)),
      objectRole: "matter_artifact",
      mimeType: "text/csv",
    });
  }
  if (result.matterJson) {
    upsertStorageFile(storageFiles, {
      relativePath: "matter.json",
      bytes: Buffer.from(`${JSON.stringify(result.matterJson, null, 2)}\n`),
      objectRole: "matter_artifact",
      mimeType: "application/json",
    });
  }
}

function upsertStorageFile(storageFiles, file) {
  const relativePath = normalizeObjectKey(file.relativePath);
  const index = storageFiles.findIndex((existing) => normalizeObjectKey(existing.relativePath) === relativePath);
  const normalized = { ...file, relativePath };
  if (index >= 0) storageFiles[index] = normalized;
  else storageFiles.push(normalized);
}

function sourceRelativePathForImport(value) {
  const normalized = normalizeObjectKey(value);
  const marker = "/Source Files/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index + marker.length) : "";
}

function fileNumberForFileId(value) {
  const match = stringValue(value).match(/^FILE-(\d{4})$/i);
  if (!match) return 0;
  const number = Number.parseInt(match[1], 10);
  return Number.isFinite(number) ? number : 0;
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
    const originalName = path.posix.basename(normalizeObjectKey(item.originalRelativePath || item.relativePath));
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
    const normalized = normalizeObjectKey(candidate);
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
  ];
}

function matterArtifactUpsertSql({ matter, row }) {
  const artifact = artifactMetadataForRow(row);
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
  if (normalizeObjectKey(row.relativePath) !== "10_Library/Source Index.json") return [];
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
  const normalized = normalizeObjectKey(relativePath);
  const match = normalized.match(/(^|\/)_extracted\/(FILE-\d{4})\.json$/i);
  return match ? match[2].toUpperCase() : "";
}

function artifactMetadataForRow(row = {}) {
  if (row.objectRole !== "matter_artifact") return null;
  const relativePath = normalizeObjectKey(row.relativePath);
  const format = artifactFormatForPath(relativePath);
  if (!format) return null;
  if (relativePath === "10_Library/Source Index.json") {
    return { family: "source_index", mode: "default", profileKey: "default", format };
  }
  if (relativePath === "10_Library/List of Dates.md" || relativePath === "10_Library/List of Dates.json" || relativePath === "10_Library/List of Dates.csv") {
    return { family: "list_of_dates", mode: "default", profileKey: "default", format };
  }
  if (/^30_Drafts\//i.test(relativePath)) {
    return { family: "draft", mode: "default", profileKey: artifactProfileForPath(relativePath), format };
  }
  if (/^40_Dispatch\//i.test(relativePath)) {
    return { family: "dispatch_copy", mode: "default", profileKey: artifactProfileForPath(relativePath), format };
  }
  if (/^10_Library\//i.test(relativePath) || /^20_Workshop\//i.test(relativePath)) {
    return { family: "custom_skill_output", mode: "default", profileKey: artifactProfileForPath(relativePath), format };
  }
  return { family: "export", mode: "default", profileKey: artifactProfileForPath(relativePath), format };
}

function artifactProfileForPath(relativePath) {
  const normalized = normalizeObjectKey(relativePath);
  const extension = path.posix.extname(normalized);
  const withoutExtension = extension ? normalized.slice(0, -extension.length) : normalized;
  return withoutExtension || "default";
}

function artifactFormatForPath(relativePath) {
  const extension = path.posix.extname(normalizeObjectKey(relativePath)).toLowerCase().replace(/^\./, "");
  if (extension === "markdown") return "md";
  return new Set(["json", "md", "csv", "pdf", "docx", "txt"]).has(extension) ? extension : "";
}

function roleForMaterializedPath(relativePath) {
  const normalized = normalizeObjectKey(relativePath);
  if (normalized === "matter.json" || /(^|\/)(File Register|Intake Log)\.csv$/i.test(normalized)) return "matter_artifact";
  if (/(^|\/)_extracted\/[^/]+\.json$/i.test(normalized)) return "extraction_payload";
  if (/^10_Library\//i.test(normalized) || /^20_Workshop\//i.test(normalized) || /^30_Drafts\//i.test(normalized) || /^40_Dispatch\//i.test(normalized)) {
    return "matter_artifact";
  }
  if (/(^|\/)Originals\//i.test(normalized)) return "source_original";
  if (/(^|\/)(Source Files|By Type)\//i.test(normalized)) return "source_working_copy";
  return "other";
}

function mimeTypeForPath(relativePath) {
  return getWorkspaceRawContentType(relativePath);
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

function normalizeObjectKey(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function normalizeMatterName(value) {
  const text = stringValue(value);
  if (!text || text.startsWith(".") || text.includes("/") || text.includes("\\") || text.includes("..")) {
    throw makeHttpError("Invalid matter name", 400);
  }
  return text;
}

function normalizeObjectRow(row = {}) {
  return {
    objectKey: stringValue(row.objectKey),
    objectRole: stringValue(row.objectRole),
    mimeType: stringValue(row.mimeType),
    sizeBytes: Number(row.sizeBytes) || 0,
    sha256: stringValue(row.sha256),
    updatedAt: normalizeIsoString(row.updatedAt || row.updated_at),
    hasPayload: Boolean(row.hasPayload),
    fileId: stringValue(row.fileId || row.file_id),
    originalName: stringValue(row.originalName || row.original_name),
    documentSha: stringValue(row.documentSha || row.document_sha),
    documentSizeBytes: Number(row.documentSizeBytes || row.document_size_bytes) || 0,
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

function normalizeIsoString(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.trunc(number);
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function redactRuntimeDbError(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\btop-secret\b/gi, "***");
}

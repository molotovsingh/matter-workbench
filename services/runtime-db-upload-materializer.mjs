import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

import { validateRelativePath } from "../shared/safe-paths.mjs";
import {
  runtimeArtifactMimeTypeForPath,
  runtimeArtifactRoleForPath,
} from "./runtime-db-artifact-policy.mjs";
import { buildRuntimeDbMatterInit } from "./runtime-db-matter-init-service.mjs";
import { normalizeRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";
import { runtimeUploadImportItemsFromFileRegisterRows } from "./runtime-db-upload-import-items.mjs";
import { buildRuntimeWorkspaceTree } from "./runtime-db-workspace-read-model.mjs";

export async function buildRuntimeUploadIntake({
  matter,
  metadata = {},
  files = [],
  relativePaths = [],
  intakeId,
  intakeDirName,
  intakeLabel,
  receivedDate,
  fileIdStart,
  materializeExisting = false,
  existingFiles = [],
  persistPaths = null,
}) {
  if (materializeExisting && !Array.isArray(existingFiles)) {
    throw new Error("materializeExisting requires runtime DB workspace context");
  }

  const existingStorageFiles = materializeExisting ? normalizeExistingPayloadFiles(existingFiles) : [];
  const uploadedSourceFiles = await buildUploadedSourceStorageFiles({
    intakeDirName,
    files,
    relativePaths,
  });
  const inputPayloads = payloadMapForFiles([...existingStorageFiles, ...uploadedSourceFiles]);
  const matterJson = readExistingMatterJson(inputPayloads.get("matter.json"));
  const workspace = buildVirtualUploadWorkspace({ matter, files: [...inputPayloads.values()] });
  const result = buildRuntimeDbMatterInit({
    matter,
    workspace,
    matterJson,
    readPayloadRow: ({ relativePath }) => readPayloadFromMap(inputPayloads, relativePath),
    options: {
      metadata,
      dryRun: false,
      intakeId,
      intakeDirName,
      intakeLabel,
      receivedDate,
      fileIdStart,
    },
  });

  const shouldPersist = createPersistPathMatcher(persistPaths);
  const storageFiles = normalizeStorageFiles([
    ...uploadedSourceFiles,
    ...result.files,
  ]).filter((file) => shouldPersist(file.relativePath));
  const fileRegisterRows = Array.isArray(result?.operationResult?.logs?.fileRegisterRows)
    ? result.operationResult.logs.fileRegisterRows
    : [];

  return {
    storageFiles,
    importItems: runtimeUploadImportItemsFromFileRegisterRows(fileRegisterRows),
    result: result.operationResult,
  };
}

async function buildUploadedSourceStorageFiles({
  intakeDirName,
  files = [],
  relativePaths = [],
}) {
  const sortedFiles = [...files].sort((left, right) => left.index - right.index);
  const storageFiles = [];
  for (const file of sortedFiles) {
    const safeRel = validateRelativePath(relativePaths[file.index]);
    const bytes = uploadFilePayloadBytes(file) || await readFile(file.tempPath);
    storageFiles.push({
      relativePath: normalizeRuntimeObjectKey(`00_Inbox/${intakeDirName}/Source Files/${safeRel}`),
      bytes,
    });
  }
  return normalizeStorageFiles(storageFiles);
}

function uploadFilePayloadBytes(file = {}) {
  if (Buffer.isBuffer(file.bytes)) return Buffer.from(file.bytes);
  if (file.bytes instanceof Uint8Array) return Buffer.from(file.bytes);
  if (file.buffer instanceof Uint8Array) return Buffer.from(file.buffer);
  return null;
}

function normalizeExistingPayloadFiles(files = []) {
  return files.map((file) => ({
    relativePath: normalizeRuntimeObjectKey(file.relativePath),
    bytes: Buffer.from(file.bytes || Buffer.alloc(0)),
    objectRole: file.objectRole || runtimeArtifactRoleForPath(file.relativePath),
    mimeType: file.mimeType || runtimeUploadMimeTypeForPath(file.relativePath),
  })).filter((file) => file.relativePath);
}

function normalizeStorageFiles(files = []) {
  const byPath = new Map();
  for (const file of files) {
    const relativePath = normalizeRuntimeObjectKey(file.relativePath);
    if (!relativePath) continue;
    const bytes = Buffer.from(file.bytes || (typeof file.text === "string" ? file.text : ""));
    byPath.set(relativePath, {
      relativePath,
      bytes,
      objectRole: file.objectRole || runtimeArtifactRoleForPath(relativePath),
      mimeType: file.mimeType || runtimeUploadMimeTypeForPath(relativePath),
    });
  }
  return [...byPath.values()];
}

function payloadMapForFiles(files = []) {
  const payloads = new Map();
  for (const file of normalizeStorageFiles(files)) {
    payloads.set(file.relativePath, {
      ...file,
      sizeBytes: file.bytes.length,
    });
  }
  return payloads;
}

function readPayloadFromMap(payloads, relativePath) {
  const normalizedPath = normalizeRuntimeObjectKey(relativePath);
  const payload = payloads.get(normalizedPath);
  if (!payload) {
    throw new Error(`Runtime upload source payload is missing: ${normalizedPath}`);
  }
  return {
    objectKey: normalizedPath,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
    bytes: payload.bytes,
  };
}

function buildVirtualUploadWorkspace({ matter = {}, files = [] }) {
  const objects = normalizeStorageFiles(files).map((file) => ({
    objectKey: `${normalizeRuntimeObjectKey(matter.name)}/${file.relativePath}`,
    objectRole: file.objectRole,
    mimeType: file.mimeType,
    sizeBytes: file.bytes.length,
    hasPayload: true,
  }));
  const tree = buildRuntimeWorkspaceTree({ matter, objects });
  return {
    folderName: matter.name,
    inputLabel: `postgres:${matter.name}`,
    metadata: {
      matterName: matter.matterName || matter.name,
      clientName: matter.clientName,
      oppositeParty: matter.oppositeParty,
      matterType: matter.matterType,
      jurisdiction: matter.jurisdiction,
      briefDescription: matter.briefDescription,
    },
    fileCount: tree.fileCount,
    directoryCount: tree.directoryCount,
    tree: tree.root,
  };
}

function runtimeUploadMimeTypeForPath(relativePath) {
  const normalizedPath = normalizeRuntimeObjectKey(relativePath);
  if (normalizedPath === "matter.json") return "application/json";
  if (/(^|\/)(File Register|Intake Log)\.csv$/i.test(normalizedPath)) return "text/csv";
  return runtimeArtifactMimeTypeForPath(normalizedPath);
}

function readExistingMatterJson(payload) {
  if (!payload?.bytes) return {};
  try {
    return JSON.parse(payload.bytes.toString("utf8"));
  } catch {
    return {};
  }
}

function createPersistPathMatcher(persistPaths) {
  if (!Array.isArray(persistPaths) || persistPaths.length === 0) {
    return () => true;
  }
  const normalizedPaths = persistPaths
    .map((item) => normalizeRuntimeObjectKey(item))
    .filter(Boolean);
  return (relativePath) => {
    const normalized = normalizeRuntimeObjectKey(relativePath);
    return normalizedPaths.some((persistPath) => {
      if (persistPath.endsWith("/")) return normalized.startsWith(persistPath);
      return normalized === persistPath;
    });
  };
}

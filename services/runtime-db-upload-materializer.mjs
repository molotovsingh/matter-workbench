import { Buffer } from "node:buffer";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runMatterInit } from "../matter-init-engine.mjs";
import {
  FILE_REGISTER_HEADERS,
  INTAKE_LOG_HEADERS,
} from "../shared/matter-contract.mjs";
import { toCsv } from "../shared/csv.mjs";
import { validateRelativePath } from "../shared/safe-paths.mjs";
import {
  runtimeArtifactMimeTypeForPath,
  runtimeArtifactRoleForPath,
} from "./runtime-db-artifact-policy.mjs";
import { normalizeRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";
import { runtimeUploadImportItemsFromFileRegisterRows } from "./runtime-db-upload-import-items.mjs";

export async function buildRuntimeUploadIntake({
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
    const relativePath = validateRelativePath(normalizeRuntimeObjectKey(file.relativePath));
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
    uploadedSourceBytes.set(normalizeRuntimeObjectKey(`00_Inbox/${intakeDirName}/Source Files/${safeRel}`), bytes);
  }
  return uploadedSourceBytes;
}

async function uploadIntakeResultFromMatterRoot({
  matterRoot,
  result,
  persistPaths = null,
  uploadedSourceBytes = new Map(),
}) {
  const matterFiles = await listUploadMatterFiles(matterRoot);
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
      objectRole: runtimeArtifactRoleForPath(file.relativePath),
      mimeType: runtimeArtifactMimeTypeForPath(file.relativePath),
    });
  }
  const fileRegisterRows = Array.isArray(result?.logs?.fileRegisterRows)
    ? result.logs.fileRegisterRows
    : [];
  await upsertRegisteredSourceFiles(storageFiles, { matterRoot, fileRegisterRows, uploadedSourceBytes });
  upsertGeneratedIntakeArtifacts(storageFiles, result);
  return {
    storageFiles,
    importItems: runtimeUploadImportItemsFromFileRegisterRows(fileRegisterRows),
    result,
  };
}

async function listUploadMatterFiles(root, relativePrefix = "") {
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
      rows.push(...await listUploadMatterFiles(root, relativePath));
      continue;
    }
    if (entry.isFile()) rows.push({ relativePath: normalizeRuntimeObjectKey(relativePath) });
  }
  return rows.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function upsertRegisteredSourceFiles(storageFiles, {
  matterRoot,
  fileRegisterRows = [],
  uploadedSourceBytes = new Map(),
}) {
  for (const row of fileRegisterRows) {
    const sourcePath = normalizeRuntimeObjectKey(row.source_path);
    const sourceBytes = sourcePath ? uploadedSourceBytes.get(sourcePath) : null;
    const registeredPaths = [sourcePath, row.original_path, row.working_copy_path]
      .map((value) => normalizeRuntimeObjectKey(value))
      .filter(Boolean);
    for (const relativePath of registeredPaths) {
      const bytes = sourceBytes || await readRegisteredFileBytes({ matterRoot, relativePath });
      upsertStorageFile(storageFiles, {
        relativePath,
        bytes,
        objectRole: runtimeArtifactRoleForPath(relativePath),
        mimeType: runtimeArtifactMimeTypeForPath(relativePath),
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
  const relativePath = normalizeRuntimeObjectKey(file.relativePath);
  const index = storageFiles.findIndex((existing) => normalizeRuntimeObjectKey(existing.relativePath) === relativePath);
  const normalized = { ...file, relativePath };
  if (index >= 0) storageFiles[index] = normalized;
  else storageFiles.push(normalized);
}

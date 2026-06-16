import { createHash } from "node:crypto";
import { composeIntakeDirName } from "../shared/matter-contract.mjs";
import {
  matterIdentityFromCaption,
  matterMetadataFields,
} from "../shared/matter-identity-policy.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { validateUploadRelativePaths } from "../shared/upload-path-policy.mjs";

export function planNewRuntimeMatterUpload({
  name = "",
  metadata = {},
  files = [],
  relativePaths = [],
  actor = null,
  now = new Date(),
} = {}) {
  const identity = matterIdentityFromCaption(name);
  const safeRelativePaths = validateRuntimeUploadInputs({ files, relativePaths, action: "creating a matter" });
  const storageName = identity.storageName;
  const normalizedMetadata = matterMetadataFields({
    metadata,
    caption: identity.displayName,
    storageName,
  });
  const actorId = stringValue(actor?.id);
  const matter = {
    id: deterministicUuid(`runtime-db-matter:${actorId || "anonymous"}:${storageName}`),
    name: storageName,
    folderName: storageName,
    matterName: stringValue(normalizedMetadata.matterName) || storageName,
    clientName: stringValue(normalizedMetadata.clientName),
    oppositeParty: stringValue(normalizedMetadata.oppositeParty),
    matterType: stringValue(normalizedMetadata.matterType),
    jurisdiction: stringValue(normalizedMetadata.jurisdiction),
    briefDescription: stringValue(normalizedMetadata.briefDescription),
    createdByUserId: actorId,
    runtimeStorageMode: "postgres",
  };
  const intakeDbId = deterministicUuid(`runtime-db-intake:${matter.id}:1`);
  const uploadSessionId = deterministicUuid(`runtime-db-upload-session:${matter.id}:1`);
  const importBatchId = deterministicUuid(`runtime-db-import-batch:${matter.id}:1`);
  const receivedDate = dateOnly(now);
  const buildIntakeArgs = {
    matter,
    metadata: matter,
    files,
    relativePaths: safeRelativePaths,
    intakeDbId,
    uploadSessionId,
    importBatchId,
    intakeId: "INTAKE-01",
    intakeDirName: "Intake 01 - Initial",
    intakeLabel: "Initial",
    receivedDate,
    fileIdStart: 1,
  };
  return {
    matter,
    relativePaths: safeRelativePaths,
    intakeDbId,
    uploadSessionId,
    importBatchId,
    receivedDate,
    buildIntakeArgs,
  };
}

export function planRuntimeAddFilesUpload({
  matter = {},
  allocation = {},
  label = "",
  files = [],
  relativePaths = [],
  now = new Date(),
} = {}) {
  const safeRelativePaths = validateRuntimeUploadInputs({ files, relativePaths, action: "adding files" });
  const dbMatter = normalizeMatter({ ...normalizeMatter(matter), ...(allocation.matter || {}) });
  if (!dbMatter.id) throw makeHttpError(`Matter not found in runtime database: ${normalizeMatter(matter).name}`, 404);
  const intakeNumber = positiveInteger(allocation.nextIntakeNumber, 1);
  const fileIdStart = positiveInteger(allocation.fileIdStart || allocation.matter?.nextFileNumber, 1);
  const intakeDbId = stringValue(allocation.intakeDbId);
  const uploadSessionId = stringValue(allocation.uploadSessionId);
  if (!intakeDbId || !uploadSessionId) throw makeHttpError("Runtime DB upload allocation failed", 500);
  const receivedDate = stringValue(allocation.receivedDate) || dateOnly(now);
  const intakeDirName = composeIntakeDirName(intakeNumber, label, receivedDate);
  const intakeDir = `00_Inbox/${intakeDirName}`;
  const intakeId = `INTAKE-${String(intakeNumber).padStart(2, "0")}`;
  const importBatchId = deterministicUuid(`runtime-db-import-batch:${dbMatter.id}:${intakeNumber}`);
  const buildIntakeArgs = {
    matter: dbMatter,
    metadata: dbMatter,
    files,
    relativePaths: safeRelativePaths,
    intakeDbId,
    uploadSessionId,
    importBatchId,
    intakeId,
    intakeDirName,
    intakeLabel: label,
    receivedDate,
    fileIdStart,
    materializeExisting: true,
    persistPaths: [
      "matter.json",
      `${intakeDir}/`,
    ],
  };
  return {
    matter: dbMatter,
    relativePaths: safeRelativePaths,
    intakeNumber,
    intakeId,
    intakeDirName,
    intakeDir,
    fileIdStart,
    intakeDbId,
    uploadSessionId,
    importBatchId,
    receivedDate,
    buildIntakeArgs,
  };
}

export function validateRuntimeUploadInputs({ files = [], relativePaths = [], action = "uploading files" } = {}) {
  if (!Array.isArray(files) || !files.length) throw noUploadedFilesError(action);
  if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
    throw makeHttpError("paths array must match file count", 400);
  }
  return validateUploadRelativePaths(relativePaths);
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

function noUploadedFilesError(action = "creating a matter") {
  return makeHttpError(
    `Attach at least one source file before ${action}.`,
    400,
    "upload.no_files_attached",
  );
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.trunc(number);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function dateOnly(value) {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

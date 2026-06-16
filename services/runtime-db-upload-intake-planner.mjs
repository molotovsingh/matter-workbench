import { createHash } from "node:crypto";
import { makeHttpError } from "../shared/safe-paths.mjs";
import {
  dateOnly,
  normalizeUploadMatter,
  planAddFilesIntake,
  planNewMatterUpload,
  stringValue,
  validateUploadInputs,
} from "../shared/upload-intake-planner.mjs";

export function planNewRuntimeMatterUpload({
  name = "",
  metadata = {},
  files = [],
  relativePaths = [],
  actor = null,
  now = new Date(),
} = {}) {
  const uploadPlan = planNewMatterUpload({
    name,
    metadata,
    files,
    relativePaths,
    action: "creating a matter",
  });
  const storageName = uploadPlan.storageName;
  const normalizedMetadata = uploadPlan.metadata;
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
    relativePaths: uploadPlan.relativePaths,
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
    relativePaths: uploadPlan.relativePaths,
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
  const dbMatter = normalizeUploadMatter({ ...normalizeUploadMatter(matter), ...(allocation.matter || {}) });
  if (!dbMatter.id) throw makeHttpError(`Matter not found in runtime database: ${normalizeUploadMatter(matter).name}`, 404);
  const intakeDbId = stringValue(allocation.intakeDbId);
  const uploadSessionId = stringValue(allocation.uploadSessionId);
  if (!intakeDbId || !uploadSessionId) throw makeHttpError("Runtime DB upload allocation failed", 500);
  const intakePlan = planAddFilesIntake({
    label,
    files,
    relativePaths,
    intakeNumber: allocation.nextIntakeNumber,
    fileIdStart: allocation.fileIdStart || allocation.matter?.nextFileNumber,
    receivedDate: allocation.receivedDate,
    now,
    action: "adding files",
  });
  const importBatchId = deterministicUuid(`runtime-db-import-batch:${dbMatter.id}:${intakePlan.intakeNumber}`);
  const buildIntakeArgs = {
    matter: dbMatter,
    metadata: dbMatter,
    files,
    relativePaths: intakePlan.relativePaths,
    intakeDbId,
    uploadSessionId,
    importBatchId,
    intakeId: intakePlan.intakeId,
    intakeDirName: intakePlan.intakeDirName,
    intakeLabel: label,
    receivedDate: intakePlan.receivedDate,
    fileIdStart: intakePlan.fileIdStart,
    materializeExisting: true,
    persistPaths: [
      "matter.json",
      `${intakePlan.intakeDir}/`,
    ],
  };
  return {
    matter: dbMatter,
    relativePaths: intakePlan.relativePaths,
    intakeNumber: intakePlan.intakeNumber,
    intakeId: intakePlan.intakeId,
    intakeDirName: intakePlan.intakeDirName,
    intakeDir: intakePlan.intakeDir,
    fileIdStart: intakePlan.fileIdStart,
    intakeDbId,
    uploadSessionId,
    importBatchId,
    receivedDate: intakePlan.receivedDate,
    buildIntakeArgs,
  };
}

export function validateRuntimeUploadInputs({ files = [], relativePaths = [], action = "uploading files" } = {}) {
  return validateUploadInputs({ files, relativePaths, action });
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

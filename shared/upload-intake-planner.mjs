import { composeIntakeDirName } from "./matter-contract.mjs";
import {
  matterIdentityFromCaption,
  matterMetadataFields,
} from "./matter-identity-policy.mjs";
import { makeHttpError } from "./safe-paths.mjs";
import { validateUploadRelativePaths } from "./upload-path-policy.mjs";

export function planNewMatterIdentity({ name = "", metadata = {} } = {}) {
  const identity = matterIdentityFromCaption(name);
  const storageName = identity.storageName;
  return {
    identity,
    name: storageName,
    storageName,
    metadata: matterMetadataFields({
      metadata,
      caption: identity.displayName,
      storageName,
    }),
  };
}

export function planNewMatterUpload({
  name = "",
  metadata = {},
  files = [],
  relativePaths = [],
  action = "creating a matter",
} = {}) {
  return {
    ...planNewMatterIdentity({ name, metadata }),
    relativePaths: validateUploadInputs({ files, relativePaths, action }),
  };
}

export function planAddFilesIntake({
  label = "",
  files = [],
  relativePaths = [],
  intakeNumber = 1,
  fileIdStart = 1,
  receivedDate = "",
  now = new Date(),
  action = "adding files",
} = {}) {
  const normalizedIntakeNumber = positiveInteger(intakeNumber, 1);
  const normalizedFileIdStart = positiveInteger(fileIdStart, 1);
  const normalizedReceivedDate = stringValue(receivedDate) || dateOnly(now);
  const intakeDirName = composeIntakeDirName(normalizedIntakeNumber, label, normalizedReceivedDate);
  const intakeId = `INTAKE-${String(normalizedIntakeNumber).padStart(2, "0")}`;
  return {
    label,
    relativePaths: validateUploadInputs({ files, relativePaths, action }),
    intakeNumber: normalizedIntakeNumber,
    intakeId,
    intakeDirName,
    intakeDir: `00_Inbox/${intakeDirName}`,
    fileIdStart: normalizedFileIdStart,
    receivedDate: normalizedReceivedDate,
  };
}

export function validateUploadInputs({ files = [], relativePaths = [], action = "uploading files" } = {}) {
  if (!Array.isArray(files) || !files.length) throw noUploadedFilesError(action);
  if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
    throw makeHttpError("paths array must match file count", 400);
  }
  return validateUploadRelativePaths(relativePaths);
}

export function noUploadedFilesError(action = "creating a matter") {
  return makeHttpError(
    `Attach at least one source file before ${action}.`,
    400,
    "upload.no_files_attached",
  );
}

export function normalizeUploadMatter(matter = {}) {
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

export function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.trunc(number);
}

export function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function dateOnly(value) {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

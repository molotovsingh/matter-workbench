import { validateIntakeLabel } from "../../shared/matter-contract.mjs";
import { makeHttpError } from "../../shared/safe-paths.mjs";
import {
  planNewMatterIdentity,
  planNewMatterUpload,
  validateUploadInputs,
} from "../../shared/upload-intake-planner.mjs";
import { browserUploadBatchFromFiles } from "./intake-contracts.mjs";

export function parseUploadJsonField(fields = {}, name, fallback) {
  if (!fields[name]) return fallback;
  try {
    return JSON.parse(fields[name]);
  } catch {
    throw makeHttpError(`Invalid ${name} JSON`, 400, "upload.invalid_json");
  }
}

export function validateUploadPathList(fields = {}, files = [], { action = "uploading files" } = {}) {
  const relativePaths = parseUploadJsonField(fields, "paths", []);
  return validateUploadInputs({ files, relativePaths, action });
}

export function planBrowserNewMatterUpload({ fields = {}, files = [] } = {}) {
  const submittedMatterName = String(fields.name || "").trim();
  const metadata = parseUploadJsonField(fields, "metadata", {});
  const rawRelativePaths = parseUploadJsonField(fields, "paths", []);
  const identityPlan = planNewMatterIdentity({ name: submittedMatterName });
  const uploadPlan = planNewMatterUpload({
    name: submittedMatterName,
    metadata,
    files,
    relativePaths: rawRelativePaths,
    action: "creating a matter",
  });
  const batch = browserUploadBatchFromFiles({
    action: "creating a matter",
    files,
    relativePaths: uploadPlan.relativePaths,
  });

  return {
    submittedMatterName,
    identityPlan,
    uploadPlan,
    metadata: uploadPlan.metadata,
    relativePaths: uploadPlan.relativePaths,
    batch,
  };
}

export function planBrowserAddFilesUpload({ fields = {}, files = [] } = {}) {
  const label = validateIntakeLabel(fields.label);
  const relativePaths = validateUploadPathList(fields, files, { action: "adding files" });
  const batch = browserUploadBatchFromFiles({
    action: "adding files",
    files,
    relativePaths,
  });

  return {
    label,
    relativePaths,
    batch,
  };
}

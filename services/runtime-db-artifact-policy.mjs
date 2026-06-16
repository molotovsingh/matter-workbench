import path from "node:path";

import { getWorkspaceRawContentType } from "../shared/workspace-preview-policy.mjs";
import { normalizeRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";

export function runtimeArtifactRoleForPath(relativePath) {
  const normalized = normalizeRuntimeObjectKey(relativePath);
  if (normalized === "matter.json" || /(^|\/)(File Register|Intake Log)\.csv$/i.test(normalized)) return "matter_artifact";
  if (/(^|\/)_extracted\/[^/]+\.json$/i.test(normalized)) return "extraction_payload";
  if (/^10_Library\//i.test(normalized) || /^20_Workshop\//i.test(normalized) || /^30_Drafts\//i.test(normalized) || /^40_Dispatch\//i.test(normalized)) {
    return "matter_artifact";
  }
  if (/(^|\/)Originals\//i.test(normalized)) return "source_original";
  if (/(^|\/)(Source Files|By Type)\//i.test(normalized)) return "source_working_copy";
  return "other";
}

export function runtimeArtifactMetadataForRow(row = {}) {
  if (row.objectRole !== "matter_artifact") return null;
  const relativePath = normalizeRuntimeObjectKey(row.relativePath);
  const format = runtimeArtifactFormatForPath(relativePath);
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

export function runtimeArtifactFormatForPath(relativePath) {
  const extension = path.posix.extname(normalizeRuntimeObjectKey(relativePath)).toLowerCase().replace(/^\./, "");
  if (extension === "markdown") return "md";
  return new Set(["json", "md", "csv", "pdf", "docx", "txt"]).has(extension) ? extension : "";
}

export function runtimeArtifactMimeTypeForPath(relativePath) {
  return getWorkspaceRawContentType(relativePath);
}

function artifactProfileForPath(relativePath) {
  const normalized = normalizeRuntimeObjectKey(relativePath);
  const extension = path.posix.extname(normalized);
  const withoutExtension = extension ? normalized.slice(0, -extension.length) : normalized;
  return withoutExtension || "default";
}

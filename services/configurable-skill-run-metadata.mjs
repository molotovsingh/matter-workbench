import path from "node:path";
import { normalizeText } from "./configurable-skill-definition.mjs";

export function createNoopRunLedger() {
  return {
    createRun: async (entry = {}) => ({
      id: "",
      ...entry,
      status: entry.status || "running",
    }),
    updateRun: async (id, patch = {}) => ({
      id,
      ...patch,
    }),
    recordCancelledRun: async (entry = {}) => ({
      id: "",
      ...entry,
      status: "cancelled",
    }),
  };
}

export function skillRunTitle(skill = {}) {
  const title = normalizeText(skill.title || skill.slash || "Custom Skill");
  const version = Number(skill.version || 1);
  const versionLabel = `v${Number.isFinite(version) && version > 0 ? version : 1}`;
  return /\bv\d+\s*$/i.test(title) ? title : `${title} ${versionLabel}`;
}

export function matterSummaryForRun(matter = null, matterRoot = "") {
  const source = matter && typeof matter === "object" ? matter : {};
  const folder = path.basename(matterRoot || "");
  return {
    matterName: normalizeText(
      source.matterName
      || source.matter_name
      || source.name
      || folder,
    ),
    matterFolder: normalizeText(
      source.folderName
      || source.folder_name
      || folder,
    ),
  };
}

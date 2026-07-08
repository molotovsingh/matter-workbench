import path from "node:path";
import { CASE_TIMELINE_SKILL_SLASH } from "../shared/case-timeline-operation.mjs";
import { evidence, fileExists, readJsonFile, stageBySlash } from "./matter-attention-helpers.mjs";
import { buildRerunAdviceAttentionItems } from "./matter-attention-rerun-advice.mjs";
import {
  CASE_TIMELINE_JSON_RELATIVE,
  CASE_TIMELINE_JSON_RELATIVE_CANDIDATES,
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  CASE_TIMELINE_MARKDOWN_RELATIVE_CANDIDATES,
} from "../shared/matter-artifacts.mjs";

export async function buildChronologyAttentionItems({ root, status } = {}) {
  const items = [];
  const caseTimelineJson = await readFirstJsonFile(root, CASE_TIMELINE_JSON_RELATIVE_CANDIDATES);
  const markdownRelative = await firstExistingRelativePath(root, CASE_TIMELINE_MARKDOWN_RELATIVE_CANDIDATES);
  const markdownExists = Boolean(markdownRelative);
  const caseTimelineStage = stageBySlash(status, CASE_TIMELINE_SKILL_SLASH);
  const caseTimelineAdvice = caseTimelineStage?.rerunAdvice;

  if (caseTimelineJson.exists && !caseTimelineJson.valid) {
    addItem(items, {
      severity: "blocker",
      category: "chronology",
      code: "listofdates_json_unreadable",
      title: "Case Timeline JSON is unreadable",
      detail: caseTimelineJson.error,
      action: "Repair or regenerate the Case Timeline before using chronology-dependent skills.",
      evidence: [evidence(caseTimelineJson.relativePath || CASE_TIMELINE_JSON_RELATIVE)],
    });
  }

  if (markdownExists && !caseTimelineJson.exists) {
    addItem(items, {
      severity: "warning",
      category: "chronology",
      code: "listofdates_json_missing",
      title: "Case Timeline markdown exists without JSON metadata",
      detail: "The lawyer-facing markdown exists, but the machine-readable chronology state is missing.",
      action: "Regenerate the Case Timeline or recover the JSON sidecar before downstream drafting.",
      evidence: [evidence(markdownRelative || CASE_TIMELINE_MARKDOWN_RELATIVE), evidence(CASE_TIMELINE_JSON_RELATIVE)],
    });
  }
  if (!markdownExists && caseTimelineJson.exists) {
    addItem(items, {
      severity: "warning",
      category: "chronology",
      code: "listofdates_markdown_missing",
      title: "Case Timeline JSON exists without markdown",
      detail: "The machine-readable chronology exists, but the lawyer-facing markdown is missing.",
      action: "Refresh labels/rendering or regenerate the Case Timeline.",
      evidence: [evidence(caseTimelineJson.relativePath || CASE_TIMELINE_JSON_RELATIVE), evidence(CASE_TIMELINE_MARKDOWN_RELATIVE)],
    });
  }
  if (!markdownExists && !caseTimelineJson.exists && stageBySlash(status, "/describe_sources")?.state === "present") {
    addItem(items, {
      severity: "warning",
      category: "chronology",
      code: "listofdates_missing",
      title: "Case Timeline has not been generated",
      detail: "Source Labels exist, but the hero chronology artifact is missing.",
      action: "Run Build Case Timeline when the source labels are acceptable.",
      evidence: [evidence(CASE_TIMELINE_MARKDOWN_RELATIVE)],
    });
  }

  items.push(...buildRerunAdviceAttentionItems("chronology", caseTimelineAdvice, {
    staleTitle: "Case Timeline dependency state needs attention",
    staleAction: "Use the dependency state to choose label refresh, review, or regeneration.",
  }));
  return items;
}

async function readFirstJsonFile(root, relativePaths = []) {
  for (const relativePath of relativePaths) {
    const result = await readJsonFile(path.join(root, relativePath));
    if (result.exists) return { ...result, relativePath };
  }
  const fallback = relativePaths[0] || CASE_TIMELINE_JSON_RELATIVE;
  return { ...(await readJsonFile(path.join(root, fallback))), relativePath: fallback };
}

async function firstExistingRelativePath(root, relativePaths = []) {
  for (const relativePath of relativePaths) {
    if (await fileExists(path.join(root, relativePath))) return relativePath;
  }
  return "";
}

function addItem(items, item) {
  items.push(item);
}

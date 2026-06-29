import path from "node:path";
import { evidence, fileExists, readJsonFile, stageBySlash } from "./matter-attention-helpers.mjs";
import { buildRerunAdviceAttentionItems } from "./matter-attention-rerun-advice.mjs";
import {
  LIST_OF_DATES_JSON_RELATIVE,
  LIST_OF_DATES_MARKDOWN_RELATIVE,
} from "../shared/matter-artifacts.mjs";

export async function buildChronologyAttentionItems({ root, status } = {}) {
  const items = [];
  const listJson = await readJsonFile(path.join(root, LIST_OF_DATES_JSON_RELATIVE));
  const markdownExists = await fileExists(path.join(root, LIST_OF_DATES_MARKDOWN_RELATIVE));
  const listStage = stageBySlash(status, "/create_listofdates");
  const listAdvice = listStage?.rerunAdvice;

  if (listJson.exists && !listJson.valid) {
    addItem(items, {
      severity: "blocker",
      category: "chronology",
      code: "listofdates_json_unreadable",
      title: "Case Timeline JSON is unreadable",
      detail: listJson.error,
      action: "Repair or regenerate the Case Timeline before using chronology-dependent skills.",
      evidence: [evidence(LIST_OF_DATES_JSON_RELATIVE)],
    });
  }

  if (markdownExists && !listJson.exists) {
    addItem(items, {
      severity: "warning",
      category: "chronology",
      code: "listofdates_json_missing",
      title: "Case Timeline markdown exists without JSON metadata",
      detail: "The lawyer-facing markdown exists, but the machine-readable chronology state is missing.",
      action: "Regenerate the Case Timeline or recover the JSON sidecar before downstream drafting.",
      evidence: [evidence(LIST_OF_DATES_MARKDOWN_RELATIVE), evidence(LIST_OF_DATES_JSON_RELATIVE)],
    });
  }
  if (!markdownExists && listJson.exists) {
    addItem(items, {
      severity: "warning",
      category: "chronology",
      code: "listofdates_markdown_missing",
      title: "Case Timeline JSON exists without markdown",
      detail: "The machine-readable chronology exists, but the lawyer-facing markdown is missing.",
      action: "Refresh labels/rendering or regenerate the Case Timeline.",
      evidence: [evidence(LIST_OF_DATES_JSON_RELATIVE), evidence(LIST_OF_DATES_MARKDOWN_RELATIVE)],
    });
  }
  if (!markdownExists && !listJson.exists && stageBySlash(status, "/describe_sources")?.state === "present") {
    addItem(items, {
      severity: "warning",
      category: "chronology",
      code: "listofdates_missing",
      title: "Case Timeline has not been generated",
      detail: "Source Labels exist, but the hero chronology artifact is missing.",
      action: "Run Build Case Timeline when the source labels are acceptable.",
      evidence: [evidence(LIST_OF_DATES_MARKDOWN_RELATIVE)],
    });
  }

  items.push(...buildRerunAdviceAttentionItems("chronology", listAdvice, {
    staleTitle: "Case Timeline dependency state needs attention",
    staleAction: "Use the dependency state to choose label refresh, review, or regeneration.",
  }));
  return items;
}

function addItem(items, item) {
  items.push(item);
}

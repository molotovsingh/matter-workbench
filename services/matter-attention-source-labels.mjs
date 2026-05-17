import path from "node:path";
import {
  evidence,
  hasDeveloperNameLeak,
  hasExtractionArtifacts,
  normalizeText,
  readJsonFile,
  sampleSourceEvidence,
  stageBySlash,
} from "./matter-attention-helpers.mjs";
import { buildRerunAdviceAttentionItems } from "./matter-attention-rerun-advice.mjs";
import { SOURCE_INDEX_RELATIVE } from "../shared/matter-artifacts.mjs";

export async function buildSourceLabelAttentionItems({ root, status } = {}) {
  const items = [];
  const sourcePath = path.join(root, SOURCE_INDEX_RELATIVE);
  const sourceIndex = await readJsonFile(sourcePath);
  const sourceStage = stageBySlash(status, "/describe_sources");
  const sourceAdvice = sourceStage?.rerunAdvice;

  if (!sourceIndex.exists) {
    if (sourceStage?.state === "not_run" && hasExtractionArtifacts(status)) {
      addItem(items, {
        severity: "warning",
        category: "source_labels",
        code: "source_index_missing",
        title: "Source Index is missing",
        detail: "Extraction artifacts exist, but Source Labels / Document Index has not produced Source Index.json.",
        action: "Run Source Labels before generating or relying on List of Dates.",
        evidence: [evidence(SOURCE_INDEX_RELATIVE)],
      });
    }
    return items;
  }

  if (!sourceIndex.valid) {
    addItem(items, {
      severity: "blocker",
      category: "source_labels",
      code: "source_index_unreadable",
      title: "Source Index.json is unreadable",
      detail: sourceIndex.error,
      action: "Regenerate Source Labels or repair Source Index.json.",
      evidence: [evidence(SOURCE_INDEX_RELATIVE)],
    });
    return items;
  }

  const sources = Array.isArray(sourceIndex.data?.sources) ? sourceIndex.data.sources : null;
  if (!sources) {
    addItem(items, {
      severity: "blocker",
      category: "source_labels",
      code: "source_index_schema_invalid",
      title: "Source Index.json has no sources[] array",
      detail: "The artifact exists but does not match the expected Source Index shape.",
      action: "Regenerate Source Labels.",
      evidence: [evidence(SOURCE_INDEX_RELATIVE)],
    });
    return items;
  }

  const needsReview = sources.filter((source) => (
    source?.needs_review === true || normalizeText(source?.label_status) === "needs_review"
  ));
  if (needsReview.length) {
    addItem(items, {
      severity: "warning",
      category: "source_labels",
      code: "source_labels_need_review",
      title: "Some source labels need review",
      detail: `${needsReview.length} source label(s) are marked needs_review.`,
      action: "Confirm or override labels before relying on lawyer-facing citations.",
      evidence: sampleSourceEvidence(needsReview),
    });
  }

  const leakyLabels = sources.filter((source) => hasDeveloperNameLeak([
    source?.display_label,
    source?.short_label,
    source?.confirmed_label,
    source?.suggested_label,
  ]));
  if (leakyLabels.length) {
    addItem(items, {
      severity: "warning",
      category: "source_labels",
      code: "source_label_developer_name",
      title: "Some source labels contain developer identifiers",
      detail: `${leakyLabels.length} label(s) appear to expose internal file IDs, hashes, or paths.`,
      action: "Rename or confirm lawyer-safe labels before rendering downstream documents.",
      evidence: sampleSourceEvidence(leakyLabels),
    });
  }

  if (Number.isInteger(sourceIndex.data?.source_record_count) && sourceIndex.data.source_record_count !== sources.length) {
    addItem(items, {
      severity: "warning",
      category: "source_labels",
      code: "source_index_count_mismatch",
      title: "Source Index count does not match sources[]",
      detail: `source_record_count is ${sourceIndex.data.source_record_count}, but sources[] has ${sources.length} item(s).`,
      action: "Regenerate Source Labels if this was not an intentional legacy artifact.",
      evidence: [evidence(SOURCE_INDEX_RELATIVE)],
    });
  }

  items.push(...buildRerunAdviceAttentionItems("source_labels", sourceAdvice, {
    staleTitle: "Source Labels may be stale",
    staleAction: "Review rerun advice and regenerate labels if newer extraction records are material.",
  }));
  return items;
}

function addItem(items, item) {
  items.push(item);
}

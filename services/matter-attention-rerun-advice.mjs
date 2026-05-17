import { evidence, joinDetailSentences } from "./matter-attention-helpers.mjs";

export function buildRerunAdviceAttentionItems(category, advice, { staleTitle, staleAction } = {}) {
  if (!advice) return [];
  if (advice.state === "failed") {
    return [{
      severity: "blocker",
      category,
      code: `${category}_artifact_unreadable`,
      title: `${advice.label || advice.skill} artifact is unreadable`,
      detail: advice.reason || "Rerun advice could not read the current artifact.",
      action: "Repair or regenerate the artifact.",
      evidence: advice.artifactPath ? [evidence(advice.artifactPath)] : [],
    }];
  }
  if (advice.state === "stale") {
    return [{
      severity: "warning",
      category,
      code: `${category}_stale`,
      title: staleTitle,
      detail: joinDetailSentences([
        advice.reason,
        advice.dependencyState ? `Dependency state: ${advice.dependencyState}.` : "",
        advice.newestInputPath ? `Newest input: ${advice.newestInputPath}.` : "",
      ]),
      action: staleAction,
      evidence: [advice.artifactPath, advice.newestInputPath].filter(Boolean).map((item) => evidence(item)),
      occurredAt: advice.newestInputAt || "",
    }];
  }
  if (advice.state === "missing_upstream") {
    return [{
      severity: "warning",
      category,
      code: `${category}_missing_upstream`,
      title: `${advice.label || advice.skill} has no upstream inputs`,
      detail: "The artifact exists, but rerun advice did not find usable upstream inputs.",
      action: "Check extraction records and Source Index dependencies.",
      evidence: advice.artifactPath ? [evidence(advice.artifactPath)] : [],
    }];
  }
  return [];
}

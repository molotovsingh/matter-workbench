import { redactSensitiveText } from "../shared/secret-redaction.mjs";

export const FEEDBACK_TRIAGE_POLICY_VERSION = "private-beta-feedback-triage/v1";

export const TRIAGE_CLASSIFICATIONS = Object.freeze([
  "bug",
  "confusing_ux",
  "feature_request",
  "blocked_workflow",
  "legal_quality_concern",
  "operator_note",
  // Legacy historical rows remain readable, but new tester asks/classifier output use feature_request.
  "feature_idea",
]);

export const TRIAGE_ACTION_LANES = Object.freeze([
  "fix_now",
  "investigate",
  "product_decision",
  "watch",
]);

const VALID_CLASSIFICATIONS = new Set(TRIAGE_CLASSIFICATIONS);
const VALID_ACTION_LANES = new Set(TRIAGE_ACTION_LANES);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);
const PREPARATION_PIPELINE_RE = /no extraction records|run extract|source index|create_listofdates|list of dates|label sources|source labels?/;
const COPILOT_CITATION_RE = /unsupported citation|matter copilot returned unsupported citation/;
const AUTH_RE = /login|logged out|asking login|authentication/;
const LEGAL_QUALITY_RE = /wrong law|legal quality|incorrect legal|bad chronology|missed date|missing date|incomplete answer|hallucinat|unsupported legal|wrong party|limitation/i;

export function routePrivateBetaFeedbackTriage(item = {}, options = {}) {
  const currentness = normalizeText(item.currentness) || "unknown";
  const deterministic = deterministicTriage(item, { currentness });
  if (deterministic) return withPolicy(deterministic, "deterministic");

  const classifier = normalizeClassifierResult(options.classifierResult || item.classifierResult, item);
  if (classifier) return withPolicy(classifier, "classifier");

  return withPolicy(categoryFallbackTriage(item), "deterministic_fallback");
}

export function buildFeedbackTriagePacket(item = {}) {
  return {
    schema_version: "private-beta-feedback-triage-packet/v1",
    feedback: {
      id: normalizeText(item.id),
      classification: normalizeCategory(item.category),
      title: boundedText(item.title, 500),
      detail: boundedText(item.detail, 1000),
      matterName: boundedText(item.matterName, 200),
      receivedAt: normalizeText(item.receivedAt),
      currentness: normalizeText(item.currentness) || "unknown",
    },
    context: {
      installationId: boundedText(item.installationId, 160),
      occurrenceCount: positiveInteger(item.occurrenceCount, 1),
      relatedSignals: summarizeRelatedEvidence(item.relatedSignals),
      relatedJobs: summarizeRelatedEvidence(item.relatedJobs),
      currentMatterState: summarizeMatterState(item.currentMatterState),
    },
    allowed: {
      // Keep legacy feature_idea out of the classifier contract; report readers still accept old rows.
      classifications: TRIAGE_CLASSIFICATIONS.filter((value) => value !== "feature_idea"),
      actionLanes: TRIAGE_ACTION_LANES,
      confidence: ["high", "medium", "low"],
    },
    safetyRules: [
      "Deterministic hard-failure overrides win over model classification.",
      "Do not output product_backlog; use product_decision for feature requests.",
      "Use investigate when evidence is incomplete, malformed, or low confidence.",
      "Do not include provider secrets, prompts, source text, legal work product, or database URLs.",
    ],
  };
}

export function normalizeClassifierResult(result = null, item = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result) || !Object.keys(result).length) return null;
  const classification = normalizeCategory(result.classification);
  const actionLane = normalizeActionLane(result.action_lane || result.actionLane);
  const confidence = normalizeConfidence(result.confidence);
  const reason = boundedText(result.reason, 500) || "Classifier did not provide a reason.";
  const recommendedAction = boundedText(result.recommended_action || result.recommendedAction, 500)
    || recommendationForClassifier({ classification, actionLane });
  const missingEvidence = normalizeStringArray(result.missing_evidence || result.missingEvidence, 5, 180);
  const concreteEvidence = hasConcreteRelatedEvidence(item) || missingEvidence.length === 0 && normalizeBoolean(result.has_concrete_evidence || result.hasConcreteEvidence);

  if (!VALID_CLASSIFICATIONS.has(classification) || classification === "feature_idea") return malformedClassifierFallback("unsupported classification");
  if (!VALID_ACTION_LANES.has(actionLane)) return malformedClassifierFallback("unsupported action lane");
  if (!VALID_CONFIDENCE.has(confidence)) return malformedClassifierFallback("unsupported confidence");
  if (confidence === "low") return lowConfidenceFallback({ classification, reason, missingEvidence });
  if (actionLane === "fix_now" && (confidence !== "high" || !concreteEvidence)) {
    return {
      classification,
      action_lane: "investigate",
      confidence,
      reason: `Classifier requested fix_now without enough concrete evidence. ${reason}`.trim(),
      recommended_action: "Collect related runtime evidence before treating this as fix_now.",
      missing_evidence: missingEvidence.length ? missingEvidence : ["related job, signal, trace id, or reproducible current deployment evidence"],
    };
  }

  return {
    classification,
    action_lane: actionLane,
    confidence,
    reason,
    recommended_action: recommendedAction,
    missing_evidence: missingEvidence,
  };
}

function deterministicTriage(item = {}, { currentness = "unknown" } = {}) {
  const category = normalizeCategory(item.category);
  const text = itemText(item);

  if (category === "critical_signal") return criticalSignalTriage(text, { currentness });
  if (category === "warning_signal") return warningSignalTriage(item);

  if (category === "confusing_ux" && /cannot find|can't find|where.*(list of dates|chronology)|where did.*(list of dates|chronology)/.test(text) && !hasPreparationRelatedEvidence(item)) {
    return {
      classification: category,
      action_lane: "product_decision",
      confidence: "high",
      reason: "Tester is confused about finding an existing output, with no hard missing-output signal attached.",
      recommended_action: "Review navigation/copy for finding generated outputs before treating this as a runtime bug.",
      missing_evidence: [],
    };
  }

  if (hasPreparationPipelineFailure(item, text)) {
    if (currentness === "resolved_by_latest_matter_state") {
      return {
        classification: category,
        action_lane: "watch",
        confidence: "high",
        reason: "Latest matter health reports preparation is current and clear.",
        recommended_action: "No code action unless this reproduces. Latest matter health says preparation is current and the advisory is clear.",
        missing_evidence: [],
      };
    }
    return {
      classification: category,
      action_lane: "fix_now",
      confidence: "high",
      reason: "Feedback or a related signal points to the extraction/source-label/List of Dates pipeline.",
      recommended_action: "Verify matter preparation state and fix the extraction-to-source-labels/List of Dates path if records exist but downstream stages cannot see them.",
      missing_evidence: [],
    };
  }

  if (category === "bug" && COPILOT_CITATION_RE.test(text)) {
    if (currentness === "needs_live_recheck") {
      return {
        classification: category,
        action_lane: "investigate",
        confidence: "high",
        reason: "Unsupported citation bug was reported before later runtime evidence.",
        recommended_action: "Recheck this against the current deployment. Treat it as fix_now only if Copilot citation failure reproduces after the latest heartbeat or metrics snapshot.",
        missing_evidence: ["current deployment reproduction"],
      };
    }
    return {
      classification: category,
      action_lane: "fix_now",
      confidence: "high",
      reason: "Copilot returned or surfaced an unsupported citation.",
      recommended_action: "Keep Copilot fail-closed validation, but show a lawyer-safe source verification message and preserve the raw citation only in diagnostics.",
      missing_evidence: [],
    };
  }

  if (category === "bug" && AUTH_RE.test(text)) {
    return {
      classification: category,
      action_lane: "investigate",
      confidence: "high",
      reason: "Feedback appears to involve authentication or session persistence.",
      recommended_action: "Verify session persistence across reload, tab reopen, and deploy restart before changing auth behavior.",
      missing_evidence: ["current auth/session reproduction"],
    };
  }

  if (category === "legal_quality_concern" || (category === "bug" && LEGAL_QUALITY_RE.test(text))) {
    return {
      classification: "legal_quality_concern",
      action_lane: "investigate",
      confidence: "medium",
      reason: "Feedback appears to concern legal-output quality rather than a mechanical crash.",
      recommended_action: "Review the cited matter output against source records and decide whether this is prompt, model, extraction, or UX scope.",
      missing_evidence: ["source-backed reproduction and expected legal outcome"],
    };
  }

  return null;
}

function criticalSignalTriage(text, { currentness }) {
  if (PREPARATION_PIPELINE_RE.test(text)) {
    if (currentness === "resolved_by_latest_matter_state") {
      return {
        classification: "critical_signal",
        action_lane: "watch",
        confidence: "high",
        reason: "Latest matter health reports the prior preparation failure is resolved.",
        recommended_action: "No code action unless this reproduces. Latest matter health says preparation is current and the advisory is clear.",
        missing_evidence: [],
      };
    }
    return {
      classification: "critical_signal",
      action_lane: "fix_now",
      confidence: "high",
      reason: "Critical signal points to extraction/source-label/List of Dates preparation failure.",
      recommended_action: "Verify matter preparation state and fix the extraction-to-source-labels/List of Dates path if records exist but downstream stages cannot see them.",
      missing_evidence: [],
    };
  }
  return {
    classification: "critical_signal",
    action_lane: "fix_now",
    confidence: "high",
    reason: "Critical runtime signal received.",
    recommended_action: "Inspect the failed runtime path before the next beta session.",
    missing_evidence: [],
  };
}

function warningSignalTriage(item = {}) {
  if (positiveInteger(item.occurrenceCount, 1) > 1) {
    return {
      classification: "warning_signal",
      action_lane: "investigate",
      confidence: "high",
      reason: "Warning signal repeated in the report window.",
      recommended_action: "Check whether this warning is repeated for the same matter, user, or workflow.",
      missing_evidence: [],
    };
  }
  return {
    classification: "warning_signal",
    action_lane: "watch",
    confidence: "high",
    reason: "Single non-critical warning signal.",
    recommended_action: "Keep this as a watch item unless it repeats or is paired with tester feedback.",
    missing_evidence: [],
  };
}

function categoryFallbackTriage(item = {}) {
  const category = normalizeCategory(item.category);
  if (category === "bug") {
    return {
      classification: category,
      action_lane: "investigate",
      confidence: "medium",
      reason: "Bug feedback needs current reproduction evidence before code changes.",
      recommended_action: "Reproduce the reported bug in the current deployment and attach runtime evidence before fixing.",
      missing_evidence: ["current deployment reproduction"],
    };
  }
  if (category === "feature_request") {
    return {
      classification: category,
      action_lane: "product_decision",
      confidence: "high",
      reason: "Tester is asking for a net-new capability.",
      recommended_action: "Decide whether this is a net-new product feature for beta, then either scope it or park it in the product backlog.",
      missing_evidence: [],
    };
  }
  if (category === "confusing_ux" || category === "feature_idea") {
    return {
      classification: category,
      action_lane: "product_decision",
      confidence: "medium",
      reason: "Feedback appears to need product/UX judgment rather than immediate runtime repair.",
      recommended_action: "Decide whether this changes beta onboarding/copy or belongs in the parked product backlog.",
      missing_evidence: [],
    };
  }
  if (category === "blocked_workflow") {
    return {
      classification: category,
      action_lane: "investigate",
      confidence: "medium",
      reason: "Tester describes blocked work without a deterministic hard-failure signal.",
      recommended_action: "Correlate this with recent jobs, signals, and heartbeat journey state before deciding whether it is a bug or UX gap.",
      missing_evidence: ["related job, signal, or journey state"],
    };
  }
  if (category === "operator_note") {
    return {
      classification: category,
      action_lane: "watch",
      confidence: "medium",
      reason: "Operator note without hard-failure evidence.",
      recommended_action: "Keep this as operator context unless it repeats or attaches to a current failure.",
      missing_evidence: [],
    };
  }
  return {
    classification: category || "operator_note",
    action_lane: "watch",
    confidence: "medium",
    reason: "No hard failure or product-decision signal was found.",
    recommended_action: "No immediate action unless this appears again.",
    missing_evidence: [],
  };
}

function hasPreparationPipelineFailure(item = {}, text = itemText(item)) {
  if (PREPARATION_PIPELINE_RE.test(text) && /failed|missing|not found|cannot|can't|error|already ran|blocked|not created|not generated|not showing/.test(text)) return true;
  return hasPreparationRelatedEvidence(item);
}

function hasPreparationRelatedEvidence(item = {}) {
  return summarizeRelatedEvidence(item.relatedSignals).some((signal) => PREPARATION_PIPELINE_RE.test(itemText(signal)))
    || summarizeRelatedEvidence(item.relatedJobs).some((job) => PREPARATION_PIPELINE_RE.test(itemText(job)) && /failed|error|blocked|missing/.test(itemText(job)));
}

function hasConcreteRelatedEvidence(item = {}) {
  if (summarizeRelatedEvidence(item.relatedSignals).length) return true;
  if (summarizeRelatedEvidence(item.relatedJobs).length) return true;
  if (normalizeText(item.traceId || item.requestId || item.jobId || item.signalId)) return true;
  return Boolean(item.currentMatterState && typeof item.currentMatterState === "object");
}

function malformedClassifierFallback(reason) {
  return {
    classification: "operator_note",
    action_lane: "investigate",
    confidence: "medium",
    reason: `Classifier output ignored: ${reason}.`,
    recommended_action: "Investigate manually; classifier output was not usable.",
    missing_evidence: ["valid classifier JSON"],
  };
}

function lowConfidenceFallback({ classification, reason, missingEvidence }) {
  return {
    classification,
    action_lane: "investigate",
    confidence: "low",
    reason: `Low-confidence classifier output ignored. ${reason}`.trim(),
    recommended_action: "Investigate manually before assigning a fix or product decision.",
    missing_evidence: missingEvidence.length ? missingEvidence : ["higher-confidence classifier result or deterministic evidence"],
  };
}

function recommendationForClassifier({ classification, actionLane }) {
  if (actionLane === "product_decision" && classification === "feature_request") {
    return "Decide whether this requested capability belongs in beta scope or should remain parked.";
  }
  if (actionLane === "fix_now") return "Verify the attached evidence and fix the current runtime issue.";
  if (actionLane === "investigate") return "Investigate with related runtime evidence before changing code.";
  return "Watch for recurrence before taking action.";
}

function withPolicy(result, source) {
  return {
    policyVersion: FEEDBACK_TRIAGE_POLICY_VERSION,
    triage_source: source,
    ...result,
  };
}

function summarizeRelatedEvidence(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, 8)
    .map((item) => ({
      id: boundedText(item.id || item.signal_id || item.jobId || item.job_id || item.feedback_id, 120),
      category: boundedText(item.category || item.source_type || item.kind || item.status, 120),
      title: boundedText(item.title || item.label || item.stage || item.kind, 200),
      detail: boundedText(item.detail || item.errorMessage || item.message || item.error_message, 400),
      status: boundedText(item.status, 80),
    }));
}

function summarizeMatterState(state = null) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return {
    prepareState: boundedText(state.prepareState, 80),
    attentionState: boundedText(state.attentionState, 80),
    blockers: positiveInteger(state.blockers, 0),
    warnings: positiveInteger(state.warnings, 0),
    checkedAt: boundedText(state.checkedAt, 80),
  };
}

function itemText(item = {}) {
  if (!item || typeof item !== "object") return "";
  return normalizeReportText([
    item.title,
    item.detail,
    item.status,
    item.category,
    item.errorMessage,
    item.message,
  ].filter(Boolean).join(" "));
}

function normalizeCategory(value) {
  const text = normalizeText(value).toLowerCase();
  if (text === "feature_idea") return "feature_idea";
  if (text === "critical_signal" || text === "warning_signal") return text;
  return text.replace(/[\s-]+/g, "_");
}

function normalizeActionLane(value) {
  return normalizeText(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeConfidence(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeBoolean(value) {
  return value === true || normalizeText(value).toLowerCase() === "true";
}

function normalizeStringArray(value, limit, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, limit)
    .map((item) => boundedText(item, maxLength));
}

function boundedText(value, maxLength) {
  const text = normalizeText(redactSensitiveText(value)).replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeReportText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

import { CASE_TIMELINE_DEPENDENCY_STATES } from "./case-timeline-dependency-states.mjs";
import {
  CASE_TIMELINE_SKILL_SLASH,
  CASE_TIMELINE_STAGE_ID,
  LEGACY_LIST_OF_DATES_SKILL_SLASH,
} from "./case-timeline-operation.mjs";
import { REQUIRED_METADATA } from "./matter-contract.mjs";
import { PREPARATION_STAGE_ACTIONS } from "./preparation-stage-actions.mjs";

export const PREPARE_STAGE_DEFINITIONS = [
  {
    id: "matter-init",
    slash: "/matter-init",
    label: "Set up matter",
    description: "Create matter metadata, intake registers, and preserved source folders.",
    paidProviderCall: false,
  },
  {
    id: "extract",
    slash: "/extract",
    label: "Extract documents",
    description: "Build source-backed extraction records from registered working copies.",
    paidProviderCall: false,
  },
  {
    id: "describe-sources",
    slash: "/describe_sources",
    label: "Label sources",
    description: "Create lawyer-readable source labels in Source Index.json.",
    paidProviderCall: true,
  },
  {
    id: CASE_TIMELINE_STAGE_ID,
    slash: CASE_TIMELINE_SKILL_SLASH,
    label: "Build Case Timeline",
    description: "Build a source-backed chronology for lawyer review.",
    paidProviderCall: true,
  },
  {
    id: "dispute-story",
    slash: "/the_story",
    label: "Write dispute story",
    description: "Turn the Case Timeline into a short matter description for intake metadata.",
    paidProviderCall: true,
  },
  {
    id: "procedural-posture-diagnosis",
    slash: "/procedural_posture_diagnosis",
    label: "Diagnose procedural posture",
    description: "Infer the filing forum, procedural posture, possible remedies, and lawyer-confirmation points.",
    paidProviderCall: true,
  },
];

export function normalizePreparationStageSlash(slash) {
  const value = String(slash || "").trim();
  if (value === LEGACY_LIST_OF_DATES_SKILL_SLASH) return CASE_TIMELINE_SKILL_SLASH;
  return value;
}

export function prepareStageDefinition(slash) {
  const normalizedSlash = normalizePreparationStageSlash(slash);
  return PREPARE_STAGE_DEFINITIONS.find((candidate) => candidate.slash === normalizedSlash);
}

export function missingMetadataLabels(metadata = {}) {
  return REQUIRED_METADATA
    .filter(({ key }) => !(typeof metadata[key] === "string" && metadata[key].trim()))
    .map(({ label }) => label);
}

export function warningsForPlan({ missingMetadata, stages, listOfDates, disputeStory = null, proceduralPostureDiagnosis = null }) {
  const warnings = [];
  if (missingMetadata.length) {
    warnings.push(`Missing metadata: ${missingMetadata.join(", ")}`);
  }
  if (stages.some((stage) => stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN)) {
    warnings.push("Automatic preparation may make paid AI provider calls.");
  }
  if (listOfDates?.action === PREPARATION_STAGE_ACTIONS.RUN && listOfDates?.rerunAdvice?.dependencyState === CASE_TIMELINE_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED) {
    warnings.push("Case Timeline only needs a label refresh; chronology regeneration is not required.");
  }
  if (disputeStory?.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN) {
    warnings.push("The Story will use a paid AI provider call before filling the intake dispute description.");
  }
  if (proceduralPostureDiagnosis?.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN) {
    warnings.push("Procedural posture diagnosis will use a paid AI provider call and remains provisional until lawyer confirmation.");
  }
  return warnings;
}

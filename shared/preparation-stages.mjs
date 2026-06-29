import { LIST_OF_DATES_DEPENDENCY_STATES } from "./listofdates-dependency-states.mjs";
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
    id: "create-listofdates",
    slash: "/create_listofdates",
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
];

export function prepareStageDefinition(slash) {
  return PREPARE_STAGE_DEFINITIONS.find((candidate) => candidate.slash === slash);
}

export function missingMetadataLabels(metadata = {}) {
  return REQUIRED_METADATA
    .filter(({ key }) => !(typeof metadata[key] === "string" && metadata[key].trim()))
    .map(({ label }) => label);
}

export function warningsForPlan({ missingMetadata, stages, listOfDates, disputeStory = null }) {
  const warnings = [];
  if (missingMetadata.length) {
    warnings.push(`Missing metadata: ${missingMetadata.join(", ")}`);
  }
  if (stages.some((stage) => stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN)) {
    warnings.push("Automatic preparation may make paid AI provider calls.");
  }
  if (listOfDates?.action === PREPARATION_STAGE_ACTIONS.RUN && listOfDates?.rerunAdvice?.dependencyState === LIST_OF_DATES_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED) {
    warnings.push("Case Timeline only needs a label refresh; chronology regeneration is not required.");
  }
  if (disputeStory?.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN) {
    warnings.push("The Story will use a paid AI provider call before filling the intake dispute description.");
  }
  return warnings;
}

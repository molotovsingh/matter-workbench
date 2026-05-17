import path from "node:path";
import { REQUIRED_METADATA } from "../shared/matter-contract.mjs";

const PREPARE_SCHEMA_VERSION = "prepare-matter-plan/v1";

const STAGE_DEFINITIONS = [
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
];

export function createPrepareMatterService({ matterStore, matterStatusService } = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!matterStatusService) throw new Error("matterStatusService is required");

  async function readPrepareMatterPlan() {
    const root = matterStore.getMatterRoot?.();
    if (!root) return noActiveMatterPlan();

    const status = await matterStatusService.readMatterStatus(root);
    const metadata = await readMetadata(root);
    const missingMetadata = missingMetadataLabels(metadata);
    const stageBySlash = new Map((status.stages || []).map((stage) => [stage.slash, stage]));

    const matterInitStage = stageBySlash.get("/matter-init") || null;
    const extractStage = stageBySlash.get("/extract") || null;
    const sourceStage = stageBySlash.get("/describe_sources") || null;
    const listStage = stageBySlash.get("/create_listofdates") || null;

    const setup = buildSetupStage(matterInitStage, missingMetadata);
    const extraction = buildExtractionStage(extractStage, setup);
    const sourceLabels = buildSourceLabelsStage(sourceStage, extraction);
    const runnableStages = [setup, extraction, sourceLabels];
    const listOfDates = buildListOfDatesRecommendation(listStage, sourceLabels);
    const nextStage = firstActionableStage(runnableStages);

    return {
      schema_version: PREPARE_SCHEMA_VERSION,
      matter: {
        name: metadata.matterName || status.matterName || path.basename(root),
        folderName: status.matterName || path.basename(root),
      },
      metadata: {
        missing: missingMetadata,
        complete: missingMetadata.length === 0,
      },
      stages: runnableStages,
      downstream: {
        listOfDates,
      },
      nextStep: nextStage
        ? nextStepSummary(nextStage)
        : {
          state: "complete",
          label: "Core preparation is current",
          message: "Review the Analysis Library or run local context search.",
          stage: "",
          slash: "",
        },
      warnings: warningsForPlan({ missingMetadata, stages: runnableStages, listOfDates }),
    };
  }

  async function readMetadata(root) {
    try {
      return await matterStore.readMatterMetadata(root);
    } catch {
      return {
        clientName: "",
        matterName: path.basename(root),
        oppositeParty: "",
        matterType: "",
        jurisdiction: "",
        briefDescription: "",
      };
    }
  }

  return { readPrepareMatterPlan };
}

function noActiveMatterPlan() {
  return {
    schema_version: PREPARE_SCHEMA_VERSION,
    matter: {
      name: "",
      folderName: "",
    },
    metadata: {
      missing: [],
      complete: false,
    },
    stages: [],
    downstream: {
      listOfDates: {
        id: "create-listofdates",
        slash: "/create_listofdates",
        label: "Create list of dates",
        state: "not_selected",
        action: "blocked",
        reason: "Pick or create a matter first.",
        artifacts: [],
      },
    },
    nextStep: {
      state: "not_selected",
      label: "Pick a matter",
      message: "Pick or create a matter before preparing it.",
      stage: "",
      slash: "",
    },
    warnings: [],
  };
}

function buildSetupStage(stage, missingMetadata) {
  const base = stageBase("/matter-init", stage);
  if (stage?.present) {
    return {
      ...base,
      state: "current",
      action: "skip_current",
      reason: "Matter setup artifacts are already present.",
    };
  }
  if (missingMetadata.length) {
    return {
      ...base,
      state: "blocked",
      action: "blocked",
      reason: `Required metadata is missing: ${missingMetadata.join(", ")}.`,
    };
  }
  return {
    ...base,
    state: "ready_to_run",
    action: "run",
    reason: "Matter setup has not run yet.",
  };
}

function buildExtractionStage(stage, setupStage) {
  const base = stageBase("/extract", stage);
  if (stage?.present) {
    if (!hasUsableExtractionRecords(stage)) {
      return {
        ...base,
        state: "blocked",
        action: "blocked",
        reason: "Extraction has run, but no usable extraction records were found. Review the Extraction Log before labeling sources.",
      };
    }
    return {
      ...base,
      state: "current",
      action: "skip_current",
      reason: "Extraction records or logs are already present.",
    };
  }
  if (setupStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: "blocked",
      reason: "Set up the matter before extracting documents.",
    };
  }
  return {
    ...base,
    state: "ready_to_run",
    action: "run",
    reason: "Extraction records are missing.",
  };
}

function hasUsableExtractionRecords(stage) {
  return Array.isArray(stage?.artifacts)
    && stage.artifacts.some((artifact) => /_extracted\b.*\([1-9][0-9]* records?\)/i.test(artifact));
}

function buildSourceLabelsStage(stage, extractionStage) {
  const base = stageBase("/describe_sources", stage);
  const advice = stage?.rerunAdvice || null;
  const adviceState = advice?.state || (stage?.present ? "present" : "missing");

  if (adviceState === "current") {
    return {
      ...base,
      state: "current",
      action: "skip_current",
      reason: "Source labels are current.",
      rerunAdvice: advice,
    };
  }
  if (extractionStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: "blocked",
      reason: "Extract documents before labeling sources.",
      rerunAdvice: advice,
    };
  }
  if (adviceState === "missing_upstream") {
    return {
      ...base,
      state: "blocked",
      action: "blocked",
      reason: "Extraction inputs are missing.",
      rerunAdvice: advice,
    };
  }
  return {
    ...base,
    state: adviceState === "stale" ? "stale" : adviceState === "failed" ? "failed" : "missing",
    action: "confirm_paid_run",
    reason: sourceLabelReason(adviceState),
    rerunAdvice: advice,
  };
}

function buildListOfDatesRecommendation(stage, sourceLabelsStage) {
  const base = {
    id: "create-listofdates",
    slash: "/create_listofdates",
    label: "Create list of dates",
    artifacts: Array.isArray(stage?.artifacts) ? stage.artifacts : [],
    aiRun: stage?.aiRun || null,
    metrics: stage?.metrics || null,
    rerunAdvice: stage?.rerunAdvice || null,
  };
  const adviceState = stage?.rerunAdvice?.state || (stage?.present ? "present" : "missing");
  if (adviceState === "current") {
    return {
      ...base,
      state: "current",
      action: "recommend_review",
      reason: "List of Dates already exists and appears current.",
    };
  }
  if (sourceLabelsStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: "recommend_after_prepare",
      reason: "Label sources before creating the List of Dates.",
    };
  }
  return {
    ...base,
    state: adviceState === "stale" ? "stale" : "missing",
    action: "recommend_separate_skill",
    reason: "Run Create list of dates separately after preparation.",
  };
}

function stageBase(slash, statusStage) {
  const definition = STAGE_DEFINITIONS.find((candidate) => candidate.slash === slash);
  const display = statusStage?.display || null;
  return {
    id: definition.id,
    slash,
    label: display?.action || definition.label,
    ...(display ? { display } : {}),
    description: definition.description,
    paidProviderCall: definition.paidProviderCall,
    artifacts: Array.isArray(statusStage?.artifacts) ? statusStage.artifacts : [],
    aiRun: statusStage?.aiRun || null,
  };
}

function firstActionableStage(stages) {
  return stages.find((stage) => stage.action === "run" || stage.action === "confirm_paid_run")
    || stages.find((stage) => stage.action === "blocked")
    || null;
}

function nextStepSummary(stage) {
  if (stage.action === "run") {
    return {
      state: stage.state,
      label: stage.label,
      message: `Next safe step: run ${stage.label}.`,
      stage: stage.id,
      slash: stage.slash,
    };
  }
  if (stage.action === "confirm_paid_run") {
    return {
      state: stage.state,
      label: stage.label,
      message: `Next step: confirm paid source labeling before running ${stage.label}.`,
      stage: stage.id,
      slash: stage.slash,
    };
  }
  return {
    state: stage.state,
    label: stage.label,
    message: stage.reason || "Resolve the blocked stage before continuing.",
    stage: stage.id,
    slash: stage.slash,
  };
}

function sourceLabelReason(state) {
  if (state === "stale") return "Newer extraction records were found; source labels need confirmation before rerun.";
  if (state === "failed") return "Existing Source Index could not be read; source labeling needs confirmation before rerun.";
  return "Source labels are missing and require a paid AI confirmation before running.";
}

function warningsForPlan({ missingMetadata, stages, listOfDates }) {
  const warnings = [];
  if (missingMetadata.length) {
    warnings.push(`Missing metadata: ${missingMetadata.join(", ")}`);
  }
  if (stages.some((stage) => stage.action === "confirm_paid_run")) {
    warnings.push("Label sources may make a paid AI provider call.");
  }
  if (listOfDates?.action === "recommend_separate_skill") {
    warnings.push("List of Dates is not part of preparation V0; run it separately after source labels are ready.");
  }
  return warnings;
}

function missingMetadataLabels(metadata = {}) {
  return REQUIRED_METADATA
    .filter(({ key }) => !(typeof metadata[key] === "string" && metadata[key].trim()))
    .map(({ label }) => label);
}

import path from "node:path";
import { LIST_OF_DATES_DEPENDENCY_STATES } from "../shared/listofdates-dependency-states.mjs";
import { PREPARATION_STAGE_ACTIONS } from "../shared/preparation-stage-actions.mjs";
import { missingMetadataLabels, PREPARE_STAGE_DEFINITIONS, warningsForPlan } from "../shared/preparation-stages.mjs";

const PREPARE_SCHEMA_VERSION = "prepare-matter-plan/v1";

export function createPrepareMatterService({ matterStore, matterStatusService, matterStoryService = null, proceduralPostureDiagnosisService = null } = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!matterStatusService) throw new Error("matterStatusService is required");

  async function readPrepareMatterPlan(root = matterStore.getMatterRoot?.()) {
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
    const listOfDates = buildListOfDatesStage(listStage, sourceLabels);
    const storyStatus = matterStoryService?.readDisputeStoryStatus
      ? await matterStoryService.readDisputeStoryStatus(root)
      : null;
    const disputeStory = buildDisputeStoryStage(storyStatus, listOfDates);
    const postureStatus = proceduralPostureDiagnosisService?.readDiagnosisStatus
      ? await proceduralPostureDiagnosisService.readDiagnosisStatus(root)
      : null;
    const proceduralPostureDiagnosis = buildProceduralPostureDiagnosisStage(postureStatus, disputeStory);
    const runnableStages = [setup, extraction, sourceLabels, listOfDates, disputeStory, proceduralPostureDiagnosis].filter(Boolean);
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
        ...(disputeStory ? { disputeStory } : {}),
        ...(proceduralPostureDiagnosis ? { proceduralPostureDiagnosis } : {}),
      },
      nextStep: nextStage
        ? nextStepSummary(nextStage)
        : {
          state: "complete",
          label: "Core preparation is current",
          message: "Review the preparation advisory before drafting.",
          stage: "",
          slash: "",
        },
      warnings: warningsForPlan({ missingMetadata, stages: runnableStages, listOfDates, disputeStory, proceduralPostureDiagnosis }),
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
        label: "Build Case Timeline",
        state: "not_selected",
        action: PREPARATION_STAGE_ACTIONS.BLOCKED,
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
      action: PREPARATION_STAGE_ACTIONS.SKIP_CURRENT,
      reason: "Matter setup artifacts are already present.",
    };
  }
  if (missingMetadata.length) {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: `Required metadata is missing: ${missingMetadata.join(", ")}.`,
    };
  }
  return {
    ...base,
    state: "ready_to_run",
    action: PREPARATION_STAGE_ACTIONS.RUN,
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
        action: PREPARATION_STAGE_ACTIONS.BLOCKED,
        reason: "Extraction has run, but no usable extraction records were found. Review the Extraction Log before labeling sources.",
      };
    }
    return {
      ...base,
      state: "current",
      action: PREPARATION_STAGE_ACTIONS.SKIP_CURRENT,
      reason: "Extraction records or logs are already present.",
    };
  }
  if (setupStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: "Set up the matter before extracting documents.",
    };
  }
  return {
    ...base,
    state: "ready_to_run",
    action: PREPARATION_STAGE_ACTIONS.RUN,
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
      action: PREPARATION_STAGE_ACTIONS.SKIP_CURRENT,
      reason: "Source labels are current.",
      rerunAdvice: advice,
    };
  }
  if (extractionStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: "Extract documents before labeling sources.",
      rerunAdvice: advice,
    };
  }
  if (adviceState === "missing_upstream") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: "Extraction inputs are missing.",
      rerunAdvice: advice,
    };
  }
  return {
    ...base,
    state: adviceState === "stale" ? "stale" : adviceState === "failed" ? "failed" : "missing",
    action: PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN,
    reason: sourceLabelReason(adviceState),
    rerunAdvice: advice,
  };
}

function buildListOfDatesStage(stage, sourceLabelsStage) {
  const base = {
    ...stageBase("/create_listofdates", stage),
    metrics: stage?.metrics || null,
    rerunAdvice: stage?.rerunAdvice || null,
  };
  const adviceState = stage?.rerunAdvice?.state || (stage?.present ? "present" : "missing");
  if (adviceState === "current") {
    return {
      ...base,
      state: "current",
      action: PREPARATION_STAGE_ACTIONS.SKIP_CURRENT,
      reason: "Case Timeline already exists and appears current.",
    };
  }
  if (sourceLabelsStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: "Label sources before building the Case Timeline.",
    };
  }
  if (adviceState === "missing_upstream") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: "Source label inputs are missing.",
    };
  }
  if (adviceState === "stale" && stage?.rerunAdvice?.dependencyState === LIST_OF_DATES_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED) {
    return {
      ...base,
      paidProviderCall: false,
      state: "stale",
      action: PREPARATION_STAGE_ACTIONS.RUN,
      reason: "Source labels changed after the chronology was rendered. Refresh labels without regenerating the chronology.",
    };
  }
  return {
    ...base,
    state: adviceState === "stale" ? "stale" : adviceState === "failed" ? "failed" : "missing",
    action: PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN,
    reason: listOfDatesReason(adviceState),
  };
}

function buildDisputeStoryStage(storyStatus, listOfDatesStage) {
  if (!storyStatus?.hasActiveSkill) return null;
  const base = {
    ...stageBase("/the_story", null),
    artifacts: storyStatus.storyMarkdownPresent ? [storyStatus.artifactPath || "20_Workshop/The Story.md"] : [],
  };
  if (listOfDatesStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: "Build the Case Timeline before writing the dispute story.",
    };
  }
  if (storyStatus.storyStale) {
    return {
      ...base,
      state: "stale",
      action: PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN,
      reason: "The Case Timeline changed after The Story was written. Refresh the Matter Workbench story.",
    };
  }
  if (storyStatus.storyMarkdownPresent && !storyStatus.briefDescriptionManagedByMatterWorkbench) {
    return {
      ...base,
      paidProviderCall: false,
      state: "ready_to_run",
      action: PREPARATION_STAGE_ACTIONS.RUN,
      reason: "The Story exists; update the Matter Workbench story on the matter overview.",
    };
  }
  if (storyStatus.storyMarkdownPresent && storyStatus.briefDescriptionManagedByMatterWorkbench) {
    return {
      ...base,
      state: "current",
      action: PREPARATION_STAGE_ACTIONS.SKIP_CURRENT,
      reason: "The Matter Workbench story is current.",
    };
  }
  return {
    ...base,
    state: "missing",
    action: PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN,
    reason: "The dispute story is missing and uses AI after the Case Timeline is ready.",
  };
}

function buildProceduralPostureDiagnosisStage(postureStatus, disputeStoryStage) {
  if (!postureStatus) return null;
  const base = {
    ...stageBase("/procedural_posture_diagnosis", null),
    artifacts: postureStatus.markdownPresent ? [postureStatus.artifactPath || "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md"] : [],
    postureStatus,
  };
  if (!disputeStoryStage || disputeStoryStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: "Write the Matter Story before diagnosing filing and procedural posture.",
    };
  }
  if (postureStatus.state === "blocked") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: postureStatus.blockedReasons?.join(" ") || "Case Timeline and Matter Story are required first.",
    };
  }
  if (postureStatus.state === "stale" || postureStatus.state === "needs_reconfirmation") {
    return {
      ...base,
      state: "stale",
      action: PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN,
      reason: "Case Timeline or Matter Story changed after the procedural posture diagnosis. Refresh the diagnosis before downstream drafting.",
    };
  }
  if (postureStatus.markdownPresent || postureStatus.jsonPresent) {
    return {
      ...base,
      state: postureStatus.state === "current_confirmed" || postureStatus.state === "current_corrected" ? "current" : "current_unconfirmed",
      action: PREPARATION_STAGE_ACTIONS.SKIP_CURRENT,
      reason: postureStatus.state === "current_confirmed" || postureStatus.state === "current_corrected"
        ? "Procedural posture diagnosis is current and lawyer confirmation has been recorded."
        : "Procedural posture diagnosis is current but still needs lawyer confirmation.",
    };
  }
  return {
    ...base,
    state: "missing",
    action: PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN,
    reason: "Filing and procedural posture diagnosis is missing and uses AI after Case Timeline and Matter Story are ready.",
  };
}

function stageBase(slash, statusStage) {
  const definition = PREPARE_STAGE_DEFINITIONS.find((candidate) => candidate.slash === slash);
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
  return stages.find((stage) => stage.action === PREPARATION_STAGE_ACTIONS.RUN || stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN)
    || stages.find((stage) => stage.action === PREPARATION_STAGE_ACTIONS.BLOCKED)
    || null;
}

function nextStepSummary(stage) {
  if (stage.action === PREPARATION_STAGE_ACTIONS.RUN) {
    return {
      state: stage.state,
      label: stage.label,
      message: `Next safe step: run ${stage.label}.`,
      stage: stage.id,
      slash: stage.slash,
    };
  }
  if (stage.action === PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN) {
    const paidTarget = stage.slash === "/describe_sources" ? "source labeling" : stage.label;
    return {
      state: stage.state,
      label: stage.label,
      message: `Next step: confirm paid ${paidTarget} before running ${stage.label}.`,
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

function listOfDatesReason(state) {
  if (state === "stale") return "Newer source material may affect the Case Timeline; regeneration needs a paid AI confirmation.";
  if (state === "failed") return "Existing Case Timeline metadata could not be read; regeneration needs confirmation.";
  return "Case Timeline is missing and requires a paid AI confirmation before running.";
}

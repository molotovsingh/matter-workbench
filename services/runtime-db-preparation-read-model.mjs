import {
  CASE_TIMELINE_JSON_RELATIVE,
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  SOURCE_INDEX_RELATIVE,
  isCaseTimelineReadModelPath,
} from "../shared/matter-artifacts.mjs";
import { PREPARATION_STAGE_ACTIONS } from "../shared/preparation-stage-actions.mjs";
import { RERUN_ADVICE_STATES } from "../shared/rerun-advice-states.mjs";
import { missingMetadataLabels, prepareStageDefinition, warningsForPlan } from "../shared/preparation-stages.mjs";
import {
  DISPUTE_STORY_BASIS_RELATIVE,
  DISPUTE_STORY_OUTPUT_RELATIVE,
  isMatterWorkbenchStorySource,
} from "./matter-story-service.mjs";
import {
  PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE,
  PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE,
} from "./procedural-posture-diagnosis-service.mjs";
import { validatedRelativePathFromRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";
import { runtimeWorkspaceFilePaths } from "./runtime-db-workspace-read-model.mjs";

export function runtimeMatterStatusFromWorkspaceState({ matter, objects = [], tree } = {}) {
  const paths = runtimeWorkspaceFilePaths(tree.root);
  const runtimeInputs = runtimeStatusInputs({ matter, objects });
  const stages = [
    statusStage({
      id: "matter-init",
      slash: "/matter-init",
      label: "Set Up Matter",
      present: paths.some((item) => /(^|\/)File Register\.csv$/i.test(item.path)) || Boolean(matter.id),
      artifacts: paths.filter((item) => /(^|\/)File Register\.csv$/i.test(item.path)).map((item) => item.path),
    }),
    statusStage({
      id: "extract",
      slash: "/extract",
      label: "Extract Documents",
      present: paths.some((item) => /(^|\/)_extracted\/[^/]+\.json$/i.test(item.path)),
      artifacts: extractedArtifacts(paths),
      rerunAdvice: runtimeExtractRerunAdvice(runtimeInputs),
    }),
    statusStage({
      id: "describe-sources",
      slash: "/describe_sources",
      label: "Source Labels / Document Index",
      present: paths.some((item) => item.path === SOURCE_INDEX_RELATIVE),
      artifacts: paths.filter((item) => item.path === SOURCE_INDEX_RELATIVE).map((item) => item.path),
      rerunAdvice: runtimeSourceLabelsRerunAdvice(runtimeInputs),
    }),
    statusStage({
      id: "create-listofdates",
      slash: "/create_listofdates",
      label: "Build Case Timeline",
      present: paths.some((item) => isCaseTimelineReadModelPath(item.path)),
      artifacts: paths
        .filter((item) => isCaseTimelineReadModelPath(item.path))
        .map((item) => item.path),
      rerunAdvice: runtimeCaseTimelineRerunAdvice(runtimeInputs),
    }),
  ];
  return {
    matterRoot: `postgres:${matter.name}`,
    matterName: matter.name,
    stages,
  };
}

export function runtimePrepareMatterPlanFromStatus({ matter, dbMatter = {}, status, workspaceFiles = [], disputeStory = null } = {}) {
  const missingMetadata = missingMetadataLabels(dbMatter);
  const stageBySlash = new Map(status.stages.map((stage) => [stage.slash, stage]));
  const setup = prepareStage("/matter-init", stageBySlash.get("/matter-init"));
  const extraction = prepareStage("/extract", stageBySlash.get("/extract"), setup);
  const sourceLabels = prepareStage("/describe_sources", stageBySlash.get("/describe_sources"), extraction);
  const caseTimeline = prepareStage("/create_listofdates", stageBySlash.get("/create_listofdates"), sourceLabels);
  const disputeStoryStage = disputeStory?.hasActiveSkill
    ? runtimeDisputeStoryStage({ storyStatus: runtimeDisputeStoryStatus({ workspaceFiles, matterJson: disputeStory.matterJson || {} }), caseTimelineStage: caseTimeline })
    : null;
  const proceduralPostureDiagnosis = disputeStory?.hasActiveSkill
    ? runtimeProceduralPostureDiagnosisStage({ workspaceFiles, disputeStoryStage })
    : null;
  const stages = [setup, extraction, sourceLabels, caseTimeline, disputeStoryStage, proceduralPostureDiagnosis].filter(Boolean);
  const nextStep = stages.find((stage) => stage.action !== PREPARATION_STAGE_ACTIONS.SKIP_CURRENT);
  return {
    schema_version: "prepare-matter-plan/v1",
    matter: {
      name: matter.matterName || matter.name,
      folderName: matter.name,
    },
    metadata: {
      missing: missingMetadata,
      complete: missingMetadata.length === 0,
    },
    stages,
    downstream: {
      listOfDates: caseTimeline,
      ...(disputeStoryStage ? { disputeStory: disputeStoryStage } : {}),
      ...(proceduralPostureDiagnosis ? { proceduralPostureDiagnosis } : {}),
    },
    nextStep: nextStep
      ? {
          state: nextStep.state,
          label: nextStep.label,
          message: nextStep.reason,
          stage: nextStep.id,
          slash: nextStep.slash,
        }
      : {
          state: "complete",
          label: "Core preparation is current",
          message: "Review the preparation advisory before drafting.",
          stage: "",
          slash: "",
        },
    warnings: warningsForPlan({ missingMetadata, stages, listOfDates: caseTimeline, disputeStory: disputeStoryStage, proceduralPostureDiagnosis }),
  };
}

function runtimeDisputeStoryStatus({ workspaceFiles = [], matterJson = {} } = {}) {
  const byPath = new Map((workspaceFiles || []).map((item) => [item.path, item]));
  const story = byPath.get(DISPUTE_STORY_OUTPUT_RELATIVE) || null;
  const caseTimeline = newestWorkspaceFile([
    byPath.get(DISPUTE_STORY_BASIS_RELATIVE),
    byPath.get(CASE_TIMELINE_JSON_RELATIVE),
  ].filter(Boolean));
  return {
    storyMarkdownPresent: Boolean(story),
    storyStale: Boolean(story && caseTimeline && (Date.parse(caseTimeline.updatedAt || "") || 0) > (Date.parse(story.updatedAt || "") || 0) + 1),
    briefDescriptionPresent: Boolean(String(matterJson.brief_description || "").trim()),
    briefDescriptionManagedByMatterWorkbench: isMatterWorkbenchStorySource(matterJson.brief_description_source),
    artifactPath: DISPUTE_STORY_OUTPUT_RELATIVE,
  };
}

function newestWorkspaceFile(files = []) {
  return files.reduce((newest, file) => (
    !newest || (Date.parse(file.updatedAt || "") || 0) > (Date.parse(newest.updatedAt || "") || 0) ? file : newest
  ), null);
}

function runtimeDisputeStoryStage({ storyStatus, caseTimelineStage } = {}) {
  const definition = prepareStageDefinition("/the_story");
  const base = {
    id: definition.id,
    slash: definition.slash,
    label: definition.label,
    description: definition.description,
    paidProviderCall: definition.paidProviderCall,
    artifacts: storyStatus.storyMarkdownPresent ? [storyStatus.artifactPath || DISPUTE_STORY_OUTPUT_RELATIVE] : [],
  };
  if (caseTimelineStage.state !== "current") {
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

function runtimeProceduralPostureDiagnosisStage({ workspaceFiles = [], disputeStoryStage = null } = {}) {
  const definition = prepareStageDefinition("/procedural_posture_diagnosis");
  if (!definition) return null;
  const byPath = new Map((workspaceFiles || []).map((item) => [item.path, item]));
  const markdown = byPath.get(PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE) || null;
  const json = byPath.get(PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE) || null;
  const diagnosis = newestWorkspaceFile([markdown, json].filter(Boolean));
  const timeline = newestWorkspaceFile([
    byPath.get(DISPUTE_STORY_BASIS_RELATIVE),
    byPath.get(CASE_TIMELINE_JSON_RELATIVE),
  ].filter(Boolean));
  const story = byPath.get(DISPUTE_STORY_OUTPUT_RELATIVE) || null;
  const base = {
    id: definition.id,
    slash: definition.slash,
    label: definition.label,
    description: definition.description,
    paidProviderCall: definition.paidProviderCall,
    artifacts: [
      ...(markdown ? [PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE] : []),
      ...(json ? [PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE] : []),
    ],
  };
  if (!disputeStoryStage || disputeStoryStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: "Write the Matter Story before diagnosing filing and procedural posture.",
    };
  }
  if (!timeline || !story) {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: "Case Timeline and Matter Story are required before procedural posture diagnosis.",
    };
  }
  if (diagnosis && newestWorkspaceFile([timeline, story]).updatedAt && (Date.parse(newestWorkspaceFile([timeline, story]).updatedAt || "") || 0) > (Date.parse(diagnosis.updatedAt || "") || 0) + 1) {
    return {
      ...base,
      state: "stale",
      action: PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN,
      reason: "Case Timeline or Matter Story changed after the procedural posture diagnosis. Refresh the diagnosis before downstream drafting.",
    };
  }
  if (diagnosis) {
    return {
      ...base,
      state: "current_unconfirmed",
      action: PREPARATION_STAGE_ACTIONS.SKIP_CURRENT,
      reason: "Procedural posture diagnosis is current but still needs lawyer confirmation.",
    };
  }
  return {
    ...base,
    state: "missing",
    action: PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN,
    reason: "Filing and procedural posture diagnosis is missing and uses AI after Case Timeline and Matter Story are ready.",
  };
}

function extractedArtifacts(paths = []) {
  const extracted = paths.filter((item) => /(^|\/)_extracted\/[^/]+\.json$/i.test(item.path));
  if (!extracted.length) return [];
  const byDirectory = new Map();
  for (const item of extracted) {
    const directory = item.path.replace(/\/[^/]+$/, "");
    byDirectory.set(directory, (byDirectory.get(directory) || 0) + 1);
  }
  return [...byDirectory.entries()].map(([directory, count]) => `${directory} (${count} record${count === 1 ? "" : "s"})`);
}

function runtimeStatusInputs({ matter, objects = [] } = {}) {
  const rows = objects.map((object) => ({
    ...object,
    relativePath: validatedRelativePathFromRuntimeObjectKey(object.objectKey, matter.name),
    updatedMs: Date.parse(object.updatedAt || "") || 0,
  }));
  const byPath = new Map(rows.map((row) => [row.relativePath, row]));
  const extractionInputs = rows
    .filter((row) => /(^|\/)_extracted\/[^/]+\.json$/i.test(row.relativePath))
    .map((row) => runtimeInput({
      ...row,
      fileId: row.fileId || fileIdForExtractionPayload(row.relativePath),
    }, "extraction_record"));
  return {
    sourceInputs: runtimeSourceInputs(rows),
    extractionInputs,
    sourceIndex: byPath.get(SOURCE_INDEX_RELATIVE) || null,
    caseTimelineMarkdown: byPath.get(CASE_TIMELINE_MARKDOWN_RELATIVE) || null,
    caseTimelineJson: byPath.get(CASE_TIMELINE_JSON_RELATIVE) || null,
  };
}

function runtimeSourceInputs(rows = []) {
  const byFileId = new Map();
  for (const row of rows) {
    if (row.objectRole !== "source_working_copy" || !row.fileId) continue;
    const input = runtimeInput({
      ...row,
      sha256: row.documentSha || row.sha256,
    }, "source_working_copy");
    const previous = byFileId.get(input.fileId);
    if (!previous || input.updatedMs > previous.updatedMs) byFileId.set(input.fileId, input);
  }
  return [...byFileId.values()];
}

function runtimeExtractRerunAdvice(inputs = {}) {
  const sourceInputs = inputs.sourceInputs || [];
  const extractionInputs = inputs.extractionInputs || [];
  if (!sourceInputs.length) return null;
  if (!extractionInputs.length) {
    const newestInput = newestRuntimeInput(sourceInputs);
    return runtimeAdvice({
      skill: "/extract",
      label: "extraction records",
      state: RERUN_ADVICE_STATES.MISSING,
      shouldConfirm: false,
      reason: "Source files are present but extraction records are missing from DB payload custody.",
      newestInputPath: newestInput?.relativePath || "",
      newestInputAt: newestInput?.updatedAt || "",
      inputCount: sourceInputs.length,
    });
  }

  const extractionByFileId = new Map(extractionInputs
    .filter((input) => input.fileId)
    .map((input) => [input.fileId, input]));
  for (const source of sourceInputs) {
    const extracted = extractionByFileId.get(source.fileId);
    if (!extracted) {
      return runtimeAdvice({
        skill: "/extract",
        label: "extraction records",
        state: RERUN_ADVICE_STATES.STALE,
        shouldConfirm: false,
        reason: "Added source files do not have extraction records in DB payload custody.",
        newestInputPath: source.relativePath,
        newestInputAt: source.updatedAt || "",
        inputCount: sourceInputs.length,
      });
    }
    if (source.updatedMs > extracted.updatedMs + 1) {
      return runtimeAdvice({
        skill: "/extract",
        label: "extraction records",
        state: RERUN_ADVICE_STATES.STALE,
        shouldConfirm: false,
        reason: "Newer source files were found after extraction records were built.",
        newestInputPath: source.relativePath,
        newestInputAt: source.updatedAt || "",
        inputCount: sourceInputs.length,
      });
    }
  }

  const newestExtraction = newestRuntimeInput(extractionInputs);
  return runtimeAdvice({
    skill: "/extract",
    label: "extraction records",
    state: RERUN_ADVICE_STATES.CURRENT,
    shouldConfirm: true,
    artifactPath: newestExtraction?.relativePath || "",
    lastRunAt: newestExtraction?.updatedAt || "",
    reason: "Every DB source file has an extraction record.",
    inputCount: sourceInputs.length,
  });
}

function runtimeSourceLabelsRerunAdvice(inputs = {}) {
  return buildRuntimeRerunAdvice({
    skill: "/describe_sources",
    label: "source descriptors",
    target: inputs.sourceIndex,
    upstreamInputs: inputs.extractionInputs || [],
    staleDescription: "newer extraction records were found in DB payload custody",
    currentDescription: "No newer extraction records were found in DB payload custody.",
  });
}

function runtimeCaseTimelineRerunAdvice(inputs = {}) {
  const target = inputs.caseTimelineMarkdown || inputs.caseTimelineJson;
  const upstreamInputs = [
    ...(inputs.extractionInputs || []),
    ...(inputs.sourceIndex ? [runtimeInput(inputs.sourceIndex, "source_index")] : []),
  ];
  return buildRuntimeRerunAdvice({
    skill: "/create_listofdates",
    label: "case timeline",
    target,
    upstreamInputs,
    staleDescription: "newer extraction records or Source Index changes were found in DB payload custody",
    currentDescription: "No newer extraction records or Source Index changes were found in DB payload custody.",
  });
}

function buildRuntimeRerunAdvice({
  skill,
  label,
  target,
  upstreamInputs,
  staleDescription,
  currentDescription,
}) {
  if (!target) {
    return runtimeAdvice({ skill, label, state: RERUN_ADVICE_STATES.MISSING, shouldConfirm: false });
  }
  if (!upstreamInputs.length) {
    return runtimeAdvice({
      skill,
      label,
      state: RERUN_ADVICE_STATES.MISSING_UPSTREAM,
      shouldConfirm: false,
      artifactPath: target.relativePath,
      lastRunAt: target.updatedAt || "",
    });
  }
  const newestInput = upstreamInputs.reduce((newest, input) => (
    !newest || input.updatedMs > newest.updatedMs ? input : newest
  ), null);
  if (newestInput?.updatedMs > (Date.parse(target.updatedAt || "") || 0) + 1) {
    return runtimeAdvice({
      skill,
      label,
      state: RERUN_ADVICE_STATES.STALE,
      shouldConfirm: false,
      artifactPath: target.relativePath,
      lastRunAt: target.updatedAt || "",
      reason: staleDescription,
      newestInputPath: newestInput.relativePath,
      newestInputAt: newestInput.updatedAt || "",
    });
  }
  const advice = runtimeAdvice({
    skill,
    label,
    state: RERUN_ADVICE_STATES.CURRENT,
    shouldConfirm: true,
    artifactPath: target.relativePath,
    lastRunAt: target.updatedAt || "",
    reason: currentDescription,
    inputCount: upstreamInputs.length,
  });
  advice.message = `${skill} has a current ${label} artifact in DB payload custody. Run it again anyway?`;
  return advice;
}

function runtimeInput(row, inputKind) {
  return {
    inputKind,
    relativePath: row.relativePath,
    updatedAt: row.updatedAt || "",
    updatedMs: row.updatedMs || Date.parse(row.updatedAt || "") || 0,
    contentHash: row.sha256 || "",
    fileId: row.fileId || "",
  };
}

function newestRuntimeInput(inputs = []) {
  return inputs.reduce((newest, input) => (
    !newest || input.updatedMs > newest.updatedMs ? input : newest
  ), null);
}

function fileIdForExtractionPayload(relativePath = "") {
  const match = String(relativePath || "").match(/(?:^|\/)_extracted\/(FILE-\d{4})\.json$/i);
  return match ? match[1].toUpperCase() : "";
}

function runtimeAdvice({
  skill,
  label,
  state,
  shouldConfirm,
  artifactPath = "",
  lastRunAt = "",
  reason = "",
  newestInputPath = "",
  newestInputAt = "",
  inputCount = 0,
}) {
  return {
    skill,
    label,
    state,
    shouldConfirm,
    artifactPath,
    lastRunAt,
    reason,
    newestInputPath,
    newestInputAt,
    inputCount,
  };
}

function statusStage({ id, slash, label, present, artifacts = [], rerunAdvice = null }) {
  return {
    id,
    slash,
    label,
    present: Boolean(present),
    state: present ? "present" : "not_run",
    artifacts,
    ...(rerunAdvice ? { rerunAdvice } : {}),
  };
}

function prepareStage(slash, statusStageValue, previousStage = null) {
  const definition = prepareStageDefinition(slash);
  const advice = statusStageValue?.rerunAdvice || null;
  const adviceState = advice?.state || (statusStageValue?.present ? RERUN_ADVICE_STATES.CURRENT : RERUN_ADVICE_STATES.MISSING);
  const base = {
    id: definition.id,
    slash,
    label: definition.label,
    description: definition.description,
    paidProviderCall: definition.paidProviderCall,
    artifacts: Array.isArray(statusStageValue?.artifacts) ? statusStageValue.artifacts : [],
    rerunAdvice: advice,
  };
  if (adviceState === RERUN_ADVICE_STATES.CURRENT) {
    return {
      ...base,
      state: "current",
      action: PREPARATION_STAGE_ACTIONS.SKIP_CURRENT,
      reason: `${definition.label} is available from DB payload custody.`,
    };
  }
  if (previousStage && previousStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: `Complete ${previousStage.label} before ${definition.label}.`,
    };
  }
  if (adviceState === RERUN_ADVICE_STATES.MISSING_UPSTREAM) {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: `${definition.label} inputs are missing from DB payload custody.`,
    };
  }
  if (adviceState === RERUN_ADVICE_STATES.STALE || adviceState === RERUN_ADVICE_STATES.FAILED) {
    return {
      ...base,
      state: adviceState,
      action: definition.paidProviderCall ? PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN : PREPARATION_STAGE_ACTIONS.RUN,
      reason: advice?.reason || `${definition.label} needs to run again.`,
    };
  }
  return {
    ...base,
    state: "missing",
    action: definition.paidProviderCall ? PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN : PREPARATION_STAGE_ACTIONS.RUN,
    reason: `${definition.label} is missing from DB payload custody.`,
  };
}

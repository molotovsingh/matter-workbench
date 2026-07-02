import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { LEGAL_WORKBENCH_POLICY_PROMPT_VERSION, legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_PROVIDERS, AI_TASKS } from "../shared/model-policy.mjs";
import { makeHttpError, resolveRelativeInside } from "../shared/safe-paths.mjs";
import { CASE_TIMELINE_JSON_RELATIVE, CASE_TIMELINE_MARKDOWN_RELATIVE, SOURCE_INDEX_RELATIVE } from "../shared/matter-artifacts.mjs";
import { buildConfigurableSkillMatterContextPacket, summarizeMatterContext } from "./configurable-skill-context.mjs";
import { DISPUTE_STORY_OUTPUT_RELATIVE } from "./matter-story-service.mjs";
import { runRecordedStage } from "./skill-stage-service.mjs";
import {
  POSTURE_DIAGNOSIS_DISPOSITION_VALUES,
  diagnosisSchema,
  finalDiagnosisSchema,
  normalizeFiling,
  normalizeFilings,
  normalizeLegalRoutes,
  normalizePostureField,
  normalizeRecommendedRoute,
  normalizeSourcedTextList,
  normalizeStringArray,
  renderProceduralPostureDiagnosisMarkdown,
} from "./procedural-posture-diagnosis-contract.mjs";

export { diagnosisSchema, finalDiagnosisSchema, renderProceduralPostureDiagnosisMarkdown } from "./procedural-posture-diagnosis-contract.mjs";

export const PROCEDURAL_POSTURE_DIAGNOSIS_SCHEMA_VERSION = "procedural-posture-diagnosis/v1";
export const PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE = "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md";
export const PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE = "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.json";
export const CASE_ANALYSIS_QA_RELATIVE = "20_Workshop/Case Analysis/Case Analysis Q&A.md";
export const PROCEDURAL_POSTURE_DIAGNOSIS_SLASH = "/procedural_posture_diagnosis";
export const POSTURE_DIAGNOSIS_AUTHOR = "MW";

const CRITIQUE_RISK_VALUES = ["low", "medium", "high"];
const CRITIQUE_VERDICT_VALUES = ["usable_with_revisions", "needs_major_revision", "unsafe_to_use"];
const CONFIRMATION_DECISIONS = new Set(["confirmed", "corrected", "not_sure"]);
const FILE_TIME_TOLERANCE_MS = 1;
const MAX_STORY_CHARS = 16_000;
const MAX_PACKET_EVIDENCE_BLOCKS = 40;
const MAX_QA_APPEND_CHARS = 4000;
const DEFAULT_PROPOSER_MODEL = "gpt-5.5";
const DEFAULT_CRITIC_MODEL = "o3";
const DEFAULT_FINALIZER_MODEL = "gpt-5.5";
const DEFAULT_MAX_OUTPUT_TOKENS = 8000;
const DEFAULT_RETRY_MAX_OUTPUT_TOKENS = 12000;
const DEFAULT_TIMEOUT_MS = 180_000;
const PROVIDER_JSON_ATTEMPTS = 2;

export function createProceduralPostureDiagnosisService({
  matterStore,
  aiProviderService = null,
  diagnosisProvider = null,
  env = process.env,
  now = () => new Date(),
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function readDiagnosisStatus(root = matterStore.ensureMatterRoot(), options = {}) {
    return buildDiagnosisStatus({ matterRoot: root, now, ...options });
  }

  async function runDiagnosis({
    matterName = "",
    overwrite = false,
    matterRootOverride = "",
    matterRecordOverride = null,
    matterContextPacketOverride = null,
    matterJsonOverride = null,
    artifactExistsOverride = null,
    artifactReader = null,
    artifactStatReader = null,
    artifactWriter = null,
    runId = "",
    resumeFromRunId = "",
    resumeFromStage = "",
    runState = null,
    stageRecorder = null,
  } = {}) {
    const matterRoot = await matterRootForName({ matterName, matterRootOverride });
    const outputPaths = {
      markdown: PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE,
      json: PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE,
      qna: CASE_ANALYSIS_QA_RELATIVE,
    };
    const exists = typeof artifactExistsOverride === "function"
      ? await artifactExistsOverride(outputPaths.markdown)
      : Boolean(await fileStatIfFile(resolveRelativeInside(matterRoot, outputPaths.markdown)));
    if (exists && !overwrite) {
      return {
        schema_version: PROCEDURAL_POSTURE_DIAGNOSIS_SCHEMA_VERSION,
        state: "requires_overwrite",
        artifactPath: outputPaths.markdown,
        outputPaths,
      };
    }

    const packet = await runRecordedStage(stageRecorder, {
      id: "build_packet",
      label: "Build procedural posture evidence packet",
    }, async () => {
      const built = await buildDiagnosisInputPacket({
        matterRoot,
        matterRecordOverride,
        matterContextPacketOverride,
        matterJsonOverride,
        artifactReader,
        artifactStatReader,
      });
      assertDiagnosisInputsReady(built);
      return built;
    }, {
      successPatch: () => ({ salvageable: true }),
    });

    await writeRunStageState(runState, { runId, stageId: "build_packet", value: packet, summary: "Procedural posture evidence packet" });

    const loop = await runDiagnosisLoop({
      packet,
      aiProviderService,
      diagnosisProvider,
      env,
      runId,
      resumeFromRunId,
      resumeFromStage,
      runState,
      stageRecorder,
    });
    const generatedAt = now().toISOString();
    const sidecar = buildDiagnosisSidecar({
      finalDiagnosis: loop.finalDiagnosis,
      packet,
      generatedAt,
      aiRuns: loop.aiRuns,
      runId: `posture_diagnosis_${randomUUID()}`,
    });
    const markdown = renderProceduralPostureDiagnosisMarkdown(sidecar);
    const files = [
      { relativePath: outputPaths.markdown, text: `${markdown}\n` },
      { relativePath: outputPaths.json, text: `${JSON.stringify(sidecar, null, 2)}\n` },
    ];
    const artifactPersistence = await runRecordedStage(stageRecorder, {
      id: "persist",
      label: "Persist procedural posture diagnosis artifacts",
    }, async () => (typeof artifactWriter === "function"
      ? artifactWriter({ outputPaths, files, markdown, sidecar })
      : writeDiagnosisArtifacts({ matterRoot, files })), {
      successPatch: () => ({ summary: outputPaths.markdown }),
    });

    return {
      schema_version: PROCEDURAL_POSTURE_DIAGNOSIS_SCHEMA_VERSION,
      state: "written",
      status: sidecar.status,
      artifactPath: outputPaths.markdown,
      outputPaths,
      generatedAt,
      diagnosis: sidecar,
      markdown,
      artifactPersistence,
    };
  }

  async function recordConfirmation({
    matterName = "",
    decision = "",
    reasonOrCorrection = "",
    actor = "lawyer",
    matterRootOverride = "",
    artifactReader = null,
    artifactWriter = null,
  } = {}) {
    const normalizedDecision = String(decision || "").trim();
    if (!CONFIRMATION_DECISIONS.has(normalizedDecision)) {
      throw makeHttpError(
        "Choose confirm, correct, or not sure for the procedural posture diagnosis.",
        400,
        "procedural_posture.confirmation_decision_required",
      );
    }
    const reason = String(reasonOrCorrection || "").replace(/\s+/g, " ").trim();
    if (normalizedDecision === "corrected" && !reason) {
      throw makeHttpError(
        "Add the reason or correction before recording a procedural posture correction.",
        400,
        "procedural_posture.correction_required",
      );
    }
    const matterRoot = await matterRootForName({ matterName, matterRootOverride });
    const readArtifact = artifactReader || ((relativePath) => readFile(resolveRelativeInside(matterRoot, relativePath), "utf8"));
    let sidecar = null;
    try {
      sidecar = JSON.parse(await readArtifact(PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE));
    } catch {
      throw makeHttpError(
        "Generate the procedural posture diagnosis before recording confirmation.",
        409,
        "procedural_posture.diagnosis_required",
      );
    }
    const recordedAt = now().toISOString();
    const confirmation = {
      state: normalizedDecision,
      confirmed_at: recordedAt,
      reason_or_correction: reason,
      actor: sanitizeActor(actor),
    };
    const nextSidecar = {
      ...sidecar,
      status: normalizedDecision === "confirmed"
        ? "lawyer_confirmed"
        : normalizedDecision === "corrected"
          ? "lawyer_corrected"
          : "not_sure_unconfirmed",
      confirmation,
    };
    const qnaAppend = renderConfirmationQnaAppend({ sidecar: nextSidecar, confirmation, recordedAt });
    const existingQna = await readOptionalArtifact(readArtifact, CASE_ANALYSIS_QA_RELATIVE);
    const nextQna = existingQna
      ? `${existingQna.trimEnd()}\n\n${qnaAppend}`
      : `${renderQnaHeader(nextSidecar, recordedAt)}\n\n${qnaAppend}`;
    const files = [
      { relativePath: PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE, text: `${JSON.stringify(nextSidecar, null, 2)}\n` },
      { relativePath: CASE_ANALYSIS_QA_RELATIVE, text: `${nextQna.trimEnd()}\n` },
    ];
    const artifactPersistence = typeof artifactWriter === "function"
      ? await artifactWriter({ files, sidecar: nextSidecar, qnaMarkdown: nextQna })
      : await writeDiagnosisArtifacts({ matterRoot, files });

    return {
      schema_version: PROCEDURAL_POSTURE_DIAGNOSIS_SCHEMA_VERSION,
      state: confirmation.state,
      confirmation,
      artifactPath: PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE,
      qnaPath: CASE_ANALYSIS_QA_RELATIVE,
      diagnosis: nextSidecar,
      artifactPersistence,
    };
  }

  async function matterRootForName({ matterName: rawMatterName = "", matterRootOverride = "" } = {}) {
    const overrideRoot = typeof matterRootOverride === "string" ? matterRootOverride.trim() : "";
    if (overrideRoot) return overrideRoot;
    const matterName = typeof rawMatterName === "string" ? rawMatterName.trim() : "";
    if (!matterName) return matterStore.ensureMatterRoot();
    const { matterPath } = await matterStore.resolveExistingMatter(matterName);
    return matterPath;
  }

  return {
    readDiagnosisStatus,
    runDiagnosis,
    recordConfirmation,
  };
}

export async function buildDiagnosisStatus({
  matterRoot,
  artifactReader = null,
  artifactStatReader = null,
  now = () => new Date(),
} = {}) {
  if (!matterRoot) throw new Error("matterRoot is required");
  const statReader = artifactStatReader || ((relativePath) => fileStatIfFile(resolveRelativeInside(matterRoot, relativePath)));
  const readArtifact = artifactReader || ((relativePath) => readFile(resolveRelativeInside(matterRoot, relativePath), "utf8"));
  const markdownStat = await statReader(PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE);
  const jsonStat = await statReader(PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE);
  const caseTimelineStat = await newestRelativeStat(statReader, [CASE_TIMELINE_MARKDOWN_RELATIVE, CASE_TIMELINE_JSON_RELATIVE]);
  const storyStat = await newestRelativeStat(statReader, [DISPUTE_STORY_OUTPUT_RELATIVE, "20_Workshop/The Story.json"]);
  const sourceIndexStat = await statReader(SOURCE_INDEX_RELATIVE);
  const sidecar = jsonStat ? await readJsonArtifact(readArtifact, PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE) : null;
  const diagnosisStat = newestStat([markdownStat, jsonStat].filter(Boolean));
  const upstreamStat = newestStat([caseTimelineStat, storyStat].filter(Boolean));
  const blockedReasons = [];
  if (!caseTimelineStat) blockedReasons.push("Case Timeline is missing.");
  if (!storyStat) blockedReasons.push("Matter Story is missing.");

  const confirmation = normalizeConfirmation(sidecar?.confirmation);
  const changedAfterConfirmation = Boolean(
    confirmation.state && confirmation.state !== "unconfirmed"
    && confirmation.confirmed_at
    && upstreamStat
    && Date.parse(upstreamStat.mtime?.toISOString?.() || upstreamStat.updatedAt || "") > Date.parse(confirmation.confirmed_at) + FILE_TIME_TOLERANCE_MS
  );
  const stale = Boolean(diagnosisStat && upstreamStat && upstreamStat.mtimeMs > diagnosisStat.mtimeMs + FILE_TIME_TOLERANCE_MS);
  const state = blockedReasons.length
    ? "blocked"
    : !diagnosisStat
      ? "missing"
      : changedAfterConfirmation
        ? "needs_reconfirmation"
        : stale
          ? "stale"
          : confirmation.state === "confirmed"
            ? "current_confirmed"
            : confirmation.state === "corrected"
              ? "current_corrected"
              : "current_unconfirmed";

  return {
    schema_version: PROCEDURAL_POSTURE_DIAGNOSIS_SCHEMA_VERSION,
    slash: PROCEDURAL_POSTURE_DIAGNOSIS_SLASH,
    label: "Diagnose procedural posture",
    state,
    status: sidecar?.status || (diagnosisStat ? "mw_inferred" : "missing"),
    markdownPresent: Boolean(markdownStat),
    jsonPresent: Boolean(jsonStat),
    artifactPath: PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE,
    jsonPath: PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE,
    qnaPath: CASE_ANALYSIS_QA_RELATIVE,
    diagnosisUpdatedAt: diagnosisStat ? diagnosisStat.mtime.toISOString() : "",
    caseTimelineUpdatedAt: caseTimelineStat ? caseTimelineStat.mtime.toISOString() : "",
    matterStoryUpdatedAt: storyStat ? storyStat.mtime.toISOString() : "",
    sourceIndexUpdatedAt: sourceIndexStat ? sourceIndexStat.mtime.toISOString() : "",
    blockedReasons,
    stale,
    needsReconfirmation: changedAfterConfirmation,
    confirmation,
    courtForum: sidecar?.court_forum || null,
    proceduralPosture: sidecar?.procedural_posture || null,
    recommendedWorkingPath: sidecar?.recommended_working_path || null,
    simpleCaseView: sidecar?.simple_case_view || "",
    legalRoutes: Array.isArray(sidecar?.legal_routes) ? sidecar.legal_routes : [],
    recommendedRoute: sidecar?.recommended_route || null,
    nextBestActions: Array.isArray(sidecar?.next_best_actions) ? sidecar.next_best_actions : [],
    lawyerToConfirmCount: Array.isArray(sidecar?.lawyer_to_confirm) ? sidecar.lawyer_to_confirm.length : 0,
    checkedAt: now().toISOString(),
  };
}

async function buildDiagnosisInputPacket({
  matterRoot,
  matterRecordOverride = null,
  matterContextPacketOverride = null,
  matterJsonOverride = null,
  artifactReader = null,
  artifactStatReader = null,
} = {}) {
  const readArtifact = artifactReader || ((relativePath) => readFile(resolveRelativeInside(matterRoot, relativePath), "utf8"));
  const statReader = artifactStatReader || ((relativePath) => fileStatIfFile(resolveRelativeInside(matterRoot, relativePath)));
  const matterJson = matterJsonOverride || await readMatterJsonForDiagnosis(matterRoot);
  const contextPacket = matterContextPacketOverride || await buildNativeMatterContextPacket(matterRoot);
  const matterContext = summarizeMatterContext(contextPacket);
  const storyMarkdown = await readOptionalArtifact(readArtifact, DISPUTE_STORY_OUTPUT_RELATIVE);
  const storyStat = await statReader(DISPUTE_STORY_OUTPUT_RELATIVE);
  const timelineStat = await newestRelativeStat(statReader, [CASE_TIMELINE_MARKDOWN_RELATIVE, CASE_TIMELINE_JSON_RELATIVE]);
  const sourceIndexStat = await statReader(SOURCE_INDEX_RELATIVE);
  const libraryArtifacts = Array.isArray(matterContext.library_artifacts) ? matterContext.library_artifacts : [];
  const caseTimeline = libraryArtifacts.find((artifact) => artifact.kind === "list_of_dates")
    || libraryArtifacts.find((artifact) => artifact.kind === "list_of_dates_markdown")
    || null;
  const sourceIndex = libraryArtifacts.find((artifact) => artifact.kind === "source_index") || null;
  return {
    schema_version: "procedural-posture-diagnosis-input/v1",
    matter: {
      ...(matterRecordOverride && typeof matterRecordOverride === "object" ? matterRecordOverride : {}),
      matter_name: matterJson.matter_name || matterContext.matter?.matter_name || "",
      client_name: matterJson.client_name || matterContext.matter?.client_name || "",
      opposite_party: matterJson.opposite_party || matterContext.matter?.opposite_party || "",
      matter_type: matterJson.matter_type || matterContext.matter?.matter_type || "",
      jurisdiction: matterJson.jurisdiction || matterContext.matter?.jurisdiction || "",
      brief_description: matterJson.brief_description || "",
    },
    based_on: {
      case_timeline_path: CASE_TIMELINE_MARKDOWN_RELATIVE,
      case_timeline_json_path: CASE_TIMELINE_JSON_RELATIVE,
      case_timeline_updated_at: timelineStat ? timelineStat.mtime.toISOString() : "",
      matter_story_path: DISPUTE_STORY_OUTPUT_RELATIVE,
      matter_story_updated_at: storyStat ? storyStat.mtime.toISOString() : "",
      source_index_path: SOURCE_INDEX_RELATIVE,
      source_index_updated_at: sourceIndexStat ? sourceIndexStat.mtime.toISOString() : "",
    },
    case_timeline: caseTimeline,
    matter_story: {
      path: DISPUTE_STORY_OUTPUT_RELATIVE,
      markdown: boundedText(storyMarkdown, MAX_STORY_CHARS),
      markdown_truncated: storyMarkdown.length > MAX_STORY_CHARS,
    },
    source_index: sourceIndex,
    sources: Array.isArray(matterContext.sources) ? matterContext.sources : [],
    evidence_blocks: Array.isArray(matterContext.evidence_blocks) ? matterContext.evidence_blocks.slice(0, MAX_PACKET_EVIDENCE_BLOCKS) : [],
    warnings: Array.isArray(matterContext.warnings) ? matterContext.warnings : [],
  };
}

function assertDiagnosisInputsReady(packet = {}) {
  if (!packet.case_timeline) {
    throw makeHttpError(
      "Build the Case Timeline before diagnosing procedural posture.",
      409,
      "procedural_posture.case_timeline_required",
    );
  }
  if (!String(packet.matter_story?.markdown || "").trim()) {
    throw makeHttpError(
      "Write the Matter Story before diagnosing procedural posture.",
      409,
      "procedural_posture.matter_story_required",
    );
  }
}

async function buildNativeMatterContextPacket(matterRoot) {
  if (String(matterRoot || "").startsWith("postgres:")) {
    throw makeHttpError(
      "Matter context is not available for procedural posture diagnosis. Ask the operator to check runtime DB context wiring.",
      409,
      "procedural_posture.context_required",
    );
  }
  return buildConfigurableSkillMatterContextPacket(matterRoot);
}

async function runDiagnosisLoop({
  packet,
  aiProviderService,
  diagnosisProvider,
  env = process.env,
  runId = "",
  resumeFromRunId = "",
  resumeFromStage = "",
  runState = null,
  stageRecorder = null,
}) {
  if (typeof diagnosisProvider === "function") {
    const supplied = await diagnosisProvider({ packet, prompts: buildPostureDiagnosisPrompts(), schemas: postureDiagnosisSchemas() });
    return normalizeInjectedDiagnosisLoop(supplied);
  }
  if (!aiProviderService?.invoke) {
    throw makeHttpError(
      "Procedural posture diagnosis provider is not configured.",
      409,
      "procedural_posture.provider_not_configured",
    );
  }
  const prompts = buildPostureDiagnosisPrompts();
  const provider = resolveDiagnosisProvider(aiProviderService);
  const proposerModel = modelForProvider(env.POSTURE_DIAGNOSIS_PROPOSER_MODEL || DEFAULT_PROPOSER_MODEL, provider);
  const criticModel = modelForProvider(env.POSTURE_DIAGNOSIS_CRITIC_MODEL || DEFAULT_CRITIC_MODEL, provider);
  const finalizerModel = modelForProvider(env.POSTURE_DIAGNOSIS_FINALIZER_MODEL || DEFAULT_FINALIZER_MODEL, provider);
  const proposer = await runReusableProviderStage({
    stage: {
      id: "proposer",
      label: "Posture diagnosis proposer",
      provider,
      model: proposerModel,
    },
    runId,
    resumeFromRunId,
    resumeFromStage,
    runState,
    stageRecorder,
    operation: ({ retry = false } = {}) => aiProviderService.invoke({
      task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
      systemPrompt: prompts.proposerSystem,
      userPayload: postureProviderPayload({ matterPacket: packet }, { retry, stageLabel: "proposer" }),
      schema: diagnosisSchema("posture_diagnosis_draft"),
      schemaName: "posture_diagnosis_draft",
      schemaDescription: "Provisional filing and procedural posture diagnosis draft.",
      responseMode: "json",
      label: "posture diagnosis proposer",
      overrides: providerOverrides(proposerModel, env, { retryJson: retry }),
    }),
  });
  const critique = await runReusableProviderStage({
    stage: {
      id: "critic",
      label: "Posture diagnosis critic",
      provider,
      model: criticModel,
    },
    runId,
    resumeFromRunId,
    resumeFromStage,
    runState,
    stageRecorder,
    operation: ({ retry = false } = {}) => aiProviderService.invoke({
      task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
      systemPrompt: prompts.criticSystem,
      userPayload: postureProviderPayload({ matterPacket: packet, proposerDraft: proposer.parsed }, { retry, stageLabel: "critic" }),
      schema: critiqueSchema(),
      schemaName: "posture_diagnosis_critique",
      schemaDescription: "Critique of provisional filing and procedural posture diagnosis.",
      responseMode: "json",
      label: "posture diagnosis critic",
      overrides: providerOverrides(criticModel, env, { retryJson: retry }),
    }),
  });
  const finalizer = await runReusableProviderStage({
    stage: {
      id: "finalizer",
      label: "Posture diagnosis finalizer",
      provider,
      model: finalizerModel,
    },
    runId,
    resumeFromRunId,
    resumeFromStage,
    runState,
    stageRecorder,
    operation: ({ retry = false } = {}) => aiProviderService.invoke({
      task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
      systemPrompt: prompts.finalizerSystem,
      userPayload: postureProviderPayload({ matterPacket: packet, proposerDraft: proposer.parsed, critique: critique.parsed }, { retry, stageLabel: "finalizer" }),
      schema: finalDiagnosisSchema(),
      schemaName: "posture_diagnosis_final",
      schemaDescription: "Final provisional filing and procedural posture diagnosis after critique.",
      responseMode: "json",
      label: "posture diagnosis finalizer",
      overrides: providerOverrides(finalizerModel, env, { retryJson: retry }),
    }),
  });
  await runRecordedStage(stageRecorder, {
    id: "validate",
    label: "Validate procedural posture diagnosis",
  }, async () => validateFinalDiagnosis(finalizer.parsed), {
    successPatch: () => ({ summary: "Final diagnosis schema valid", salvageable: true }),
  });
  return {
    finalDiagnosis: finalizer.parsed,
    aiRuns: {
      proposer: proposer.aiRun,
      critic: critique.aiRun,
      finalizer: finalizer.aiRun,
    },
  };
}

async function runReusableProviderStage({
  stage,
  operation,
  runId = "",
  resumeFromRunId = "",
  resumeFromStage = "",
  runState = null,
  stageRecorder = null,
} = {}) {
  if (shouldReuseStage(stage.id, resumeFromStage)) {
    const prior = await readRunStageValue(runState, { runId: resumeFromRunId, stageId: stage.id });
    if (prior?.parsed) {
      if (stageRecorder?.skipStage) {
        await stageRecorder.skipStage({
          ...stage,
          summary: `Reused from ${resumeFromRunId}`,
          salvageable: true,
        });
      }
      await writeRunStageState(runState, {
        runId,
        stageId: stage.id,
        value: prior,
        summary: `Reused from ${resumeFromRunId}`,
      });
      return prior;
    }
  }
  const result = await runRecordedStage(stageRecorder, stage, () => runProviderStageOperationWithRetry(operation), {
    successPatch: (stageResult) => ({ aiRun: stageResult?.aiRun, salvageable: true }),
  });
  await writeRunStageState(runState, {
    runId,
    stageId: stage.id,
    value: providerStageState(result),
    summary: stage.label,
  });
  return result;
}

function shouldReuseStage(stageId = "", resumeFromStage = "") {
  const order = ["proposer", "critic", "finalizer", "validate", "persist"];
  const stageIndex = order.indexOf(stageId);
  const resumeIndex = order.indexOf(String(resumeFromStage || "").trim().toLowerCase());
  return stageIndex >= 0 && resumeIndex > stageIndex;
}

async function runProviderStageOperationWithRetry(operation) {
  let lastError = null;
  for (let attempt = 0; attempt < PROVIDER_JSON_ATTEMPTS; attempt += 1) {
    try {
      return await operation({ attempt, retry: attempt > 0 });
    } catch (error) {
      lastError = error;
      if (attempt >= PROVIDER_JSON_ATTEMPTS - 1 || !isRetryableProviderJsonError(error)) throw error;
    }
  }
  throw lastError;
}

function isRetryableProviderJsonError(error) {
  const code = String(error?.code || "").trim();
  return code === "provider.invalid_json" || code === "provider.empty_output";
}

function providerStageState(result = {}) {
  return {
    parsed: result?.parsed,
    aiRun: result?.aiRun,
  };
}

async function writeRunStageState(runState, { runId, stageId, value, summary = "" } = {}) {
  if (!runState?.writeStageState || !runId || !stageId) return null;
  return runState.writeStageState({ runId, stageId, value, summary });
}

async function readRunStageValue(runState, { runId, stageId } = {}) {
  if (!runState?.readStageValue || !runId || !stageId) return null;
  return runState.readStageValue({ runId, stageId });
}

function normalizeInjectedDiagnosisLoop(value = {}) {
  const finalDiagnosis = value.finalDiagnosis || value.diagnosis || value;
  validateFinalDiagnosis(finalDiagnosis);
  return {
    finalDiagnosis,
    aiRuns: value.aiRuns || {},
  };
}

function validateFinalDiagnosis(value = {}) {
  const required = [
    "short_diagnosis",
    "court_forum",
    "procedural_posture",
    "possible_filings",
    "recommended_working_path",
    "governing_law",
    "central_facts",
    "adverse_or_difficult_facts",
    "missing_information",
    "lawyer_to_confirm",
    "internal_source_handles",
  ];
  for (const key of required) {
    if (!(key in (value || {}))) {
      throw makeHttpError(
        "Procedural posture diagnosis returned an incomplete result.",
        502,
        "procedural_posture.invalid_output",
      );
    }
  }
}

function resolveDiagnosisProvider(aiProviderService) {
  try {
    return aiProviderService.resolveTask?.(AI_TASKS.SOURCE_BACKED_ANALYSIS)?.providerConfig?.provider || "";
  } catch {
    return "";
  }
}

function providerOverrides(model, env = process.env, { retryJson = false } = {}) {
  const baseMaxOutputTokens = parsePositiveInteger(env.POSTURE_DIAGNOSIS_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS);
  const retryMaxOutputTokens = parsePositiveInteger(env.POSTURE_DIAGNOSIS_RETRY_MAX_OUTPUT_TOKENS, DEFAULT_RETRY_MAX_OUTPUT_TOKENS);
  return {
    model,
    maxOutputTokens: retryJson ? Math.max(baseMaxOutputTokens, retryMaxOutputTokens) : baseMaxOutputTokens,
    timeoutMs: parsePositiveInteger(env.POSTURE_DIAGNOSIS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    omitTemperature: true,
    requireParameters: true,
    allowFallbacks: false,
    extraHeaders: { "x-title": "Matter Workbench Procedural Posture Diagnosis" },
  };
}

function postureProviderPayload(payload = {}, { retry = false, stageLabel = "stage" } = {}) {
  if (!retry) return payload;
  return {
    ...payload,
    retry_instructions: [
      `The previous procedural posture ${stageLabel} response was truncated or invalid JSON.`,
      "Return exactly one complete JSON object matching the provided schema.",
      "Prefer concise arrays and concise reasons over long prose so the JSON closes completely.",
      "Do not include markdown, commentary, or text outside the JSON object.",
    ].join(" "),
  };
}

function modelForProvider(model, provider) {
  const normalized = String(model || "").trim();
  if (!normalized) return normalized;
  if (provider === AI_PROVIDERS.OPENROUTER && !normalized.includes("/")) return `openai/${normalized}`;
  return normalized;
}

function buildDiagnosisSidecar({ finalDiagnosis, packet, generatedAt, aiRuns = {}, runId = "" }) {
  return {
    schema_version: PROCEDURAL_POSTURE_DIAGNOSIS_SCHEMA_VERSION,
    author: POSTURE_DIAGNOSIS_AUTHOR,
    status: "mw_inferred",
    generated_at: generatedAt,
    run_id: runId,
    matter: {
      name: packet.matter?.matter_name || "",
      client_name: packet.matter?.client_name || "",
      opposite_party: packet.matter?.opposite_party || "",
      matter_type: packet.matter?.matter_type || "",
      jurisdiction: packet.matter?.jurisdiction || "",
    },
    based_on: {
      ...packet.based_on,
      policy_prompt_version: LEGAL_WORKBENCH_POLICY_PROMPT_VERSION,
    },
    short_diagnosis: String(finalDiagnosis.short_diagnosis || "").trim(),
    simple_case_view: String(finalDiagnosis.simple_case_view || finalDiagnosis.short_diagnosis || "").trim(),
    court_forum: normalizePostureField(finalDiagnosis.court_forum),
    procedural_posture: normalizePostureField(finalDiagnosis.procedural_posture),
    possible_filings: normalizeFilings(finalDiagnosis.possible_filings),
    recommended_working_path: normalizeFiling(finalDiagnosis.recommended_working_path),
    legal_routes: normalizeLegalRoutes(finalDiagnosis.legal_routes),
    recommended_route: normalizeRecommendedRoute(finalDiagnosis.recommended_route),
    next_best_actions: normalizeStringArray(finalDiagnosis.next_best_actions),
    governing_law: normalizeSourcedTextList(finalDiagnosis.governing_law),
    central_facts: normalizeSourcedTextList(finalDiagnosis.central_facts),
    adverse_or_difficult_facts: normalizeSourcedTextList(finalDiagnosis.adverse_or_difficult_facts),
    missing_information: normalizeStringArray(finalDiagnosis.missing_information),
    lawyer_to_confirm: normalizeStringArray(finalDiagnosis.lawyer_to_confirm),
    internal_source_handles: normalizeStringArray(finalDiagnosis.internal_source_handles),
    critique_handling: Array.isArray(finalDiagnosis.critique_handling) ? finalDiagnosis.critique_handling.map((item) => ({
      critique_signal: String(item?.critique_signal || "").trim(),
      disposition: POSTURE_DIAGNOSIS_DISPOSITION_VALUES.includes(item?.disposition) ? item.disposition : "partly_accepted",
      reason: String(item?.reason || "").trim(),
    })).filter((item) => item.critique_signal || item.reason) : [],
    confirmation: defaultConfirmation(),
    ai_runs: aiRuns,
  };
}

export function buildPostureDiagnosisPrompts() {
  const shared = [
    "You are Matter Workbench, assisting a lawyer with internal litigation analysis.",
    "The output is provisional working analysis, not final legal advice and not court-ready work product.",
    "Use only the supplied matter packet. Do not invent facts, parties, filings, statutes, dates, procedural history, or citations.",
    "If a point is inferred, mark it as inferred and explain the source-backed basis.",
    "If a point is uncertain, say so and include it in lawyer_to_confirm.",
    "Material adverse or inconvenient facts must be surfaced with responsible framing; do not suppress them.",
    "Separate source-backed facts from lawyer/client instructions, matter metadata, and assumptions.",
    "Use simple Indian legal English. Prefer short clear sentences. Avoid dense legal prose.",
    "If the record shows overlapping proceedings, forums, or tracks, separate them clearly instead of collapsing them into one posture.",
    "For interlocutory orders, state their apparent limited scope from the record; do not expand a status quo or restraint order beyond the asset, party, or issue it expressly covers.",
    "If transfer, filing, or remedy steps are conditional on another forum's order or proceeding, state the condition and the current known-unknowns.",
    "Deduplicate repeated source labels in visible prose where they appear to refer to the same document.",
    "Do not put raw FILE handles, hashes, storage paths, provider traces, prompt traces, candidate ledgers, or raw model responses in visible prose. Keep raw FILE handles only in structured source_refs and internal_source_handles for internal audit.",
    "If CrPC/IPC and BNSS/BNS may both be relevant, mention the known section and say to verify the applicable equivalent before filing.",
  ];
  return {
    proposerSystem: legalWorkbenchSystemPrompt([
      ...shared,
      "Role: Proposer.",
      "Produce a provisional Filing and Procedural Posture Diagnosis in simple Indian legal English that a non-native English speaker can follow.",
      "Identify the likely court/forum, current procedural posture, all probable legal routes supported by the current record, reasons for each route, statutory references to check, priority working path, governing framework, central facts, adverse facts, missing information, and lawyer-confirmation items.",
      "When there are multiple procedural tracks, give a track-wise posture first, then a conservative overall reading. Include what cannot be confirmed, such as final disposal, current case status, execution of key documents, or whether an injunction/order has actually been granted.",
      "Write routes as Route 1, Route 2, etc. Each route must explain what it means, when to use it, why the current record supports or weakens it, likely court/forum, statutory references, and facts/documents to confirm.",
      "Prefer a differential diagnosis over false certainty.",
      "Return JSON only matching the schema.",
    ]),
    criticSystem: legalWorkbenchSystemPrompt([
      ...shared,
      "Role: Critic.",
      "Do not rewrite the diagnosis. Challenge it.",
      "Identify unsupported leaps, overconfidence, missed procedural paths, conflated proceedings/forums, overbroad reading of interlocutory orders, adverse facts not handled, missing source grounding, and lawyer-confirmation gaps.",
      "Check whether the legal routes are understandable, properly caveated, and supported by the current record.",
      "Return critique JSON only. Be precise and actionable.",
    ]),
    finalizerSystem: legalWorkbenchSystemPrompt([
      ...shared,
      "Role: Finalizer.",
      "Revise the proposer draft after considering the critic signal.",
      "Accept, reject, or partly accept important critique points with reasons.",
      "The final output must remain provisional and must include lawyer-confirmation items.",
      "The final output must include a prose-like legal routes section: Route 1, Route 2, etc., with reasons, statutory references, and facts to confirm.",
      "If there are multiple procedural tracks, the final output must make the tracks explicit and give a conservative current-posture paragraph that says what remains unconfirmed from the record.",
      "End with a recommended route and next best actions for the legal team.",
      "Do not overstate legal certainty or treat the diagnosis as lawyer-approved.",
      "Return JSON only matching the schema.",
    ]),
  };
}

export function postureDiagnosisSchemas() {
  return {
    diagnosisDraft: diagnosisSchema("posture_diagnosis_draft"),
    critique: critiqueSchema(),
    finalDiagnosis: finalDiagnosisSchema(),
  };
}

export function critiqueSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "overall_risk",
      "serious_issues",
      "missed_possibilities",
      "overconfidence_flags",
      "adverse_fact_gaps",
      "source_grounding_gaps",
      "recommended_revisions",
      "questions_for_lawyer",
      "verdict",
    ],
    properties: {
      schema_version: { type: "string", enum: ["posture_diagnosis_critique/v1"] },
      overall_risk: { type: "string", enum: CRITIQUE_RISK_VALUES },
      serious_issues: { type: "array", items: { type: "string" } },
      missed_possibilities: { type: "array", items: { type: "string" } },
      overconfidence_flags: { type: "array", items: { type: "string" } },
      adverse_fact_gaps: { type: "array", items: { type: "string" } },
      source_grounding_gaps: { type: "array", items: { type: "string" } },
      recommended_revisions: { type: "array", items: { type: "string" } },
      questions_for_lawyer: { type: "array", items: { type: "string" } },
      verdict: { type: "string", enum: CRITIQUE_VERDICT_VALUES },
    },
  };
}

function renderConfirmationQnaAppend({ sidecar, confirmation, recordedAt }) {
  const inferred = [
    `Court/forum: ${sidecar.court_forum?.value || "Unknown"}`,
    `Procedural posture: ${sidecar.procedural_posture?.value || "Unknown"}`,
    `Working path: ${sidecar.recommended_working_path?.filing_or_remedy || "Unknown"}`,
  ].join("; ");
  return [
    `### ${recordedAt} — Procedural posture confirmation`,
    "",
    `**MW inferred:** ${boundedText(inferred, MAX_QA_APPEND_CHARS)}`,
    "",
    `**Lawyer response:** ${confirmation.state}`,
    "",
    `**Reason or correction:** ${confirmation.reason_or_correction || "—"}`,
    "",
    "**Effect on analysis:** Procedural posture status updated in the diagnosis sidecar. Downstream analysis must re-check this entry if Case Timeline or Matter Story changes.",
  ].join("\n");
}

function renderQnaHeader(sidecar, recordedAt) {
  return [
    "# Case Analysis Q&A",
    "",
    "Author: MW + lawyer instructions",
    `Matter: ${sidecar.matter?.name || "Matter"}`,
    `Last updated: ${recordedAt}`,
    `Based on Case Timeline: ${sidecar.based_on?.case_timeline_path || CASE_TIMELINE_MARKDOWN_RELATIVE}`,
  ].join("\n");
}

async function writeDiagnosisArtifacts({ matterRoot, files = [] }) {
  const persisted = [];
  for (const file of files) {
    const fullPath = resolveRelativeInside(matterRoot, file.relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFileAtomic(fullPath, String(file.text || ""));
    persisted.push({ relativePath: file.relativePath });
  }
  return persisted;
}

async function readMatterJsonForDiagnosis(matterRoot) {
  try {
    return JSON.parse(await readFile(resolveRelativeInside(matterRoot, "matter.json"), "utf8"));
  } catch {
    return { matter_name: path.basename(matterRoot) };
  }
}

async function readOptionalArtifact(readArtifact, relativePath) {
  try {
    return String(await readArtifact(relativePath) || "");
  } catch {
    return "";
  }
}

async function readJsonArtifact(readArtifact, relativePath) {
  try {
    const text = await readArtifact(relativePath);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function newestRelativeStat(statReader, relativePaths = []) {
  const stats = [];
  for (const relativePath of relativePaths) {
    const item = await statReader(relativePath);
    if (item) stats.push(item);
  }
  return newestStat(stats);
}

function newestStat(stats = []) {
  return stats.filter(Boolean).reduce((newest, item) => (
    !newest || item.mtimeMs > newest.mtimeMs ? item : newest
  ), null);
}

async function fileStatIfFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() ? fileStat : null;
  } catch {
    return null;
  }
}

function normalizeConfirmation(confirmation = {}) {
  const state = String(confirmation?.state || "unconfirmed").trim() || "unconfirmed";
  return {
    state,
    confirmed_at: String(confirmation?.confirmed_at || "").trim(),
    reason_or_correction: String(confirmation?.reason_or_correction || "").trim(),
    actor: sanitizeActor(confirmation?.actor || "unknown"),
  };
}

function defaultConfirmation() {
  return {
    state: "unconfirmed",
    confirmed_at: "",
    reason_or_correction: "",
    actor: "unknown",
  };
}

function sanitizeActor(value) {
  const actor = String(value || "unknown").replace(/\s+/g, "_").toLowerCase();
  return ["lawyer", "operator", "unknown"].includes(actor) ? actor : "unknown";
}

function boundedText(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars).trimEnd()}…`;
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

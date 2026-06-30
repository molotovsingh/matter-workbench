import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { LEGAL_WORKBENCH_POLICY_PROMPT_VERSION, legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_PROVIDERS, AI_TASKS } from "../shared/model-policy.mjs";
import { makeHttpError, resolveRelativeInside } from "../shared/safe-paths.mjs";
import { LIST_OF_DATES_JSON_RELATIVE, LIST_OF_DATES_MARKDOWN_RELATIVE, SOURCE_INDEX_RELATIVE } from "../shared/matter-artifacts.mjs";
import { buildConfigurableSkillMatterContextPacket, summarizeMatterContext } from "./configurable-skill-context.mjs";
import { DISPUTE_STORY_OUTPUT_RELATIVE } from "./matter-story-service.mjs";

export const PROCEDURAL_POSTURE_DIAGNOSIS_SCHEMA_VERSION = "procedural-posture-diagnosis/v1";
export const PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE = "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md";
export const PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE = "20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.json";
export const CASE_ANALYSIS_QA_RELATIVE = "20_Workshop/Case Analysis/Case Analysis Q&A.md";
export const PROCEDURAL_POSTURE_DIAGNOSIS_SLASH = "/procedural_posture_diagnosis";
export const POSTURE_DIAGNOSIS_AUTHOR = "MW";

const CONFIDENCE_VALUES = ["low", "medium", "high", "unknown"];
const PRIORITY_VALUES = ["primary", "secondary", "parked", "not_advised_yet", "unknown"];
const CRITIQUE_RISK_VALUES = ["low", "medium", "high"];
const CRITIQUE_VERDICT_VALUES = ["usable_with_revisions", "needs_major_revision", "unsafe_to_use"];
const DISPOSITION_VALUES = ["accepted", "rejected", "partly_accepted"];
const CONFIRMATION_DECISIONS = new Set(["confirmed", "corrected", "not_sure"]);
const FILE_TIME_TOLERANCE_MS = 1;
const MAX_STORY_CHARS = 16_000;
const MAX_PACKET_EVIDENCE_BLOCKS = 40;
const MAX_QA_APPEND_CHARS = 4000;
const DEFAULT_PROPOSER_MODEL = "gpt-5.5";
const DEFAULT_CRITIC_MODEL = "o3";
const DEFAULT_FINALIZER_MODEL = "gpt-5.5";
const DEFAULT_MAX_OUTPUT_TOKENS = 8000;
const DEFAULT_TIMEOUT_MS = 180_000;

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

    const packet = await buildDiagnosisInputPacket({
      matterRoot,
      matterRecordOverride,
      matterContextPacketOverride,
      matterJsonOverride,
      artifactReader,
      artifactStatReader,
    });
    assertDiagnosisInputsReady(packet);

    const loop = await runDiagnosisLoop({ packet, aiProviderService, diagnosisProvider, env });
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
    const artifactPersistence = typeof artifactWriter === "function"
      ? await artifactWriter({ outputPaths, files, markdown, sidecar })
      : await writeDiagnosisArtifacts({ matterRoot, files });

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
  const caseTimelineStat = await newestRelativeStat(statReader, [LIST_OF_DATES_MARKDOWN_RELATIVE, LIST_OF_DATES_JSON_RELATIVE]);
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
  const timelineStat = await newestRelativeStat(statReader, [LIST_OF_DATES_MARKDOWN_RELATIVE, LIST_OF_DATES_JSON_RELATIVE]);
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
      case_timeline_path: LIST_OF_DATES_MARKDOWN_RELATIVE,
      case_timeline_json_path: LIST_OF_DATES_JSON_RELATIVE,
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

async function runDiagnosisLoop({ packet, aiProviderService, diagnosisProvider, env = process.env }) {
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
  const proposer = await aiProviderService.invoke({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    systemPrompt: prompts.proposerSystem,
    userPayload: { matterPacket: packet },
    schema: diagnosisSchema("posture_diagnosis_draft"),
    schemaName: "posture_diagnosis_draft",
    schemaDescription: "Provisional filing and procedural posture diagnosis draft.",
    responseMode: "json",
    label: "posture diagnosis proposer",
    overrides: providerOverrides(modelForProvider(env.POSTURE_DIAGNOSIS_PROPOSER_MODEL || DEFAULT_PROPOSER_MODEL, provider), env),
  });
  const critique = await aiProviderService.invoke({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    systemPrompt: prompts.criticSystem,
    userPayload: { matterPacket: packet, proposerDraft: proposer.parsed },
    schema: critiqueSchema(),
    schemaName: "posture_diagnosis_critique",
    schemaDescription: "Critique of provisional filing and procedural posture diagnosis.",
    responseMode: "json",
    label: "posture diagnosis critic",
    overrides: providerOverrides(modelForProvider(env.POSTURE_DIAGNOSIS_CRITIC_MODEL || DEFAULT_CRITIC_MODEL, provider), env),
  });
  const finalizer = await aiProviderService.invoke({
    task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
    systemPrompt: prompts.finalizerSystem,
    userPayload: { matterPacket: packet, proposerDraft: proposer.parsed, critique: critique.parsed },
    schema: finalDiagnosisSchema(),
    schemaName: "posture_diagnosis_final",
    schemaDescription: "Final provisional filing and procedural posture diagnosis after critique.",
    responseMode: "json",
    label: "posture diagnosis finalizer",
    overrides: providerOverrides(modelForProvider(env.POSTURE_DIAGNOSIS_FINALIZER_MODEL || DEFAULT_FINALIZER_MODEL, provider), env),
  });
  validateFinalDiagnosis(finalizer.parsed);
  return {
    finalDiagnosis: finalizer.parsed,
    aiRuns: {
      proposer: proposer.aiRun,
      critic: critique.aiRun,
      finalizer: finalizer.aiRun,
    },
  };
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

function providerOverrides(model, env = process.env) {
  return {
    model,
    maxOutputTokens: parsePositiveInteger(env.POSTURE_DIAGNOSIS_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
    timeoutMs: parsePositiveInteger(env.POSTURE_DIAGNOSIS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    omitTemperature: true,
    requireParameters: true,
    allowFallbacks: false,
    extraHeaders: { "x-title": "Matter Workbench Procedural Posture Diagnosis" },
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
      disposition: DISPOSITION_VALUES.includes(item?.disposition) ? item.disposition : "partly_accepted",
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
    "Use readable source labels in prose when possible. Keep raw FILE handles only in source_refs and internal_source_handles.",
    "If CrPC/IPC and BNSS/BNS may both be relevant, mention the known section and say to verify the applicable equivalent before filing.",
  ];
  return {
    proposerSystem: legalWorkbenchSystemPrompt([
      ...shared,
      "Role: Proposer.",
      "Produce a provisional Filing and Procedural Posture Diagnosis in simple Indian legal English that a non-native English speaker can follow.",
      "Identify the likely court/forum, current procedural posture, all probable legal routes supported by the current record, reasons for each route, statutory references to check, priority working path, governing framework, central facts, adverse facts, missing information, and lawyer-confirmation items.",
      "Write routes as Route 1, Route 2, etc. Each route must explain what it means, when to use it, why the current record supports or weakens it, likely court/forum, statutory references, and facts/documents to confirm.",
      "Prefer a differential diagnosis over false certainty.",
      "Return JSON only matching the schema.",
    ]),
    criticSystem: legalWorkbenchSystemPrompt([
      ...shared,
      "Role: Critic.",
      "Do not rewrite the diagnosis. Challenge it.",
      "Identify unsupported leaps, overconfidence, missed procedural paths, adverse facts not handled, missing source grounding, and lawyer-confirmation gaps.",
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

export function diagnosisSchema(name) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "status",
      "short_diagnosis",
      "court_forum",
      "procedural_posture",
      "simple_case_view",
      "possible_filings",
      "recommended_working_path",
      "legal_routes",
      "recommended_route",
      "next_best_actions",
      "governing_law",
      "central_facts",
      "adverse_or_difficult_facts",
      "missing_information",
      "lawyer_to_confirm",
      "internal_source_handles",
    ],
    properties: {
      schema_version: { type: "string", enum: [`${name}/v1`] },
      status: { type: "string", enum: ["provisional_mw_inferred"] },
      short_diagnosis: { type: "string" },
      simple_case_view: { type: "string" },
      court_forum: postureFieldSchema(),
      procedural_posture: postureFieldSchema(),
      possible_filings: { type: "array", items: filingSchema() },
      recommended_working_path: filingSchema(),
      legal_routes: { type: "array", items: legalRouteSchema() },
      recommended_route: recommendedRouteSchema(),
      next_best_actions: { type: "array", items: { type: "string" } },
      governing_law: { type: "array", items: sourcedTextSchema() },
      central_facts: { type: "array", items: sourcedTextSchema() },
      adverse_or_difficult_facts: { type: "array", items: sourcedTextSchema() },
      missing_information: { type: "array", items: { type: "string" } },
      lawyer_to_confirm: { type: "array", items: { type: "string" } },
      internal_source_handles: { type: "array", items: { type: "string" } },
    },
  };
}

export function finalDiagnosisSchema() {
  const base = diagnosisSchema("posture_diagnosis_final");
  return {
    ...base,
    required: [...base.required, "critique_handling"],
    properties: {
      ...base.properties,
      critique_handling: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["critique_signal", "disposition", "reason"],
          properties: {
            critique_signal: { type: "string" },
            disposition: { type: "string", enum: DISPOSITION_VALUES },
            reason: { type: "string" },
          },
        },
      },
    },
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

function postureFieldSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "confidence", "why", "source_refs", "lawyer_to_confirm"],
    properties: {
      value: { type: "string" },
      confidence: { type: "string", enum: CONFIDENCE_VALUES },
      why: { type: "string" },
      source_refs: { type: "array", items: { type: "string" } },
      lawyer_to_confirm: { type: "string" },
    },
  };
}

function legalRouteSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "route_number",
      "route_title",
      "route_summary",
      "when_to_use",
      "why_this_route",
      "court_or_forum",
      "statutory_references",
      "what_to_confirm",
      "priority",
    ],
    properties: {
      route_number: { type: "integer" },
      route_title: { type: "string" },
      route_summary: { type: "string" },
      when_to_use: { type: "string" },
      why_this_route: { type: "string" },
      court_or_forum: { type: "string" },
      statutory_references: { type: "array", items: { type: "string" } },
      what_to_confirm: { type: "array", items: { type: "string" } },
      priority: { type: "string", enum: PRIORITY_VALUES },
    },
  };
}

function recommendedRouteSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["route_number", "route_title", "recommendation", "reason", "next_step"],
    properties: {
      route_number: { type: "integer" },
      route_title: { type: "string" },
      recommendation: { type: "string" },
      reason: { type: "string" },
      next_step: { type: "string" },
    },
  };
}

function filingSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["priority", "filing_or_remedy", "reason", "key_facts", "caveats", "source_refs"],
    properties: {
      priority: { type: "string", enum: PRIORITY_VALUES },
      filing_or_remedy: { type: "string" },
      reason: { type: "string" },
      key_facts: { type: "array", items: { type: "string" } },
      caveats: { type: "array", items: { type: "string" } },
      source_refs: { type: "array", items: { type: "string" } },
    },
  };
}

function sourcedTextSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["text", "source_refs"],
    properties: {
      text: { type: "string" },
      source_refs: { type: "array", items: { type: "string" } },
    },
  };
}

export function renderProceduralPostureDiagnosisMarkdown(diagnosis = {}) {
  const generated = diagnosis.generated_at || "";
  const basedOn = diagnosis.based_on || {};
  const legalRoutes = normalizeLegalRoutes(diagnosis.legal_routes);
  const recommendedRoute = normalizeRecommendedRoute(diagnosis.recommended_route);
  return [
    "# Filing and Procedural Posture Diagnosis",
    "",
    "Author: MW",
    "Status: Provisional — lawyer confirmation required",
    `Based on: Case Timeline (${basedOn.case_timeline_path || LIST_OF_DATES_MARKDOWN_RELATIVE}), Matter Story (${basedOn.matter_story_path || DISPUTE_STORY_OUTPUT_RELATIVE}), Source Index (${basedOn.source_index_path || SOURCE_INDEX_RELATIVE})`,
    generated ? `Generated: ${generated}` : "",
    "",
    "## Simple case view",
    "",
    diagnosis.simple_case_view || diagnosis.short_diagnosis || "No diagnosis text returned.",
    "",
    "## Current procedural position",
    "",
    renderCurrentPositionParagraph(diagnosis),
    "",
    "## Legal routes available from current record",
    "",
    ...(legalRoutes.length ? renderLegalRoutesMarkdown(legalRoutes) : renderLegacyFilingsAsRoutes(diagnosis.possible_filings)),
    "",
    "## Recommended route",
    "",
    renderRecommendedRouteParagraph({ recommendedRoute, fallback: diagnosis.recommended_working_path }),
    "",
    "## Next best actions",
    "",
    ...numberedStrings(diagnosis.next_best_actions),
    "",
    "## Information the lawyer must confirm",
    "",
    ...bulletStrings(diagnosis.lawyer_to_confirm, "- [ ]"),
    "",
    "## Governing statute / rules / framework",
    "",
    ...bulletSourced(diagnosis.governing_law),
    "",
    "## Facts central to the posture",
    "",
    ...bulletSourced(diagnosis.central_facts),
    "",
    "## Adverse or difficult facts to handle",
    "",
    ...bulletSourced(diagnosis.adverse_or_difficult_facts),
    "",
    "## Missing information / documents",
    "",
    ...bulletStrings(diagnosis.missing_information),
    "",
    "## Internal source handles",
    "",
    ...bulletStrings(diagnosis.internal_source_handles),
  ].filter((line) => line !== null && line !== undefined).join("\n").trimEnd();
}

function renderCurrentPositionParagraph(diagnosis = {}) {
  const court = diagnosis.court_forum || {};
  const posture = diagnosis.procedural_posture || {};
  const parts = [];
  if (court.value) {
    parts.push(`The likely court or forum is ${court.value}. Confidence is ${court.confidence || "unknown"}.`);
  }
  if (court.reason || court.why) {
    parts.push(`This is based on: ${court.reason || court.why}.`);
  }
  if (posture.value) {
    parts.push(`The current procedural position appears to be ${posture.value}. Confidence is ${posture.confidence || "unknown"}.`);
  }
  if (posture.reason || posture.why) {
    parts.push(`Reason: ${posture.reason || posture.why}.`);
  }
  return parts.join(" ") || "The current procedural position is not clear from the supplied record.";
}

function renderLegalRoutesMarkdown(routes = []) {
  return routes.flatMap((route) => [
    `### Route ${route.route_number}: ${route.route_title || "To be confirmed"}`,
    "",
    route.route_summary || "This route needs lawyer review before use.",
    "",
    `Use this route when ${sentenceFragment(route.when_to_use)}.`,
    "",
    `The current record supports or weakens this route because ${sentenceFragment(route.why_this_route)}.`,
    "",
    `The likely court/forum is ${route.court_or_forum || "to be confirmed by the lawyer"}.`,
    "",
    `Statutory references to check: ${inlineList(route.statutory_references) || "to be confirmed before filing"}.`,
    "",
    `Before taking this route, confirm: ${inlineList(route.what_to_confirm) || "the latest court status and missing documents"}.`,
    "",
  ]);
}

function renderLegacyFilingsAsRoutes(items) {
  const filings = normalizeFilings(items);
  if (!filings.length) {
    return ["No clear legal route is supported by the current record. The lawyer should first confirm the live case stage and missing papers."];
  }
  return filings.flatMap((item, index) => [
    `### Route ${index + 1}: ${item.filing_or_remedy || "To be confirmed"}`,
    "",
    item.reason || "This possible route needs lawyer confirmation before use.",
    "",
    `Before taking this route, confirm: ${inlineList([...item.key_facts, ...item.caveats]) || "the latest case status"}.`,
    "",
  ]);
}

function renderRecommendedRouteParagraph({ recommendedRoute = {}, fallback = {} } = {}) {
  if (recommendedRoute.route_title || recommendedRoute.recommendation || recommendedRoute.reason) {
    const label = recommendedRoute.route_number ? `Route ${recommendedRoute.route_number}: ${recommendedRoute.route_title || "recommended route"}` : (recommendedRoute.route_title || "Recommended route");
    return `${label}. ${recommendedRoute.recommendation || "This is the safest working route on the current record."} ${recommendedRoute.reason ? `Reason: ${recommendedRoute.reason}` : ""} ${recommendedRoute.next_step ? `Next step: ${recommendedRoute.next_step}` : ""}`.trim();
  }
  return `**${fallback?.filing_or_remedy || "Unknown"}** — ${fallback?.reason || "Lawyer confirmation required before relying on this path."}`;
}

function inlineList(items) {
  return normalizeStringArray(items).join("; ");
}

function sentenceFragment(value) {
  const text = String(value || "").trim();
  return text ? text.replace(/[.。]+$/, "") : "the lawyer confirms the required facts";
}

function numberedStrings(items) {
  const values = normalizeStringArray(items);
  return values.length ? values.map((item, index) => `${index + 1}. ${item}`) : ["1. Confirm the latest court status, custody/bail position, complete record, and next hearing before choosing a filing route."];
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
    `Based on Case Timeline: ${sidecar.based_on?.case_timeline_path || LIST_OF_DATES_MARKDOWN_RELATIVE}`,
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

function normalizePostureField(field = {}) {
  return {
    value: String(field.value || "").trim(),
    confidence: CONFIDENCE_VALUES.includes(field.confidence) ? field.confidence : "unknown",
    reason: String(field.reason || field.why || "").trim(),
    source_refs: normalizeStringArray(field.source_refs),
    lawyer_to_confirm: String(field.lawyer_to_confirm || "").trim(),
    lawyer_confirmed: false,
  };
}

function normalizeFilings(items) {
  return Array.isArray(items) ? items.map(normalizeFiling).filter((item) => item.filing_or_remedy || item.reason) : [];
}

function normalizeFiling(item = {}) {
  return {
    priority: PRIORITY_VALUES.includes(item.priority) ? item.priority : "unknown",
    filing_or_remedy: String(item.filing_or_remedy || "").trim(),
    reason: String(item.reason || "").trim(),
    key_facts: normalizeStringArray(item.key_facts),
    caveats: normalizeStringArray(item.caveats),
    source_refs: normalizeStringArray(item.source_refs),
  };
}

function normalizeLegalRoutes(items) {
  return Array.isArray(items)
    ? items.map((item, index) => ({
      route_number: normalizeRouteNumber(item?.route_number, index + 1),
      route_title: String(item?.route_title || "").trim(),
      route_summary: String(item?.route_summary || "").trim(),
      when_to_use: String(item?.when_to_use || "").trim(),
      why_this_route: String(item?.why_this_route || "").trim(),
      court_or_forum: String(item?.court_or_forum || "").trim(),
      statutory_references: normalizeStringArray(item?.statutory_references),
      what_to_confirm: normalizeStringArray(item?.what_to_confirm),
      priority: PRIORITY_VALUES.includes(item?.priority) ? item.priority : "unknown",
    })).filter((item) => item.route_title || item.route_summary || item.why_this_route)
    : [];
}

function normalizeRecommendedRoute(item = {}) {
  if (!item || typeof item !== "object") {
    return {
      route_number: 0,
      route_title: "",
      recommendation: "",
      reason: "",
      next_step: "",
    };
  }
  return {
    route_number: normalizeRouteNumber(item.route_number, 0),
    route_title: String(item.route_title || "").trim(),
    recommendation: String(item.recommendation || "").trim(),
    reason: String(item.reason || "").trim(),
    next_step: String(item.next_step || "").trim(),
  };
}

function normalizeRouteNumber(value, fallback) {
  const number = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeSourcedTextList(items) {
  return Array.isArray(items) ? items.map((item) => ({
    text: String(item?.text || "").trim(),
    source_refs: normalizeStringArray(item?.source_refs),
  })).filter((item) => item.text) : [];
}

function normalizeStringArray(items) {
  return Array.isArray(items)
    ? items.map((item) => String(item || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];
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

function bulletSourced(items) {
  const normalized = normalizeSourcedTextList(items);
  return normalized.length ? normalized.map((item) => `- ${item.text}`) : ["- To be confirmed." ];
}

function bulletStrings(items, marker = "-") {
  const normalized = normalizeStringArray(items);
  return normalized.length ? normalized.map((item) => `${marker} ${item}`) : [`${marker} To be confirmed.`];
}

function boundedText(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars).trimEnd()}…`;
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

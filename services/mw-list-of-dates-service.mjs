import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_TASKS } from "../shared/model-policy.mjs";
import { makeHttpError, resolveRelativeInside } from "../shared/safe-paths.mjs";
import {
  CASE_TIMELINE_JSON_RELATIVE,
  CASE_TIMELINE_JSON_RELATIVE_CANDIDATES,
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  CASE_TIMELINE_MARKDOWN_RELATIVE_CANDIDATES,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";
import { DISPUTE_STORY_OUTPUT_RELATIVE } from "./matter-story-service.mjs";
import {
  CASE_ANALYSIS_QA_RELATIVE,
  PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE,
  PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE,
} from "./procedural-posture-diagnosis-service.mjs";
import { runRecordedStage } from "./skill-stage-service.mjs";

export const MW_LIST_OF_DATES_SCHEMA_VERSION = "mw-list-of-dates/v1";
export const MW_LIST_OF_DATES_OUTPUT_RELATIVE = "20_Workshop/Case Analysis/MW List of Dates.md";
export const MW_LIST_OF_DATES_JSON_RELATIVE = "20_Workshop/Case Analysis/MW List of Dates.json";
export const MW_LIST_OF_DATES_ARCHIVE_DIR_RELATIVE = "20_Workshop/Case Analysis/archive";
export const MW_LIST_OF_DATES_SLASH = "/create_mw_listofdates";
export const MW_LIST_OF_DATES_AUTHOR = "MW";

const FILE_TIME_TOLERANCE_MS = 1;
const MAX_CASE_TIMELINE_ROWS = 120;
const MW_LIST_OF_DATES_MAX_OUTPUT_TOKENS = 7000;
const MAX_STORY_CHARS = 8000;
const MAX_QA_CHARS = 4000;
const TREATMENTS = new Set([
  "central",
  "introductory",
  "procedural_context",
  "supporting",
  "adverse_or_difficult",
  "background",
  "not_emphasized",
]);
const COURT_READY_RE = /\b(?:court-ready|filing-ready|final\s+(?:legal\s+)?(?:advice|opinion|draft)|ready\s+to\s+(?:file|send)|may\s+be\s+filed\s+as\s+is|guarantees?\s+success)\b/i;

const MW_LOD_PROVIDER_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "rows",
    "adverse_or_difficult_facts",
    "facts_considered_but_not_emphasized",
    "missing_information_or_documents",
  ],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "case_timeline_row_ids",
          "treatment",
          "framed_event",
          "relevance_to_working_posture",
          "needs_lawyer_review",
          "review_reason",
        ],
        properties: {
          case_timeline_row_ids: { type: "array", minItems: 1, maxItems: 1, items: { type: "string" } },
          treatment: { type: "string" },
          framed_event: { type: "string" },
          relevance_to_working_posture: { type: "string" },
          needs_lawyer_review: { type: "boolean" },
          review_reason: { type: "string" },
        },
      },
    },
    adverse_or_difficult_facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "case_timeline_row_ids", "suggested_treatment"],
        properties: {
          summary: { type: "string" },
          case_timeline_row_ids: { type: "array", items: { type: "string" } },
          suggested_treatment: { type: "string" },
        },
      },
    },
    facts_considered_but_not_emphasized: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "case_timeline_row_ids", "reason"],
        properties: {
          summary: { type: "string" },
          case_timeline_row_ids: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
      },
    },
    missing_information_or_documents: { type: "array", items: { type: "string" } },
  },
});

export function createMwListOfDatesService({
  matterStore,
  aiProviderService = null,
  mwListOfDatesProvider = null,
  now = () => new Date(),
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function readStatus({ matterName = "", matterRootOverride = "", ...overrides } = {}) {
    const matterRoot = await matterRootForName({ matterStore, matterName, matterRootOverride });
    return buildMwListOfDatesStatus({ matterRoot, now, ...overrides });
  }

  async function runMwListOfDates({
    matterName = "",
    matterRootOverride = "",
    overwrite = false,
    proceedUnconfirmed = false,
    proceedUnconfirmedReason = "",
    matterJsonOverride = null,
    artifactReader = null,
    artifactStatReader = null,
    artifactWriter = null,
    runId = "",
    stageRecorder = null,
  } = {}) {
    const matterRoot = await matterRootForName({ matterStore, matterName, matterRootOverride });
    const effectiveRunId = runId || randomUUID();
    const outputPaths = mwListOfDatesOutputPaths();

    const loaded = await runRecordedStage(stageRecorder, {
      id: "load_inputs",
      label: "Load MW List of Dates inputs",
    }, async () => loadMwListOfDatesInputs({
      matterRoot,
      matterJsonOverride,
      artifactReader,
      artifactStatReader,
      now,
    }), {
      successPatch: () => ({ salvageable: true }),
    });

    const preflight = await runRecordedStage(stageRecorder, {
      id: "preflight",
      label: "Check MW List of Dates dependencies",
    }, async () => preflightMwListOfDates(loaded, {
      overwrite,
      proceedUnconfirmed,
      proceedUnconfirmedReason,
    }), {
      successPatch: (result) => ({ summary: result.state, salvageable: true }),
    });

    if (preflight.state === "requires_overwrite") {
      return {
        schema_version: MW_LIST_OF_DATES_SCHEMA_VERSION,
        state: "requires_overwrite",
        status: "requires_overwrite",
        artifactPath: outputPaths.markdown,
        outputPaths,
      };
    }

    const packet = await runRecordedStage(stageRecorder, {
      id: "build_input_packet",
      label: "Build MW List of Dates row-selection packet",
    }, async () => buildMwListOfDatesPacket(loaded), {
      successPatch: (result) => ({ summary: `${result.case_timeline_rows.length} Case Timeline row(s)`, salvageable: true }),
    });

    const providerResult = await runRecordedStage(stageRecorder, {
      id: "select_and_frame_rows",
      label: "Select and frame MW List of Dates rows",
    }, async () => selectAndFrameRows({
      packet,
      aiProviderService,
      mwListOfDatesProvider,
    }), {
      successPatch: (result) => ({ aiRun: result.aiRun || null, salvageable: false }),
    });

    const validated = await runRecordedStage(stageRecorder, {
      id: "validate_output",
      label: "Validate MW List of Dates source mapping",
    }, async () => validateMwListOfDatesDraft({ draft: providerResult.parsed, packet, diagnosis: loaded.diagnosisJson }), {
      successPatch: (result) => ({ summary: `${result.rows.length} row(s)`, salvageable: false }),
    });

    const generatedAt = now().toISOString();
    const previousVersion = loaded.currentSidecar?.version || 0;
    const version = previousVersion + 1;
    const receiptId = effectiveRunId;
    const sidecar = buildMwListOfDatesSidecar({
      inputs: loaded,
      packet,
      validated,
      aiRun: providerResult.aiRun || null,
      generatedAt,
      version,
      receiptId,
      proceedUnconfirmed,
      proceedUnconfirmedReason,
    });
    const markdown = renderMwListOfDatesMarkdown(sidecar);

    const archiveFiles = await runRecordedStage(stageRecorder, {
      id: "archive_previous_version",
      label: "Archive previous MW List of Dates version",
    }, async () => buildArchiveFiles({
      matterRoot,
      inputs: loaded,
      previousVersion,
      generatedAt,
      artifactStatReader,
    }), {
      successPatch: (files) => ({ summary: `${files.length} archive artifact(s)`, salvageable: true }),
    });

    const files = [
      ...archiveFiles,
      { relativePath: outputPaths.markdown, text: `${markdown.trimEnd()}\n` },
      { relativePath: outputPaths.json, text: `${JSON.stringify(sidecar, null, 2)}\n` },
    ];

    const artifactPersistence = await runRecordedStage(stageRecorder, {
      id: "persist_artifacts",
      label: "Persist MW List of Dates artifacts",
    }, async () => (typeof artifactWriter === "function"
      ? artifactWriter({ files, archiveFiles, outputPaths, markdown, sidecar, runId: effectiveRunId })
      : writeMwListOfDatesFiles({ matterRoot, files })), {
      successPatch: () => ({ summary: outputPaths.markdown, salvageable: true }),
    });

    return {
      schema_version: MW_LIST_OF_DATES_SCHEMA_VERSION,
      state: "written",
      status: sidecar.status,
      artifactPath: outputPaths.markdown,
      jsonPath: outputPaths.json,
      outputPaths,
      archivePaths: archiveFiles.map((file) => file.relativePath),
      markdown,
      sidecar,
      receipt: buildMwListOfDatesReceipt({ sidecar, archiveFiles, outputPaths }),
      runId: effectiveRunId,
      ...(artifactPersistence ? { artifactPersistence } : {}),
    };
  }

  return {
    readStatus,
    runMwListOfDates,
  };
}

export async function buildMwListOfDatesStatus({
  matterRoot,
  matterJsonOverride = null,
  artifactReader = null,
  artifactStatReader = null,
  now = () => new Date(),
} = {}) {
  const inputs = await loadMwListOfDatesInputs({
    matterRoot,
    matterJsonOverride,
    artifactReader,
    artifactStatReader,
    now,
    tolerateMalformedCurrent: true,
  });
  const outputPaths = mwListOfDatesOutputPaths();
  const dependency = dependencyStateForInputs(inputs);
  const currentStat = newestStat([inputs.currentMarkdownStat, inputs.currentJsonStat].filter(Boolean));
  const newestInput = newestStat([
    inputs.caseTimelineStat,
    inputs.storyStat,
    inputs.diagnosisStat,
    inputs.sourceIndexStat,
  ].filter(Boolean));
  const currentStale = Boolean(currentStat && newestInput && newestInput.mtimeMs > currentStat.mtimeMs + FILE_TIME_TOLERANCE_MS);
  const state = dependency.state !== "ready"
    ? dependency.state
    : !currentStat
      ? "ready_to_generate"
      : currentStale
        ? "stale"
        : currentStateForSidecar(inputs.currentSidecar, inputs.confirmation.state);

  return {
    schema_version: MW_LIST_OF_DATES_SCHEMA_VERSION,
    slash: MW_LIST_OF_DATES_SLASH,
    label: "MW List of Dates",
    state,
    ready: state === "ready_to_generate" || state.startsWith("current_") || state === "stale",
    artifactPath: outputPaths.markdown,
    jsonPath: outputPaths.json,
    outputPaths,
    currentMarkdownPresent: Boolean(inputs.currentMarkdownStat),
    currentJsonPresent: Boolean(inputs.currentJsonStat),
    caseTimelinePresent: Boolean(inputs.caseTimelineStat),
    matterStoryPresent: Boolean(inputs.storyStat),
    diagnosisPresent: Boolean(inputs.diagnosisStat),
    sourceIndexPresent: Boolean(inputs.sourceIndexStat),
    caseTimelineUpdatedAt: inputs.caseTimelineStat ? inputs.caseTimelineStat.mtime.toISOString() : "",
    matterStoryUpdatedAt: inputs.storyStat ? inputs.storyStat.mtime.toISOString() : "",
    diagnosisUpdatedAt: inputs.diagnosisStat ? inputs.diagnosisStat.mtime.toISOString() : "",
    sourceIndexUpdatedAt: inputs.sourceIndexStat ? inputs.sourceIndexStat.mtime.toISOString() : "",
    currentUpdatedAt: currentStat ? currentStat.mtime.toISOString() : "",
    confirmation: inputs.confirmation,
    blockedReasons: dependency.blockedReasons,
    checkedAt: now().toISOString(),
  };
}

export async function loadMwListOfDatesInputs({
  matterRoot,
  matterJsonOverride = null,
  artifactReader = null,
  artifactStatReader = null,
  now = () => new Date(),
  tolerateMalformedCurrent = false,
} = {}) {
  if (!matterRoot) throw new Error("matterRoot is required");
  const readArtifact = artifactReader || ((relativePath) => readFile(resolveRelativeInside(matterRoot, relativePath), "utf8"));
  const statReader = artifactStatReader || ((relativePath) => fileStatIfFile(resolveRelativeInside(matterRoot, relativePath)));
  const matterJson = matterJsonOverride || await readOptionalJsonPath({ matterRoot, relativePath: "matter.json" }) || {};
  const caseTimelineJsonPath = await firstExistingRelative(statReader, CASE_TIMELINE_JSON_RELATIVE_CANDIDATES);
  const caseTimelineMarkdownPath = await firstExistingRelative(statReader, CASE_TIMELINE_MARKDOWN_RELATIVE_CANDIDATES);
  const caseTimelineJsonStat = caseTimelineJsonPath ? await statReader(caseTimelineJsonPath) : null;
  const caseTimelineMarkdownStat = caseTimelineMarkdownPath ? await statReader(caseTimelineMarkdownPath) : null;
  const caseTimelineStat = newestStat([caseTimelineJsonStat, caseTimelineMarkdownStat].filter(Boolean));
  const storyStat = await statReader(DISPUTE_STORY_OUTPUT_RELATIVE);
  const diagnosisMarkdownStat = await statReader(PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE);
  const diagnosisJsonStat = await statReader(PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE);
  const diagnosisStat = newestStat([diagnosisMarkdownStat, diagnosisJsonStat].filter(Boolean));
  const sourceIndexStat = await statReader(SOURCE_INDEX_RELATIVE);
  const currentMarkdownStat = await statReader(MW_LIST_OF_DATES_OUTPUT_RELATIVE);
  const currentJsonStat = await statReader(MW_LIST_OF_DATES_JSON_RELATIVE);

  const caseTimelineJson = caseTimelineJsonPath ? await readJsonArtifact(readArtifact, caseTimelineJsonPath) : null;
  const caseTimelineMarkdown = caseTimelineMarkdownPath ? await readOptionalArtifact(readArtifact, caseTimelineMarkdownPath) : "";
  const storyMarkdown = storyStat ? await readOptionalArtifact(readArtifact, DISPUTE_STORY_OUTPUT_RELATIVE) : "";
  const diagnosisJson = diagnosisJsonStat ? await readJsonArtifact(readArtifact, PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE) : null;
  const diagnosisMarkdown = diagnosisMarkdownStat ? await readOptionalArtifact(readArtifact, PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE) : "";
  const sourceIndex = sourceIndexStat ? await readJsonArtifact(readArtifact, SOURCE_INDEX_RELATIVE) : null;
  const qnaMarkdown = await readOptionalArtifact(readArtifact, CASE_ANALYSIS_QA_RELATIVE);
  const currentMarkdownText = currentMarkdownStat ? await readOptionalArtifact(readArtifact, MW_LIST_OF_DATES_OUTPUT_RELATIVE) : "";
  const currentJsonText = currentJsonStat ? await readOptionalArtifact(readArtifact, MW_LIST_OF_DATES_JSON_RELATIVE) : "";
  let currentSidecar = null;
  if (currentJsonStat) {
    try {
      currentSidecar = JSON.parse(currentJsonText || "{}");
    } catch (error) {
      if (!tolerateMalformedCurrent) throw makeHttpError(`Could not read ${MW_LIST_OF_DATES_JSON_RELATIVE} as JSON.`, 409, "mw_lod.artifact_unreadable", { cause: error });
      currentSidecar = null;
    }
  }

  return {
    matterRoot,
    matterJson,
    caseTimelineJsonPath,
    caseTimelineMarkdownPath,
    caseTimelineJsonStat,
    caseTimelineMarkdownStat,
    caseTimelineStat,
    caseTimelineJson,
    caseTimelineMarkdown,
    storyStat,
    storyMarkdown,
    diagnosisMarkdownStat,
    diagnosisJsonStat,
    diagnosisStat,
    diagnosisJson,
    diagnosisMarkdown,
    sourceIndexStat,
    sourceIndex,
    qnaMarkdown,
    currentMarkdownStat,
    currentJsonStat,
    currentMarkdownText,
    currentJsonText,
    currentSidecar,
    confirmation: normalizeConfirmation(diagnosisJson?.confirmation),
    loadedAt: now().toISOString(),
  };
}

export function preflightMwListOfDates(inputs = {}, {
  overwrite = false,
  proceedUnconfirmed = false,
  proceedUnconfirmedReason = "",
} = {}) {
  const dependency = dependencyStateForInputs(inputs, { allowUnconfirmed: proceedUnconfirmed });
  if (dependency.state !== "ready") {
    throw makeHttpError(dependency.message, 409, dependency.code);
  }
  if (inputs.currentMarkdownStat && !overwrite) {
    return { state: "requires_overwrite" };
  }
  if (inputs.confirmation.state !== "confirmed" && inputs.confirmation.state !== "corrected") {
    if (!proceedUnconfirmed) {
      throw makeHttpError(
        "Confirm the procedural posture diagnosis before creating the MW List of Dates, or explicitly proceed unconfirmed with a reason.",
        409,
        "mw_lod.diagnosis_unconfirmed",
      );
    }
    if (!String(proceedUnconfirmedReason || "").trim()) {
      throw makeHttpError(
        "Add a reason before proceeding with an unconfirmed procedural diagnosis.",
        400,
        "mw_lod.proceed_reason_required",
      );
    }
  }
  return { state: "ready" };
}

export function buildMwListOfDatesPacket(inputs = {}) {
  const sourceIndexByFileId = sourceIndexMap(inputs.sourceIndex);
  const timelineEntries = Array.isArray(inputs.caseTimelineJson?.entries)
    ? inputs.caseTimelineJson.entries
    : parseCaseTimelineMarkdownRows(inputs.caseTimelineMarkdown);
  const rows = timelineEntries.slice(0, MAX_CASE_TIMELINE_ROWS).map((entry, index) => timelinePacketRow(entry, index, sourceIndexByFileId));
  return {
    schema_version: "mw-list-of-dates-packet/v1",
    matter: {
      name: inputs.matterJson?.matter_name || inputs.diagnosisJson?.matter?.name || "",
      client_name: inputs.matterJson?.client_name || inputs.diagnosisJson?.matter?.client_name || "",
      opposite_party: inputs.matterJson?.opposite_party || inputs.diagnosisJson?.matter?.opposite_party || "",
      client_side: clientSideFromDiagnosis(inputs.diagnosisJson) || inputs.matterJson?.client_side || "",
    },
    procedural_diagnosis: summarizeDiagnosis(inputs.diagnosisJson, inputs.confirmation),
    case_timeline_rows: rows,
    matter_story_excerpt: boundedText(inputs.storyMarkdown, MAX_STORY_CHARS),
    case_analysis_qa_relevant_entries: qnaEntries(inputs.qnaMarkdown),
    packet_limits: {
      max_rows: MAX_CASE_TIMELINE_ROWS,
      row_text_policy: "truncate-long-rows-with-source-preserving-summary",
    },
  };
}

export async function selectAndFrameRows({ packet, aiProviderService = null, mwListOfDatesProvider = null } = {}) {
  if (typeof mwListOfDatesProvider === "function") {
    const supplied = await mwListOfDatesProvider({ packet, prompts: buildMwListOfDatesPrompts(), schema: MW_LOD_PROVIDER_SCHEMA });
    return normalizeProviderResult(supplied);
  }
  if (!aiProviderService?.invoke) {
    throw makeHttpError(
      "MW List of Dates provider is not configured.",
      409,
      "mw_lod.provider_unavailable",
    );
  }
  try {
    const result = await aiProviderService.invoke({
      task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
      systemPrompt: buildMwListOfDatesPrompts().systemPrompt,
      userPayload: packet,
      schema: MW_LOD_PROVIDER_SCHEMA,
      schemaName: "mw_list_of_dates_selector",
      schemaDescription: "Select and frame Case Timeline rows for an MW-authored working List of Dates.",
      responseMode: "json",
      overrides: { maxOutputTokens: MW_LIST_OF_DATES_MAX_OUTPUT_TOKENS },
      label: "MW List of Dates",
    });
    return { parsed: result.parsed, aiRun: result.aiRun || null, rawPayload: result.rawPayload };
  } catch (error) {
    if (error?.code?.includes?.("json") || /json/i.test(error?.message || "")) {
      error.code = "mw_lod.provider_invalid_json";
    }
    throw error;
  }
}

export function validateMwListOfDatesDraft({ draft = {}, packet = {}, diagnosis = {} } = {}) {
  const rowMap = new Map((packet.case_timeline_rows || []).map((row) => [row.timeline_row_id, row]));
  const warnings = [];
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw makeHttpError("MW List of Dates provider returned an invalid JSON object.", 502, "mw_lod.provider_invalid_json");
  }
  const draftRows = Array.isArray(draft.rows) ? draft.rows : [];
  if (!draftRows.length) {
    throw makeHttpError("MW List of Dates provider returned no rows.", 422, "mw_lod.validation_failed");
  }
  if ((packet.case_timeline_rows || []).length >= 30 && draftRows.length < 8) {
    throw validationError("Provider selected too few rows for a substantial Case Timeline. Select individual material rows instead of broad date-range summaries.");
  }
  const rows = [];
  const seenKeys = new Set();
  for (const draftRow of draftRows) {
    const ids = uniqueStrings(draftRow?.case_timeline_row_ids);
    if (!ids.length) throw validationError("A row did not cite a Case Timeline row.");
    if (ids.length !== 1) throw validationError("Each MW List of Dates row must cite exactly one Case Timeline row. Do not group multiple dates into one row.");
    const timelineRows = ids.map((id) => rowMap.get(id));
    if (timelineRows.some((row) => !row)) throw validationError(`Unknown Case Timeline row id: ${ids.find((id) => !rowMap.get(id))}`);
    const primary = timelineRows[0];
    const dateIso = String(primary.date || "").trim();
    if (!dateIso) throw validationError(`Case Timeline row ${primary.timeline_row_id} has no date.`);
    const sourceDisplay = uniqueStrings(timelineRows.flatMap((row) => row.source_labels));
    const internalHandles = uniqueStrings(timelineRows.flatMap((row) => row.internal_source_handles));
    if (!sourceDisplay.length && !internalHandles.length) throw validationError(`Case Timeline row ${primary.timeline_row_id} has no source grounding.`);
    const treatment = normalizeTreatment(draftRow?.treatment);
    const framedEvent = boundedInline(draftRow?.framed_event || primary.event || "");
    const relevance = boundedInline(draftRow?.relevance_to_working_posture || primary.materiality_or_relevance || "");
    if (COURT_READY_RE.test(relevance) || COURT_READY_RE.test(framedEvent)) {
      throw validationError("Provider output used court-ready or final-approval wording.");
    }
    const rowKey = `${dateIso}|${ids.join(",")}`;
    if (seenKeys.has(rowKey)) {
      warnings.push(`Dropped duplicate MW List of Dates row for ${ids.join(", ")}.`);
      continue;
    }
    seenKeys.add(rowKey);
    rows.push({
      id: `MWLOD-${String(rows.length + 1).padStart(4, "0")}`,
      date_iso: dateIso,
      display_date: primary.display_date || dateIso,
      event: framedEvent || primary.event,
      treatment,
      event_stream: primary.event_stream,
      relevance_to_working_posture: relevance || primary.materiality_or_relevance || "Review this event against the working procedural posture.",
      source_display: sourceDisplay,
      case_timeline_row_ids: ids,
      case_timeline_row_fingerprints: uniqueStrings(timelineRows.map((row) => row.row_fingerprint)),
      internal_source_handles: internalHandles,
      adverse_or_difficult: treatment === "adverse_or_difficult",
      needs_lawyer_review: Boolean(draftRow?.needs_lawyer_review) || treatment === "adverse_or_difficult",
      review_reason: boundedInline(draftRow?.review_reason || ""),
    });
  }
  if (!rows.length) throw validationError("No supported MW List of Dates rows remained after validation.");
  rows.sort((a, b) => String(a.date_iso || "").localeCompare(String(b.date_iso || "")) || String(a.id).localeCompare(String(b.id)));
  rows.forEach((row, index) => { row.id = `MWLOD-${String(index + 1).padStart(4, "0")}`; });
  assertChronological(rows);

  const adverseFacts = normalizeReviewItems(draft.adverse_or_difficult_facts, rowMap, "suggested_treatment");
  const considered = normalizeReviewItems(draft.facts_considered_but_not_emphasized, rowMap, "reason");
  const diagnosisAdverseCount = Array.isArray(diagnosis?.adverse_or_difficult_facts) ? diagnosis.adverse_or_difficult_facts.length : 0;
  if (diagnosisAdverseCount && !rows.some((row) => row.adverse_or_difficult) && !adverseFacts.length) {
    throw validationError("Diagnosis-identified adverse facts were not handled in rows or review sections.");
  }

  return {
    rows,
    adverse_or_difficult_facts: adverseFacts,
    facts_considered_but_not_emphasized: considered,
    missing_information_or_documents: uniqueStrings(draft.missing_information_or_documents),
    validation: {
      source_row_ids_valid: true,
      chronological_order_valid: true,
      unsupported_rows_dropped: 0,
      warnings,
    },
  };
}

export function buildMwListOfDatesSidecar({
  inputs,
  packet,
  validated,
  aiRun = null,
  generatedAt,
  version,
  receiptId,
  proceedUnconfirmed = false,
  proceedUnconfirmedReason = "",
} = {}) {
  const confirmationState = inputs.confirmation.state || "unconfirmed";
  return {
    schema_version: MW_LIST_OF_DATES_SCHEMA_VERSION,
    artifact: "MW List of Dates",
    author: MW_LIST_OF_DATES_AUTHOR,
    version,
    status: proceedUnconfirmed ? "provisional" : "working",
    generated_at: generatedAt,
    matter: {
      name: packet.matter.name || "",
      client_side: packet.matter.client_side || "",
      client_side_source: packet.matter.client_side ? "diagnosis" : "unknown",
    },
    based_on: {
      case_timeline: {
        markdown_path: inputs.caseTimelineMarkdownPath || CASE_TIMELINE_MARKDOWN_RELATIVE,
        json_path: inputs.caseTimelineJsonPath || CASE_TIMELINE_JSON_RELATIVE,
        updated_at: inputs.caseTimelineStat ? inputs.caseTimelineStat.mtime.toISOString() : "",
        fingerprint: fingerprintText(JSON.stringify(inputs.caseTimelineJson || {}) || inputs.caseTimelineMarkdown || ""),
      },
      matter_story: {
        path: DISPUTE_STORY_OUTPUT_RELATIVE,
        updated_at: inputs.storyStat ? inputs.storyStat.mtime.toISOString() : "",
        fingerprint: fingerprintText(inputs.storyMarkdown || ""),
      },
      procedural_diagnosis: {
        markdown_path: PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE,
        json_path: PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE,
        updated_at: inputs.diagnosisStat ? inputs.diagnosisStat.mtime.toISOString() : "",
        fingerprint: fingerprintText(JSON.stringify(inputs.diagnosisJson || {}) || inputs.diagnosisMarkdown || ""),
        confirmation_state: confirmationState,
        proceeded_unconfirmed: Boolean(proceedUnconfirmed),
        proceeded_unconfirmed_reason: String(proceedUnconfirmedReason || "").trim(),
      },
      source_index: {
        path: SOURCE_INDEX_RELATIVE,
        updated_at: inputs.sourceIndexStat ? inputs.sourceIndexStat.mtime.toISOString() : "",
        fingerprint: fingerprintText(JSON.stringify(inputs.sourceIndex || {})),
      },
    },
    working_legal_frame: workingLegalFrame(inputs.diagnosisJson, packet),
    rows: validated.rows,
    adverse_or_difficult_facts: validated.adverse_or_difficult_facts,
    facts_considered_but_not_emphasized: validated.facts_considered_but_not_emphasized,
    missing_information_or_documents: uniqueStrings([
      ...validated.missing_information_or_documents,
      ...(Array.isArray(inputs.diagnosisJson?.missing_information) ? inputs.diagnosisJson.missing_information : []),
    ]),
    lawyer_review_checklist: lawyerReviewChecklist(),
    validation: validated.validation,
    ai_run: aiRun,
    receipt_id: receiptId,
  };
}

export function renderMwListOfDatesMarkdown(sidecar = {}) {
  const frame = sidecar.working_legal_frame || {};
  const rows = Array.isArray(sidecar.rows) ? sidecar.rows : [];
  const generated = formatGeneratedAt(sidecar.generated_at);
  const confirmationState = sidecar.based_on?.procedural_diagnosis?.confirmation_state || "unconfirmed";
  const proceeded = sidecar.based_on?.procedural_diagnosis?.proceeded_unconfirmed;
  const statusLine = proceeded
    ? "Provisional — based on unconfirmed procedural diagnosis"
    : "Provisional — lawyer review required";
  return [
    "# MW List of Dates",
    "",
    "Author: MW",
    `Status: ${statusLine}`,
    `Version: v${sidecar.version || 1}`,
    `Generated: ${generated}`,
    `Matter: ${sidecar.matter?.name || "Matter"}`,
    `Based on: Case Timeline, Matter Story, Filing and Procedural Posture Diagnosis`,
    `Diagnosis confirmation state: ${confirmationState}${proceeded ? " (proceeded unconfirmed)" : ""}`,
    "",
    "## Working Legal Frame",
    "",
    `- Client side: ${frame.client_side || sidecar.matter?.client_side || "To confirm"}`,
    `- Court/forum: ${frame.court_forum || "To confirm"}`,
    `- Procedural posture: ${frame.procedural_posture || "To confirm"}`,
    `- Priority filing/remedy: ${frame.priority_filing_or_remedy || "To confirm"}`,
    `- Main objective: ${frame.main_objective || "To confirm"}`,
    `- Governing law / framework: ${Array.isArray(frame.governing_law) && frame.governing_law.length ? frame.governing_law.join("; ") : "To confirm"}`,
    "",
    "## How To Read This Document",
    "",
    "This is an MW-authored working List of Dates for lawyer review. It is not a court-facing filing copy. It is derived from the Case Timeline and the current procedural diagnosis. Verify sources and posture before relying on it.",
    "",
    "## List of Dates",
    "",
    "| Date | Event | Treatment | Relevance to working posture / remedy | Source |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${mdCell(row.display_date || row.date_iso)} | ${mdCell(row.event)} | ${mdCell(labelForTreatment(row.treatment))} | ${mdCell(row.relevance_to_working_posture)} | ${mdCell(formatSourceDisplay(row.source_display))} |`),
    "",
    "## Adverse Or Difficult Facts To Handle",
    "",
    renderReviewList(sidecar.adverse_or_difficult_facts, "No separate adverse or difficult facts were identified beyond the table above."),
    "",
    "## Facts Considered But Not Emphasized",
    "",
    "> Internal lawyer-review section. Do not copy into court-facing drafts without lawyer decision.",
    "",
    renderReviewList(sidecar.facts_considered_but_not_emphasized, "No additional facts were parked by the selector."),
    "",
    "## Missing Information / Documents",
    "",
    renderStringList(sidecar.missing_information_or_documents, "No additional missing information was identified."),
    "",
    "## Lawyer Review Checklist",
    "",
    ...lawyerReviewChecklist().map((item) => `- [ ] ${item}`),
    "",
    "## Source Audit Note",
    "",
    "Internal source handles and row fingerprints are stored in the JSON sidecar and run receipt for audit/regeneration. They are not shown in this default lawyer-visible Markdown.",
    "",
  ].join("\n");
}

export function buildMwListOfDatesPrompts() {
  return {
    systemPrompt: [
      legalWorkbenchSystemPrompt("Create an MW List of Dates from the supplied Case Timeline packet.", { nativeSkill: "create_mw_listofdates" }),
      "Native skill policy for Create MW List of Dates:",
      "Create an MW-authored working List of Dates for lawyer review, not final legal advice and not a court-facing filing copy.",
      "Use only the supplied Case Timeline rows, Matter Story excerpt, procedural diagnosis, and Case Analysis Q&A snippets.",
      "Select and frame rows for the diagnosed working path; do not rediscover facts from source documents.",
      "Cite only supplied case_timeline_rows[].timeline_row_id values.",
      "Do not invent dates, actors, procedural steps, filings, statutes, annexure labels, source labels, page numbers, or findings.",
      "Preserve adverse or difficult material facts responsibly; include them in rows or the adverse-fact review section.",
      "Distinguish allegations, denials, records, orders, and findings. Do not convert disputed allegations into established facts.",
      "Each output row must cite exactly one case_timeline_rows[].timeline_row_id. Do not group multiple dates, ranges, or long phases into one row.",
      "For a substantial Case Timeline, select a practical lawyer-review set of individual rows, normally 12 to 25 rows: procedural milestones, key demands/notices, payments or ledger disputes, possession/registration events, adverse facts, and remedy-critical facts.",
      "Do not create a four-row executive summary when the Case Timeline contains many material dated events.",
      "Return JSON only matching the schema.",
    ].join("\n"),
  };
}

function dependencyStateForInputs(inputs = {}, { allowUnconfirmed = false } = {}) {
  if (!inputs.caseTimelineStat) return blocked("blocked_missing_case_timeline", "Build the Case Timeline before creating the MW List of Dates.", "mw_lod.case_timeline_missing");
  if (!inputs.sourceIndexStat) return blocked("blocked_missing_source_index", "Build the Source Index before creating the MW List of Dates.", "mw_lod.source_index_missing");
  if (inputs.sourceIndexStat && inputs.caseTimelineStat && inputs.sourceIndexStat.mtimeMs > inputs.caseTimelineStat.mtimeMs + FILE_TIME_TOLERANCE_MS) {
    return blocked("blocked_stale_case_timeline", "Refresh the Case Timeline before creating the MW List of Dates.", "mw_lod.case_timeline_stale");
  }
  if (!inputs.storyStat) return blocked("blocked_missing_story", "Write the Matter Story before creating the MW List of Dates.", "mw_lod.story_missing");
  if (inputs.caseTimelineStat && inputs.storyStat.mtimeMs + FILE_TIME_TOLERANCE_MS < inputs.caseTimelineStat.mtimeMs) {
    return blocked("blocked_stale_story", "Refresh the Matter Story before creating the MW List of Dates.", "mw_lod.story_stale");
  }
  if (!inputs.diagnosisStat) return blocked("blocked_missing_diagnosis", "Run Procedural Posture Diagnosis before creating the MW List of Dates.", "mw_lod.diagnosis_missing");
  const upstream = newestStat([inputs.caseTimelineStat, inputs.storyStat].filter(Boolean));
  if (upstream && inputs.diagnosisStat.mtimeMs + FILE_TIME_TOLERANCE_MS < upstream.mtimeMs) {
    return blocked("blocked_stale_diagnosis", "Refresh Procedural Posture Diagnosis before creating the MW List of Dates.", "mw_lod.diagnosis_stale");
  }
  if (!allowUnconfirmed && inputs.confirmation.state !== "confirmed" && inputs.confirmation.state !== "corrected") {
    return blocked("blocked_unconfirmed_diagnosis", "Confirm or correct the procedural posture diagnosis before creating the MW List of Dates.", "mw_lod.diagnosis_unconfirmed");
  }
  return { state: "ready", code: "mw_lod.ready", blockedReasons: [] };
}

function blocked(state, message, code) {
  return { state, message, code, blockedReasons: [message] };
}

function currentStateForSidecar(sidecar = {}, confirmationState = "") {
  if (sidecar?.based_on?.procedural_diagnosis?.proceeded_unconfirmed) return "current_provisional";
  if (confirmationState === "corrected") return "current_corrected_basis";
  if (confirmationState === "confirmed") return "current_confirmed_basis";
  return "current_unconfirmed";
}

function timelinePacketRow(entry = {}, index = 0, sourceIndexByFileId = new Map()) {
  const supportingSources = Array.isArray(entry.supporting_sources) && entry.supporting_sources.length
    ? entry.supporting_sources
    : [entry];
  const internalHandles = uniqueStrings(supportingSources.map((source) => source.citation || source.raw_citation || entry.citation));
  const sourceLabels = uniqueStrings(supportingSources.map((source) => source.source_label || source.display_label || source.source_short_label || source.short_label || source.original_name || labelFromSourceIndex(source.citation || entry.citation, sourceIndexByFileId) || source.source_path));
  const rowId = `CT-${String(index + 1).padStart(4, "0")}`;
  const date = String(entry.date_iso || entry.date || entry.display_date || "").trim();
  const event = boundedInline(entry.event || entry.event_candidate || "");
  return {
    timeline_row_id: rowId,
    row_fingerprint: fingerprintText(JSON.stringify({ index, date, event, internalHandles })),
    date,
    display_date: String(entry.date_text || entry.date_display || entry.date_iso || date || "").trim(),
    event,
    actor_or_posture: String(entry.actor_or_posture || entry.party_posture || "").trim(),
    materiality_or_relevance: boundedInline(entry.legal_relevance || entry.legal_materiality || ""),
    event_stream: eventStreamForEntry(entry),
    source_labels: sourceLabels,
    internal_source_handles: internalHandles,
  };
}

function eventStreamForEntry(entry = {}) {
  const text = `${entry.event_type || ""} ${entry.event || ""}`.toLowerCase();
  if (/(petition|appeal|suit|complaint|application|hearing|order|judgment|decree|tribunal|court|nclt|supreme|high court|filing|notice issued by court)/.test(text)) return "procedural";
  if (/(notice|reply|demand|payment|agreement|possession|default|termination|email|letter)/.test(text)) return "factual";
  return "mixed";
}

function sourceIndexMap(sourceIndex = {}) {
  const sources = Array.isArray(sourceIndex?.sources) ? sourceIndex.sources : [];
  return new Map(sources.map((source) => [source.file_id, source]));
}

function labelFromSourceIndex(citation = "", sourceIndexByFileId = new Map()) {
  const fileId = String(citation || "").match(/FILE-\d{4,}/i)?.[0]?.toUpperCase();
  if (!fileId) return "";
  const source = sourceIndexByFileId.get(fileId);
  return source?.source_label || source?.display_label || source?.source_short_label || source?.short_label || source?.original_name || "";
}

function summarizeDiagnosis(diagnosis = {}, confirmation = {}) {
  return {
    court_forum: valueOfPostureField(diagnosis?.court_forum),
    procedural_posture: valueOfPostureField(diagnosis?.procedural_posture),
    recommended_working_path: diagnosis?.recommended_working_path?.filing_or_remedy || diagnosis?.recommended_route?.route_label || "",
    possible_filings: Array.isArray(diagnosis?.possible_filings) ? diagnosis.possible_filings.map((item) => item?.filing_or_remedy || item?.label || "").filter(Boolean) : [],
    governing_law: Array.isArray(diagnosis?.governing_law) ? diagnosis.governing_law.map((item) => item?.text || item?.value || String(item || "")).filter(Boolean) : [],
    adverse_or_difficult_facts: Array.isArray(diagnosis?.adverse_or_difficult_facts) ? diagnosis.adverse_or_difficult_facts.map((item) => item?.text || item?.value || String(item || "")).filter(Boolean) : [],
    missing_information: uniqueStrings(diagnosis?.missing_information),
    confirmation_state: confirmation.state || "unconfirmed",
  };
}

function workingLegalFrame(diagnosis = {}, packet = {}) {
  const summary = summarizeDiagnosis(diagnosis, packet.procedural_diagnosis || {});
  return {
    client_side: packet.matter?.client_side || clientSideFromDiagnosis(diagnosis),
    court_forum: summary.court_forum,
    procedural_posture: summary.procedural_posture,
    priority_filing_or_remedy: summary.recommended_working_path,
    main_objective: diagnosis?.recommended_route?.route_summary || diagnosis?.recommended_working_path?.reason || diagnosis?.simple_case_view || "",
    governing_law: summary.governing_law,
  };
}

function clientSideFromDiagnosis(diagnosis = {}) {
  const text = `${diagnosis?.recommended_working_path?.client_side || diagnosis?.recommended_route?.client_side || diagnosis?.matter?.client_side || ""}`.trim();
  return text;
}

function valueOfPostureField(field = {}) {
  if (typeof field === "string") return field;
  return String(field?.value || field?.summary || field?.label || "").trim();
}

function normalizeProviderResult(supplied = {}) {
  if (supplied?.parsed) return { parsed: supplied.parsed, aiRun: supplied.aiRun || null, rawPayload: supplied.rawPayload };
  return { parsed: supplied, aiRun: supplied?.aiRun || null, rawPayload: supplied };
}

function normalizeReviewItems(items = [], rowMap = new Map(), extraField = "reason") {
  return (Array.isArray(items) ? items : []).map((item) => {
    const ids = uniqueStrings(item?.case_timeline_row_ids).filter((id) => rowMap.has(id));
    if (!ids.length) return null;
    return {
      summary: boundedInline(item?.summary || ""),
      case_timeline_row_ids: ids,
      [extraField]: boundedInline(item?.[extraField] || ""),
    };
  }).filter(Boolean);
}

function assertChronological(rows = []) {
  let previous = "";
  for (const row of rows) {
    const current = String(row.date_iso || "");
    if (previous && current && current < previous) {
      throw validationError("MW List of Dates rows must remain chronological.");
    }
    if (current) previous = current;
  }
}

function validationError(message) {
  return makeHttpError(message, 422, "mw_lod.validation_failed");
}

function normalizeTreatment(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  return TREATMENTS.has(normalized) ? normalized : "supporting";
}

function normalizeConfirmation(confirmation = {}) {
  return {
    state: String(confirmation?.state || "unconfirmed").trim() || "unconfirmed",
    confirmed_at: String(confirmation?.confirmed_at || "").trim(),
    reason_or_correction: String(confirmation?.reason_or_correction || "").trim(),
    actor: String(confirmation?.actor || "unknown").trim() || "unknown",
  };
}

async function buildArchiveFiles({ matterRoot, inputs = {}, previousVersion = 0, generatedAt = "", artifactStatReader = null } = {}) {
  if (!inputs.currentMarkdownStat && !inputs.currentJsonStat) return [];
  const version = previousVersion || inputs.currentSidecar?.version || 1;
  const timestamp = archiveTimestamp(generatedAt || new Date().toISOString());
  const archiveBase = `${MW_LIST_OF_DATES_ARCHIVE_DIR_RELATIVE}/MW List of Dates v${version} - ${timestamp}`;
  const archiveMarkdownPath = await collisionSafeArchivePath({ matterRoot, relativePath: `${archiveBase}.md`, artifactStatReader });
  const archiveJsonPath = await collisionSafeArchivePath({ matterRoot, relativePath: `${archiveBase}.json`, artifactStatReader });
  const files = [];
  if (inputs.currentMarkdownStat) files.push({ relativePath: archiveMarkdownPath, text: inputs.currentMarkdownText || "" });
  if (inputs.currentJsonStat) files.push({ relativePath: archiveJsonPath, text: inputs.currentJsonText || "" });
  return files;
}

async function collisionSafeArchivePath({ matterRoot, relativePath, artifactStatReader = null }) {
  const statReader = artifactStatReader || ((candidate) => fileStatIfFile(resolveRelativeInside(matterRoot, candidate)));
  const extension = path.posix.extname(relativePath);
  const base = extension ? relativePath.slice(0, -extension.length) : relativePath;
  let candidate = relativePath;
  let index = 2;
  while (await statReader(candidate)) {
    candidate = `${base} - ${index}${extension}`;
    index += 1;
  }
  return candidate;
}

async function writeMwListOfDatesFiles({ matterRoot, files = [] } = {}) {
  for (const file of files) {
    const absolute = resolveRelativeInside(matterRoot, file.relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFileAtomic(absolute, file.text);
  }
  return { persisted: files.map((file) => ({ relativePath: file.relativePath })) };
}

function buildMwListOfDatesReceipt({ sidecar = {}, archiveFiles = [], outputPaths = {} } = {}) {
  return {
    schema_version: "mw-list-of-dates-receipt/v1",
    receipt_id: sidecar.receipt_id || "",
    matter: sidecar.matter || {},
    generated_at: sidecar.generated_at || "",
    version: sidecar.version || 1,
    diagnosis_confirmation_state: sidecar.based_on?.procedural_diagnosis?.confirmation_state || "",
    proceeded_unconfirmed: Boolean(sidecar.based_on?.procedural_diagnosis?.proceeded_unconfirmed),
    validation: sidecar.validation || {},
    output_paths: outputPaths,
    archive_paths: archiveFiles.map((file) => file.relativePath),
  };
}

function mwListOfDatesOutputPaths() {
  return {
    markdown: MW_LIST_OF_DATES_OUTPUT_RELATIVE,
    json: MW_LIST_OF_DATES_JSON_RELATIVE,
  };
}

function lawyerReviewChecklist() {
  return [
    "Court/forum still correct",
    "Procedural posture still correct",
    "Priority filing/remedy still correct",
    "Main relief/objective still correct",
    "Governing law/framework adequate",
    "Adverse facts handled responsibly",
    "Missing documents/facts addressed or deliberately parked",
    "Sources checked before court-facing use",
  ];
}

function renderReviewList(items = [], emptyText = "None.") {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return emptyText;
  return list.map((item) => `- ${String(item.summary || "").trim() || "Review item"}`).join("\n");
}

function renderStringList(items = [], emptyText = "None.") {
  const list = uniqueStrings(items);
  if (!list.length) return emptyText;
  return list.map((item) => `- ${item}`).join("\n");
}

function labelForTreatment(treatment = "") {
  return String(treatment || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSourceDisplay(sources = []) {
  return uniqueStrings(sources).join("; ");
}

function mdCell(value = "") {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

function formatGeneratedAt(value = "") {
  if (!value) return "";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function archiveTimestamp(value = "") {
  const date = value ? new Date(value) : new Date();
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  return valid.toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
}

function fingerprintText(text = "") {
  return `sha256:${createHash("sha256").update(String(text || "")).digest("hex")}`;
}

function boundedText(value = "", maxChars = 4000) {
  const text = String(value || "").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 20).trimEnd()}\n[truncated]` : text;
}

function boundedInline(value = "", maxChars = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function qnaEntries(markdown = "") {
  const text = boundedText(markdown, MAX_QA_CHARS);
  return text ? [text] : [];
}

function uniqueStrings(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : [values]) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

async function matterRootForName({ matterStore, matterName: rawMatterName = "", matterRootOverride = "" } = {}) {
  const overrideRoot = typeof matterRootOverride === "string" ? matterRootOverride.trim() : "";
  if (overrideRoot) return overrideRoot;
  const matterName = typeof rawMatterName === "string" ? rawMatterName.trim() : "";
  if (!matterName) return matterStore.ensureMatterRoot();
  const { matterPath } = await matterStore.resolveExistingMatter(matterName);
  return matterPath;
}

async function readOptionalJsonPath({ matterRoot, relativePath } = {}) {
  try {
    return JSON.parse(await readFile(resolveRelativeInside(matterRoot, relativePath), "utf8"));
  } catch {
    return null;
  }
}

async function readJsonArtifact(readArtifact, relativePath) {
  try {
    return JSON.parse(await readArtifact(relativePath));
  } catch (error) {
    throw makeHttpError(`Could not read ${relativePath} as JSON.`, 409, "mw_lod.artifact_unreadable", { cause: error });
  }
}

async function readOptionalArtifact(readArtifact, relativePath) {
  try {
    return await readArtifact(relativePath);
  } catch {
    return "";
  }
}

async function firstExistingRelative(statReader, relatives = []) {
  for (const relativePath of relatives) {
    if (await statReader(relativePath)) return relativePath;
  }
  return "";
}

async function fileStatIfFile(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function newestStat(stats = []) {
  return stats.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

function parseCaseTimelineMarkdownRows(markdown = "") {
  const rows = [];
  for (const line of String(markdown || "").split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    if (/^\|\s*-+/.test(line)) continue;
    if (/\|\s*Date\s*\|\s*Event/i.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.replace(/\\\|/g, "|").trim());
    if (cells.length < 3) continue;
    rows.push({
      date_iso: cells[0],
      event: cells[1],
      legal_relevance: cells[2],
      source_label: cells[3] || "",
    });
  }
  return rows;
}

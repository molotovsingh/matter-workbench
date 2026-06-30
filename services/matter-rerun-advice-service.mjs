import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AI_RUN_STATUS_FIELDS, normalizeAiRunMetadata } from "../shared/ai-run-metadata.mjs";
import { makeHttpError, toPosix } from "../shared/safe-paths.mjs";
import {
  CASE_TIMELINE_JSON_RELATIVE,
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";
import {
  CASE_TIMELINE_DEPENDENCY_STATES,
  classifyCaseTimelineDependencyState,
} from "./case-timeline-dependency-state.mjs";
import {
  addInactiveRegisterRowsToSuppressionIndex,
  isSourceSuppressed,
  readSourceSuppressionIndex,
} from "./active-source-set-service.mjs";
import { RERUN_ADVICE_STATES } from "../shared/rerun-advice-states.mjs";

export {
  CASE_TIMELINE_JSON_RELATIVE,
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  SOURCE_INDEX_RELATIVE,
};

// Compatibility exports for callers that still live in the native skill lane.
export const LIST_OF_DATES_JSON_RELATIVE = CASE_TIMELINE_JSON_RELATIVE;
export const LIST_OF_DATES_MARKDOWN_RELATIVE = CASE_TIMELINE_MARKDOWN_RELATIVE;

export async function readRerunAdviceForSkill(skill, root) {
  const normalizedSkill = normalizeSkillName(skill);
  if (normalizedSkill === "/describe_sources") return describeSourcesRerunAdvice(root);
  if (normalizedSkill === "/create_listofdates") return caseTimelineRerunAdvice(root);
  throw makeHttpError(`Rerun advice is not available for ${skill || "unknown skill"}`, 400, "rerun_advice.unsupported_skill");
}

export async function describeSourcesRerunAdvice(root) {
  const sourceSuppressionIndex = await readRerunSourceSuppressionIndex(root);
  const target = await readArtifact(root, SOURCE_INDEX_RELATIVE, { jsonRequired: true });
  const extractionInputs = await listExtractionRecordInputs(root, { sourceSuppressionIndex });
  return buildRerunAdvice({
    root,
    skill: "/describe_sources",
    label: "source descriptors",
    target,
    upstreamInputs: extractionInputs,
    staleDescription: "newer extraction records were found",
    currentDescription: "No newer extraction records were found.",
    findContentChange: findSourceDescriptorContentChange,
  });
}

export async function caseTimelineRerunAdvice(root) {
  const sourceSuppressionIndex = await readRerunSourceSuppressionIndex(root);
  const markdownTarget = await readArtifact(root, CASE_TIMELINE_MARKDOWN_RELATIVE);
  const jsonTarget = await readArtifact(root, CASE_TIMELINE_JSON_RELATIVE);
  const target = markdownTarget.exists ? {
    ...markdownTarget,
    json: jsonTarget.json,
  } : jsonTarget;
  const extractionInputs = await listExtractionRecordInputs(root, { sourceSuppressionIndex });
  const sourceIndexInput = await inputFile(root, SOURCE_INDEX_RELATIVE);
  const sourceIndexJson = sourceIndexInput
    ? await readJsonIfPossible(path.join(root, SOURCE_INDEX_RELATIVE))
    : null;
  return buildRerunAdvice({
    root,
    skill: "/create_listofdates",
    label: "case timeline",
    target,
    upstreamInputs: [
      ...extractionInputs.map((input) => ({ ...input, inputKind: "extraction_record" })),
      ...(sourceIndexInput ? [{ ...sourceIndexInput, inputKind: "source_index" }] : []),
    ],
    staleDescription: "newer extraction records or Source Index changes were found",
    currentDescription: "No newer extraction records or Source Index changes were found.",
    findContentChange: ({ target: timelineTarget, upstreamInputs: inputs }) => findCaseTimelineContentChange({
      target: timelineTarget,
      upstreamInputs: inputs,
      sourceIndex: sourceIndexJson,
    }),
    classifyStaleDependency: (newestInput) => classifyCaseTimelineDependencyState({
      target,
      newestInput,
      sourceIndex: sourceIndexJson,
    }),
  });
}

export const listOfDatesRerunAdvice = caseTimelineRerunAdvice;

function buildRerunAdvice({
  root,
  skill,
  label,
  target,
  upstreamInputs,
  staleDescription,
  currentDescription,
  findContentChange = null,
  classifyStaleDependency = null,
}) {
  if (!target.exists) {
    return baseRerunAdvice({ skill, label, state: RERUN_ADVICE_STATES.MISSING, shouldConfirm: false });
  }
  if (!target.valid) {
    return baseRerunAdvice({
      skill,
      label,
      state: RERUN_ADVICE_STATES.FAILED,
      shouldConfirm: false,
      artifactPath: target.relativePath,
    });
  }
  const contentChangedInput = typeof findContentChange === "function"
    ? findContentChange({ target, upstreamInputs })
    : null;
  if (!upstreamInputs.length && !contentChangedInput) {
    return baseRerunAdvice({
      skill,
      label,
      state: RERUN_ADVICE_STATES.MISSING_UPSTREAM,
      shouldConfirm: false,
      artifactPath: target.relativePath,
      lastRunAt: artifactRunTime(target),
      aiRun: normalizeAiRunMetadata(target.json?.ai_run, { fields: AI_RUN_STATUS_FIELDS }),
    });
  }

  const newestInput = upstreamInputs.reduce((newest, input) => (
    !newest || input.mtimeMs > newest.mtimeMs ? input : newest
  ), null);
  const mtimeStale = newestInput && isNewerByTrustedMtime({
    inputMtimeMs: newestInput.mtimeMs,
    targetMtimeMs: target.mtimeMs,
  });
  const staleInput = contentChangedInput || (mtimeStale ? newestInput : null);
  if (staleInput) {
    const dependencyState = typeof classifyStaleDependency === "function"
      ? (staleInput.dependencyState || classifyStaleDependency(staleInput))
      : "";
    const labelRefreshOnly = dependencyState === CASE_TIMELINE_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED;
    const advice = baseRerunAdvice({
      skill,
      label,
      state: RERUN_ADVICE_STATES.STALE,
      shouldConfirm: labelRefreshOnly,
      artifactPath: target.relativePath,
      lastRunAt: artifactRunTime(target),
      aiRun: normalizeAiRunMetadata(target.json?.ai_run, { fields: AI_RUN_STATUS_FIELDS }),
      reason: labelRefreshOnly
        ? "Only Source Index labels appear newer than this artifact."
        : staleInput.reason || staleDescription,
      dependencyState,
      newestInputPath: staleInput.relativePath,
      newestInputAt: staleInput.mtimeMs ? new Date(staleInput.mtimeMs).toISOString() : "",
    });
    if (labelRefreshOnly) advice.message = formatLabelRefreshMessage(advice);
    return advice;
  }

  const aiRun = normalizeAiRunMetadata(target.json?.ai_run, { fields: AI_RUN_STATUS_FIELDS });
  const lastRunAt = artifactRunTime(target);
  const advice = baseRerunAdvice({
    skill,
    label,
    state: RERUN_ADVICE_STATES.CURRENT,
    shouldConfirm: true,
    artifactPath: target.relativePath,
    lastRunAt,
    aiRun,
    reason: currentDescription,
    inputCount: upstreamInputs.length,
  });
  advice.message = formatRerunMessage(advice);
  return advice;
}

function formatLabelRefreshMessage(advice) {
  const lines = [
    `${advice.skill} has a current ${advice.label} artifact, but source labels changed after it was rendered.`,
    `Artifact: ${advice.artifactPath}`,
  ];
  if (advice.lastRunAt) lines.push(`Last run: ${advice.lastRunAt}`);
  lines.push("This usually needs a cheap label/render refresh, not AI chronology regeneration.");
  lines.push("Regenerate only if the legal chronology itself may be wrong.");
  return lines.join("\n");
}

function baseRerunAdvice({
  skill,
  label,
  state,
  shouldConfirm,
  artifactPath = "",
  lastRunAt = "",
  aiRun = null,
  reason = "",
  dependencyState = "",
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
    provider: aiRun?.returnedProvider || aiRun?.provider || "",
    model: aiRun?.returnedModel || aiRun?.model || "",
    policyPromptVersion: aiRun?.policyPromptVersion || "",
    reason,
    dependencyState,
    newestInputPath,
    newestInputAt,
    inputCount,
  };
}

function formatRerunMessage(advice) {
  const lines = [
    `${advice.skill} already has a current ${advice.label} artifact.`,
    `Artifact: ${advice.artifactPath}`,
  ];
  if (advice.lastRunAt) lines.push(`Last run: ${advice.lastRunAt}`);
  if (advice.model || advice.provider) {
    lines.push(`Provider/model: ${[advice.provider, advice.model].filter(Boolean).join(" / ")}`);
  }
  if (advice.reason) lines.push(advice.reason);
  lines.push("Run it again anyway?");
  return lines.join("\n");
}

async function readRerunSourceSuppressionIndex(root) {
  const warnings = [];
  const sourceSuppressionIndex = await readSourceSuppressionIndex(root, { warnings });
  const intakeFolders = await listIntakeFoldersFromDisk(root);
  await addInactiveRegisterRowsToSuppressionIndex(root, intakeFolders.map((folder) => ({
    intake_dir: `00_Inbox/${folder.name}`,
  })), sourceSuppressionIndex, { warnings });
  return sourceSuppressionIndex;
}

async function listExtractionRecordInputs(root, { sourceSuppressionIndex = null } = {}) {
  const inputs = [];
  const intakeFolders = await listIntakeFoldersFromDisk(root);
  for (const folder of intakeFolders) {
    const extractedDir = path.join(root, "00_Inbox", folder.name, "_extracted");
    let entries = [];
    try {
      entries = await readdir(extractedDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/^FILE-\d+\.json$/i.test(entry.name)) continue;
      const filePath = path.join(extractedDir, entry.name);
      let fileStat = null;
      try {
        fileStat = await stat(filePath);
      } catch {
        continue;
      }
      if (!fileStat.isFile()) continue;
      const json = await readJsonIfPossible(filePath);
      const fileId = normalizeText(json?.file_id) || normalizeText(json?.fileId) || entry.name.replace(/\.json$/i, "");
      const input = {
        relativePath: toMatterRelative(root, filePath),
        mtimeMs: fileStat.mtimeMs,
        fileId,
        sourcePath: normalizeText(json?.source_path || json?.sourcePath),
        contentHash: sourceContentHash(json),
      };
      if (isSourceSuppressed({ file_id: input.fileId, source_path: input.sourcePath }, sourceSuppressionIndex)) continue;
      inputs.push(input);
    }
  }
  return inputs;
}

async function listIntakeFoldersFromDisk(root) {
  const inboxPath = path.join(root, "00_Inbox");
  try {
    const entries = await readdir(inboxPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^Intake (\d{2,})\b/.test(entry.name))
      .map((entry) => {
        const match = entry.name.match(/^Intake (\d{2,})/);
        return { name: entry.name, intakeNumber: parseInt(match[1], 10) };
      })
      .sort((a, b) => a.intakeNumber - b.intakeNumber);
  } catch {
    return [];
  }
}

async function readArtifact(root, relativePath, options = {}) {
  const filePath = path.join(root, relativePath);
  let fileStat = null;
  try {
    fileStat = await stat(filePath);
  } catch {
    return {
      exists: false,
      valid: false,
      relativePath,
      mtimeMs: 0,
      json: null,
    };
  }
  if (!fileStat.isFile()) {
    return {
      exists: false,
      valid: false,
      relativePath,
      mtimeMs: 0,
      json: null,
    };
  }
  const json = relativePath.toLowerCase().endsWith(".json")
    ? await readJsonIfPossible(filePath)
    : null;
  return {
    exists: true,
    valid: options.jsonRequired ? Boolean(json) : true,
    relativePath,
    mtimeMs: fileStat.mtimeMs,
    mtimeIso: fileStat.mtime.toISOString(),
    json,
  };
}

async function inputFile(root, relativePath) {
  const filePath = path.join(root, relativePath);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return null;
    return {
      relativePath,
      mtimeMs: fileStat.mtimeMs,
    };
  } catch {
    return null;
  }
}

async function readJsonIfPossible(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function artifactRunTime(target) {
  return normalizeText(target.json?.generated_at) || target.mtimeIso || "";
}

export function isNewerByTrustedMtime({ inputMtimeMs, targetMtimeMs }) {
  return Number(inputMtimeMs) > 0
    && Number(targetMtimeMs) > 0
    && Number(inputMtimeMs) > Number(targetMtimeMs) + 1;
}

function findSourceDescriptorContentChange({ target, upstreamInputs }) {
  const previousByFileId = sourceIndexSourceMap(target.json);
  if (!previousByFileId.size) return null;
  const activeFileIds = new Set(upstreamInputs.map((input) => input.fileId).filter(Boolean));
  for (const fileId of previousByFileId.keys()) {
    if (!activeFileIds.has(fileId)) {
      return {
        relativePath: target.relativePath,
        mtimeMs: target.mtimeMs,
        reason: "A source in the Source Index is no longer in the active source set.",
      };
    }
  }
  for (const input of upstreamInputs) {
    if (!input.fileId || !input.contentHash) continue;
    const previous = previousByFileId.get(input.fileId);
    if (!previous) {
      return {
        ...input,
        reason: "Changed source content was found after the Source Index was built.",
      };
    }
    if (previous.contentHash && previous.contentHash !== input.contentHash) {
      return {
        ...input,
        reason: "Changed source content was found after the Source Index was built.",
      };
    }
  }
  return null;
}

function findCaseTimelineContentChange({ target, upstreamInputs, sourceIndex }) {
  const snapshotByFileId = caseTimelineSnapshotMap(target.json);
  if (!snapshotByFileId.size) return null;
  const activeExtractionFileIds = new Set(upstreamInputs
    .filter((input) => input.inputKind === "extraction_record")
    .map((input) => input.fileId)
    .filter(Boolean));
  for (const fileId of snapshotByFileId.keys()) {
    if (!activeExtractionFileIds.has(fileId)) {
      return {
        relativePath: target.relativePath,
        mtimeMs: target.mtimeMs,
        dependencyState: CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED,
        reason: "A source from the Case Timeline snapshot is no longer in the active source set.",
      };
    }
  }
  for (const input of upstreamInputs) {
    if (input.inputKind !== "extraction_record" || !input.fileId || !input.contentHash) continue;
    const previous = snapshotByFileId.get(input.fileId);
    if (!previous) {
      return {
        ...input,
        dependencyState: CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED,
        reason: "Changed source content was found after the Case Timeline was built.",
      };
    }
    if (previous.contentHash && previous.contentHash !== input.contentHash) {
      return {
        ...input,
        dependencyState: CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED,
        reason: "Changed source content was found after the Case Timeline was built.",
      };
    }
  }

  const sourceIndexInput = upstreamInputs.find((input) => input.inputKind === "source_index");
  if (!sourceIndexInput || !sourceIndex || !Array.isArray(sourceIndex.sources)) return null;
  const currentByFileId = sourceIndexSourceMap(sourceIndex);
  for (const current of sourceIndex.sources) {
    const currentFileId = sourceFileId(current);
    if (currentFileId && !activeExtractionFileIds.has(currentFileId)) continue;
    if (currentFileId && !snapshotByFileId.has(currentFileId)) {
      return {
        ...sourceIndexInput,
        dependencyState: CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED,
        reason: "A new source appears in Source Index after the Case Timeline was built.",
      };
    }
  }
  for (const [fileId, previous] of snapshotByFileId) {
    const current = currentByFileId.get(fileId);
    if (!current) {
      return {
        ...sourceIndexInput,
        dependencyState: CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED,
        reason: "A source from the Case Timeline snapshot is missing from current Source Index.",
      };
    }
    if (previous.contentHash && current.contentHash && previous.contentHash !== current.contentHash) {
      return {
        ...sourceIndexInput,
        dependencyState: CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED,
        reason: "Changed source content was found after the Case Timeline was built.",
      };
    }
    if (
      previous.documentType !== current.documentType
      || previous.documentDate !== current.documentDate
      || previous.needsReview !== current.needsReview
    ) {
      return {
        ...sourceIndexInput,
        dependencyState: CASE_TIMELINE_DEPENDENCY_STATES.CHRONOLOGY_REVIEW_NEEDED,
        reason: "Source metadata changed after the Case Timeline was built.",
      };
    }
    if (
      previous.label !== current.label
      || previous.shortLabel !== current.shortLabel
      || previous.labelStatus !== current.labelStatus
      || previous.labelRevision !== current.labelRevision
    ) {
      return {
        ...sourceIndexInput,
        dependencyState: CASE_TIMELINE_DEPENDENCY_STATES.LABEL_REFRESH_NEEDED,
        reason: "Source labels changed after the Case Timeline was rendered.",
      };
    }
  }
  return null;
}

function sourceIndexSourceMap(json) {
  const map = new Map();
  const sources = Array.isArray(json?.sources) ? json.sources : [];
  for (const source of sources) {
    const fileId = sourceFileId(source);
    if (!fileId) continue;
    map.set(fileId, {
      contentHash: sourceContentHash(source),
      documentType: normalizeText(source?.document_type),
      documentDate: normalizeText(source?.document_date),
      needsReview: Boolean(source?.needs_review),
      label: normalizeText(source?.confirmed_label) || normalizeText(source?.display_label) || normalizeText(source?.source_label),
      shortLabel: normalizeText(source?.short_label) || normalizeText(source?.source_short_label),
      labelStatus: normalizeText(source?.label_status),
      labelRevision: source?.label_revision == null ? "" : String(source.label_revision),
    });
  }
  return map;
}

function caseTimelineSnapshotMap(json) {
  const map = new Map();
  const snapshot = Array.isArray(json?.source_snapshot) ? json.source_snapshot : [];
  for (const source of snapshot) {
    const fileId = sourceFileId(source);
    if (!fileId) continue;
    map.set(fileId, {
      contentHash: sourceContentHash(source),
      documentType: normalizeText(source?.document_type),
      documentDate: normalizeText(source?.document_date),
      needsReview: Boolean(source?.needs_review),
      label: normalizeText(source?.source_label) || normalizeText(source?.display_label),
      shortLabel: normalizeText(source?.source_short_label) || normalizeText(source?.short_label),
      labelStatus: normalizeText(source?.label_status),
      labelRevision: source?.label_revision == null ? "" : String(source.label_revision),
    });
  }
  return map;
}

function sourceContentHash(value = {}) {
  if (!value || typeof value !== "object") return "";
  return normalizeText(value.content_hash) || normalizeText(value.sha256) || "";
}

function sourceFileId(source = {}) {
  return normalizeText(source.file_id) || normalizeText(source.fileId) || normalizeText(source.source_id);
}

function normalizeSkillName(skill) {
  return String(skill || "").trim();
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function toMatterRelative(root, filePath) {
  return toPosix(path.relative(root, filePath));
}

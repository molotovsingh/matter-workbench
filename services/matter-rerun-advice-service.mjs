import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { makeHttpError, toPosix } from "../shared/safe-paths.mjs";
import {
  LIST_OF_DATES_JSON_RELATIVE,
  LIST_OF_DATES_MARKDOWN_RELATIVE,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";

export {
  LIST_OF_DATES_JSON_RELATIVE,
  LIST_OF_DATES_MARKDOWN_RELATIVE,
  SOURCE_INDEX_RELATIVE,
};

export async function readRerunAdviceForSkill(skill, root) {
  const normalizedSkill = normalizeSkillName(skill);
  if (normalizedSkill === "/describe_sources") return describeSourcesRerunAdvice(root);
  if (normalizedSkill === "/create_listofdates") return listOfDatesRerunAdvice(root);
  throw makeHttpError(`Rerun advice is not available for ${skill || "unknown skill"}`, 400);
}

export async function describeSourcesRerunAdvice(root) {
  const target = await readArtifact(root, SOURCE_INDEX_RELATIVE, { jsonRequired: true });
  const extractionInputs = await listExtractionRecordInputs(root);
  return buildRerunAdvice({
    root,
    skill: "/describe_sources",
    label: "source descriptors",
    target,
    upstreamInputs: extractionInputs,
    staleDescription: "newer extraction records were found",
    currentDescription: "No newer extraction records were found.",
  });
}

export async function listOfDatesRerunAdvice(root) {
  const markdownTarget = await readArtifact(root, LIST_OF_DATES_MARKDOWN_RELATIVE);
  const jsonTarget = await readArtifact(root, LIST_OF_DATES_JSON_RELATIVE);
  const target = markdownTarget.exists ? {
    ...markdownTarget,
    json: jsonTarget.json,
  } : jsonTarget;
  const extractionInputs = await listExtractionRecordInputs(root);
  const sourceIndexInput = await inputFile(root, SOURCE_INDEX_RELATIVE);
  const sourceIndexJson = sourceIndexInput
    ? await readJsonIfPossible(path.join(root, SOURCE_INDEX_RELATIVE))
    : null;
  return buildRerunAdvice({
    root,
    skill: "/create_listofdates",
    label: "list of dates",
    target,
    upstreamInputs: [
      ...extractionInputs.map((input) => ({ ...input, inputKind: "extraction_record" })),
      ...(sourceIndexInput ? [{ ...sourceIndexInput, inputKind: "source_index" }] : []),
    ],
    staleDescription: "newer extraction records or Source Index changes were found",
    currentDescription: "No newer extraction records or Source Index changes were found.",
    classifyStaleDependency: (newestInput) => classifyListOfDatesDependency(target, newestInput, sourceIndexJson),
  });
}

function buildRerunAdvice({
  root,
  skill,
  label,
  target,
  upstreamInputs,
  staleDescription,
  currentDescription,
  classifyStaleDependency = null,
}) {
  if (!target.exists) {
    return baseRerunAdvice({ skill, label, state: "missing", shouldConfirm: false });
  }
  if (!target.valid) {
    return baseRerunAdvice({
      skill,
      label,
      state: "failed",
      shouldConfirm: false,
      artifactPath: target.relativePath,
    });
  }
  if (!upstreamInputs.length) {
    return baseRerunAdvice({
      skill,
      label,
      state: "missing_upstream",
      shouldConfirm: false,
      artifactPath: target.relativePath,
      lastRunAt: artifactRunTime(target),
      aiRun: normalizeAiRun(target.json?.ai_run),
    });
  }

  const newestInput = upstreamInputs.reduce((newest, input) => (
    !newest || input.mtimeMs > newest.mtimeMs ? input : newest
  ), null);
  const stale = newestInput && newestInput.mtimeMs > target.mtimeMs + 1;
  if (stale) {
    const dependencyState = typeof classifyStaleDependency === "function"
      ? classifyStaleDependency(newestInput)
      : "";
    const labelRefreshOnly = dependencyState === "label_refresh_needed";
    const advice = baseRerunAdvice({
      skill,
      label,
      state: "stale",
      shouldConfirm: labelRefreshOnly,
      artifactPath: target.relativePath,
      lastRunAt: artifactRunTime(target),
      aiRun: normalizeAiRun(target.json?.ai_run),
      reason: labelRefreshOnly
        ? "Only Source Index labels appear newer than this artifact."
        : staleDescription,
      dependencyState,
      newestInputPath: newestInput.relativePath,
      newestInputAt: new Date(newestInput.mtimeMs).toISOString(),
    });
    if (labelRefreshOnly) advice.message = formatLabelRefreshMessage(advice);
    return advice;
  }

  const aiRun = normalizeAiRun(target.json?.ai_run);
  const lastRunAt = artifactRunTime(target);
  const advice = baseRerunAdvice({
    skill,
    label,
    state: "current",
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
    reason,
    dependencyState,
    newestInputPath,
    newestInputAt,
    inputCount,
  };
}

function classifyListOfDatesDependency(target, newestInput = {}, sourceIndex = null) {
  if (newestInput.inputKind !== "source_index") return "chronology_regeneration_needed";
  const snapshot = Array.isArray(target.json?.source_snapshot) ? target.json.source_snapshot : [];
  if (!sourceIndex || !Array.isArray(sourceIndex.sources) || !snapshot.length) return "chronology_review_needed";
  const byFileId = new Map(sourceIndex.sources.map((source) => [source.file_id, normalizeSnapshotSource(source)]));
  const snapshotIds = new Set(snapshot.map((source) => source.file_id).filter(Boolean));
  if (sourceIndex.sources.some((source) => source?.file_id && !snapshotIds.has(source.file_id))) {
    return "chronology_regeneration_needed";
  }
  let compared = 0;
  for (const previous of snapshot) {
    const current = byFileId.get(previous.file_id);
    if (!current) return "chronology_regeneration_needed";
    compared += 1;
    if ((previous.content_hash || "") !== (current.content_hash || "")) {
      return "chronology_regeneration_needed";
    }
    if (
      (previous.document_type || "") !== (current.document_type || "")
      || (previous.document_date || "") !== (current.document_date || "")
      || Boolean(previous.needs_review) !== Boolean(current.needs_review)
    ) {
      return "chronology_review_needed";
    }
  }
  return compared ? "label_refresh_needed" : "chronology_review_needed";
}

function normalizeSnapshotSource(source = {}) {
  return {
    file_id: source.file_id || "",
    content_hash: source.content_hash || source.sha256 || "",
    document_type: source.document_type || "",
    document_date: source.document_date || "",
    needs_review: Boolean(source.needs_review),
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

async function listExtractionRecordInputs(root) {
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
      const fileStat = await stat(filePath);
      inputs.push({
        relativePath: toMatterRelative(root, filePath),
        mtimeMs: fileStat.mtimeMs,
      });
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

function normalizeSkillName(skill) {
  return String(skill || "").trim();
}

function normalizeAiRun(aiRun) {
  if (!aiRun || typeof aiRun !== "object" || Array.isArray(aiRun)) return null;
  const normalized = {};
  for (const key of ["provider", "model", "returnedModel", "returnedProvider"]) {
    const value = normalizeText(aiRun[key]);
    if (value) normalized[key] = value;
  }
  const maxOutputTokens = Number(aiRun.maxOutputTokens);
  if (Number.isInteger(maxOutputTokens) && maxOutputTokens > 0) normalized.maxOutputTokens = maxOutputTokens;
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function toMatterRelative(root, filePath) {
  return toPosix(path.relative(root, filePath));
}

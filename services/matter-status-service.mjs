import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { makeHttpError, toPosix } from "../shared/safe-paths.mjs";

const LIBRARY_DIR = "10_Library";
const SOURCE_INDEX_RELATIVE = `${LIBRARY_DIR}/Source Index.json`;
const LIST_OF_DATES_JSON_RELATIVE = `${LIBRARY_DIR}/List of Dates.json`;
const LIST_OF_DATES_MARKDOWN_RELATIVE = `${LIBRARY_DIR}/List of Dates.md`;

export function createMatterStatusService({ matterStore } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function readMatterStatus(root = matterStore.ensureMatterRoot()) {
    const matterJsonPath = path.join(root, "matter.json");
    const matterJsonPresent = await fileExists(matterJsonPath);
    const intakeFolders = await matterStore.listIntakeFolders(root);
    const intakeRegisters = [];
    const extractionRecords = [];
    const extractionLogs = [];

    for (const folder of intakeFolders) {
      const intakeDir = path.join(root, "00_Inbox", folder.name);
      const registerPath = path.join(intakeDir, "File Register.csv");
      if (await fileExists(registerPath)) intakeRegisters.push(toMatterRelative(root, registerPath));

      const logPath = path.join(intakeDir, "Extraction Log.csv");
      if (await fileExists(logPath)) extractionLogs.push(toMatterRelative(root, logPath));

      const extractedDir = path.join(intakeDir, "_extracted");
      const jsonCount = await countJsonFiles(extractedDir);
      if (jsonCount > 0) {
        extractionRecords.push({
          path: toMatterRelative(root, extractedDir),
          count: jsonCount,
        });
      }
    }

    const sourceIndexPath = path.join(root, SOURCE_INDEX_RELATIVE);
    const sourceIndexPresent = await fileExists(sourceIndexPath);
    const sourceIndex = sourceIndexPresent ? await readJsonIfPossible(sourceIndexPath) : null;
    const sourceRerunAdvice = await describeSourcesRerunAdvice(root);

    const listOfDatesJsonPath = path.join(root, LIST_OF_DATES_JSON_RELATIVE);
    const listOfDatesMarkdownPath = path.join(root, LIST_OF_DATES_MARKDOWN_RELATIVE);
    const listOfDatesJsonPresent = await fileExists(listOfDatesJsonPath);
    const listOfDatesMarkdownPresent = await fileExists(listOfDatesMarkdownPath);
    const listOfDates = listOfDatesJsonPresent ? await readJsonIfPossible(listOfDatesJsonPath) : null;
    const listRerunAdvice = await listOfDatesRerunAdvice(root);

    const stages = [
      stage({
        id: "matter-init",
        slash: "/matter-init",
        label: "Matter Init",
        present: matterJsonPresent && intakeRegisters.length > 0,
        artifacts: [
          ...(matterJsonPresent ? ["matter.json"] : []),
          ...intakeRegisters,
        ],
      }),
      stage({
        id: "extract",
        slash: "/extract",
        label: "Extract",
        present: extractionRecords.length > 0 || extractionLogs.length > 0,
        artifacts: [
          ...extractionRecords.map((record) => `${record.path} (${record.count} record${record.count === 1 ? "" : "s"})`),
          ...extractionLogs,
        ],
      }),
      stage({
        id: "describe-sources",
        slash: "/describe_sources",
        label: "Describe Sources",
        present: sourceIndexPresent,
        artifacts: sourceIndexPresent ? [SOURCE_INDEX_RELATIVE] : [],
        aiRun: normalizeAiRun(sourceIndex?.ai_run),
        rerunAdvice: sourceRerunAdvice,
      }),
      stage({
        id: "create-listofdates",
        slash: "/create_listofdates",
        label: "Create List of Dates",
        present: listOfDatesMarkdownPresent || listOfDatesJsonPresent,
        artifacts: [
          ...(listOfDatesMarkdownPresent ? [LIST_OF_DATES_MARKDOWN_RELATIVE] : []),
          ...(listOfDatesJsonPresent ? [LIST_OF_DATES_JSON_RELATIVE] : []),
        ],
        aiRun: normalizeAiRun(listOfDates?.ai_run),
        metrics: listOfDatesMetrics(listOfDates),
        rerunAdvice: listRerunAdvice,
      }),
    ];

    return {
      matterRoot: root,
      matterName: path.basename(root),
      stages,
    };
  }

  async function readRerunAdvice(skill, root = matterStore.ensureMatterRoot()) {
    const normalizedSkill = normalizeSkillName(skill);
    if (normalizedSkill === "/describe_sources") return describeSourcesRerunAdvice(root);
    if (normalizedSkill === "/create_listofdates") return listOfDatesRerunAdvice(root);
    throw makeHttpError(`Rerun advice is not available for ${skill || "unknown skill"}`, 400);
  }

  return { readMatterStatus, readRerunAdvice };
}

async function describeSourcesRerunAdvice(root) {
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

async function listOfDatesRerunAdvice(root) {
  const markdownTarget = await readArtifact(root, LIST_OF_DATES_MARKDOWN_RELATIVE);
  const jsonTarget = await readArtifact(root, LIST_OF_DATES_JSON_RELATIVE);
  const target = markdownTarget.exists ? {
    ...markdownTarget,
    json: jsonTarget.json,
  } : jsonTarget;
  const extractionInputs = await listExtractionRecordInputs(root);
  const sourceIndexInput = await inputFile(root, SOURCE_INDEX_RELATIVE);
  return buildRerunAdvice({
    root,
    skill: "/create_listofdates",
    label: "list of dates",
    target,
    upstreamInputs: [
      ...extractionInputs,
      ...(sourceIndexInput ? [sourceIndexInput] : []),
    ],
    staleDescription: "newer extraction records or Source Index changes were found",
    currentDescription: "No newer extraction records or Source Index changes were found.",
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
    return baseRerunAdvice({
      skill,
      label,
      state: "stale",
      shouldConfirm: false,
      artifactPath: target.relativePath,
      lastRunAt: artifactRunTime(target),
      aiRun: normalizeAiRun(target.json?.ai_run),
      reason: staleDescription,
      newestInputPath: newestInput.relativePath,
      newestInputAt: new Date(newestInput.mtimeMs).toISOString(),
    });
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

function baseRerunAdvice({
  skill,
  label,
  state,
  shouldConfirm,
  artifactPath = "",
  lastRunAt = "",
  aiRun = null,
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
    provider: aiRun?.returnedProvider || aiRun?.provider || "",
    model: aiRun?.returnedModel || aiRun?.model || "",
    reason,
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

function artifactRunTime(target) {
  return normalizeText(target.json?.generated_at) || target.mtimeIso || "";
}

function normalizeSkillName(skill) {
  return String(skill || "").trim();
}

function stage({ id, slash, label, present, artifacts = [], aiRun = null, metrics = null, rerunAdvice = null }) {
  return {
    id,
    slash,
    label,
    present: Boolean(present),
    state: present ? "present" : "not_run",
    artifacts,
    ...(aiRun ? { aiRun } : {}),
    ...(metrics ? { metrics } : {}),
    ...(rerunAdvice ? { rerunAdvice } : {}),
  };
}

function listOfDatesMetrics(listOfDates) {
  if (!listOfDates || typeof listOfDates !== "object" || Array.isArray(listOfDates)) return null;
  const rows = Number.isInteger(listOfDates.counts?.entries)
    ? listOfDates.counts.entries
    : Array.isArray(listOfDates.entries)
      ? listOfDates.entries.length
      : null;
  if (!Number.isInteger(rows) || rows < 0) return null;
  return { rows };
}

async function fileExists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function countJsonFiles(directoryPath) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json")).length;
  } catch {
    return 0;
  }
}

async function readJsonIfPossible(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
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

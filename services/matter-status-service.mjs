import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AI_RUN_STATUS_FIELDS, normalizeAiRunMetadata } from "../shared/ai-run-metadata.mjs";
import { toPosix } from "../shared/safe-paths.mjs";
import {
  describeSourcesRerunAdvice,
  LIST_OF_DATES_JSON_RELATIVE,
  LIST_OF_DATES_MARKDOWN_RELATIVE,
  readRerunAdviceForSkill,
  SOURCE_INDEX_RELATIVE,
  listOfDatesRerunAdvice,
} from "./matter-rerun-advice-service.mjs";

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
        label: "Source Labels / Document Index",
        present: sourceIndexPresent,
        artifacts: sourceIndexPresent ? [SOURCE_INDEX_RELATIVE] : [],
        aiRun: normalizeAiRunMetadata(sourceIndex?.ai_run, { fields: AI_RUN_STATUS_FIELDS }),
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
        aiRun: normalizeAiRunMetadata(listOfDates?.ai_run, { fields: AI_RUN_STATUS_FIELDS }),
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
    return readRerunAdviceForSkill(skill, root);
  }

  return { readMatterStatus, readRerunAdvice };
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

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function toMatterRelative(root, filePath) {
  return toPosix(path.relative(root, filePath));
}

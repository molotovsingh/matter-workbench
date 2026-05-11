import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { toPosix } from "../shared/safe-paths.mjs";

const LIBRARY_DIR = "10_Library";

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

    const sourceIndexPath = path.join(root, LIBRARY_DIR, "Source Index.json");
    const sourceIndexPresent = await fileExists(sourceIndexPath);
    const sourceIndex = sourceIndexPresent ? await readJsonIfPossible(sourceIndexPath) : null;

    const listOfDatesJsonPath = path.join(root, LIBRARY_DIR, "List of Dates.json");
    const listOfDatesMarkdownPath = path.join(root, LIBRARY_DIR, "List of Dates.md");
    const listOfDatesJsonPresent = await fileExists(listOfDatesJsonPath);
    const listOfDatesMarkdownPresent = await fileExists(listOfDatesMarkdownPath);
    const listOfDates = listOfDatesJsonPresent ? await readJsonIfPossible(listOfDatesJsonPath) : null;

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
        artifacts: sourceIndexPresent ? [`${LIBRARY_DIR}/Source Index.json`] : [],
        aiRun: normalizeAiRun(sourceIndex?.ai_run),
      }),
      stage({
        id: "create-listofdates",
        slash: "/create_listofdates",
        label: "Create List of Dates",
        present: listOfDatesMarkdownPresent || listOfDatesJsonPresent,
        artifacts: [
          ...(listOfDatesMarkdownPresent ? [`${LIBRARY_DIR}/List of Dates.md`] : []),
          ...(listOfDatesJsonPresent ? [`${LIBRARY_DIR}/List of Dates.json`] : []),
        ],
        aiRun: normalizeAiRun(listOfDates?.ai_run),
      }),
    ];

    return {
      matterRoot: root,
      matterName: path.basename(root),
      stages,
    };
  }

  return { readMatterStatus };
}

function stage({ id, slash, label, present, artifacts = [], aiRun = null }) {
  return {
    id,
    slash,
    label,
    present: Boolean(present),
    state: present ? "present" : "not_run",
    artifacts,
    ...(aiRun ? { aiRun } : {}),
  };
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

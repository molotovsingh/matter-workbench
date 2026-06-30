import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AI_RUN_STATUS_FIELDS, normalizeAiRunMetadata } from "../shared/ai-run-metadata.mjs";
import { toPosix } from "../shared/safe-paths.mjs";
import {
  CASE_TIMELINE_JSON_RELATIVE,
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";
import {
  caseTimelineRerunAdvice,
  describeSourcesRerunAdvice,
  readRerunAdviceForSkill,
} from "./matter-rerun-advice-service.mjs";

export function createMatterStatusService({ matterStore, skillRegistryService = null, proceduralPostureDiagnosisService = null } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function readMatterStatus(root = matterStore.ensureMatterRoot()) {
    const displayBySlash = await readDisplayBySlash(skillRegistryService);
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

    const caseTimelineJsonPath = path.join(root, CASE_TIMELINE_JSON_RELATIVE);
    const caseTimelineMarkdownPath = path.join(root, CASE_TIMELINE_MARKDOWN_RELATIVE);
    const caseTimelineJsonPresent = await fileExists(caseTimelineJsonPath);
    const caseTimelineMarkdownPresent = await fileExists(caseTimelineMarkdownPath);
    const caseTimeline = caseTimelineJsonPresent ? await readJsonIfPossible(caseTimelineJsonPath) : null;
    const caseTimelineRerun = await caseTimelineRerunAdvice(root);

    const postureStatus = proceduralPostureDiagnosisService?.readDiagnosisStatus
      ? await proceduralPostureDiagnosisService.readDiagnosisStatus(root)
      : null;

    const stages = [
      stage({
        id: "matter-init",
        slash: "/matter-init",
        display: displayBySlash.get("/matter-init"),
        label: displayBySlash.get("/matter-init")?.action || "Matter Init",
        present: matterJsonPresent && intakeRegisters.length > 0,
        artifacts: [
          ...(matterJsonPresent ? ["matter.json"] : []),
          ...intakeRegisters,
        ],
      }),
      stage({
        id: "extract",
        slash: "/extract",
        display: displayBySlash.get("/extract"),
        label: displayBySlash.get("/extract")?.action || "Extract",
        present: extractionRecords.length > 0 || extractionLogs.length > 0,
        artifacts: [
          ...extractionRecords.map((record) => `${record.path} (${record.count} record${record.count === 1 ? "" : "s"})`),
          ...extractionLogs,
        ],
      }),
      stage({
        id: "describe-sources",
        slash: "/describe_sources",
        display: displayBySlash.get("/describe_sources"),
        label: displayBySlash.get("/describe_sources")?.action || "Source Labels / Document Index",
        present: sourceIndexPresent,
        artifacts: sourceIndexPresent ? [SOURCE_INDEX_RELATIVE] : [],
        aiRun: normalizeAiRunMetadata(sourceIndex?.ai_run, { fields: AI_RUN_STATUS_FIELDS }),
        rerunAdvice: sourceRerunAdvice,
      }),
      stage({
        id: "create-listofdates",
        slash: "/create_listofdates",
        display: displayBySlash.get("/create_listofdates"),
        label: displayBySlash.get("/create_listofdates")?.action || "Build Case Timeline",
        present: caseTimelineMarkdownPresent || caseTimelineJsonPresent,
        artifacts: [
          ...(caseTimelineMarkdownPresent ? [CASE_TIMELINE_MARKDOWN_RELATIVE] : []),
          ...(caseTimelineJsonPresent ? [CASE_TIMELINE_JSON_RELATIVE] : []),
        ],
        aiRun: normalizeAiRunMetadata(caseTimeline?.ai_run, { fields: AI_RUN_STATUS_FIELDS }),
        metrics: caseTimelineMetrics(caseTimeline),
        rerunAdvice: caseTimelineRerun,
      }),
      ...(postureStatus ? [stage({
        id: "procedural-posture-diagnosis",
        slash: "/procedural_posture_diagnosis",
        label: "Diagnose procedural posture",
        present: postureStatus.markdownPresent || postureStatus.jsonPresent,
        artifacts: [
          ...(postureStatus.markdownPresent ? [postureStatus.artifactPath] : []),
          ...(postureStatus.jsonPresent ? [postureStatus.jsonPath] : []),
        ].filter(Boolean),
        metrics: { lawyerToConfirm: postureStatus.lawyerToConfirmCount || 0 },
        rerunAdvice: postureDiagnosisRerunAdvice(postureStatus),
      })] : []),
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

function stage({ id, slash, label, display = null, present, artifacts = [], aiRun = null, metrics = null, rerunAdvice = null }) {
  return {
    id,
    slash,
    label,
    ...(display ? { display } : {}),
    present: Boolean(present),
    state: present ? "present" : "not_run",
    artifacts,
    ...(aiRun ? { aiRun } : {}),
    ...(metrics ? { metrics } : {}),
    ...(rerunAdvice ? { rerunAdvice } : {}),
  };
}

async function readDisplayBySlash(skillRegistryService) {
  if (!skillRegistryService?.listSkills) return new Map();
  try {
    const skills = await skillRegistryService.listSkills();
    return new Map((Array.isArray(skills) ? skills : [])
      .filter((skill) => skill?.slash && skill.display)
      .map((skill) => [skill.slash, skill.display]));
  } catch {
    return new Map();
  }
}

function caseTimelineMetrics(caseTimeline) {
  if (!caseTimeline || typeof caseTimeline !== "object" || Array.isArray(caseTimeline)) return null;
  const rows = Number.isInteger(caseTimeline.counts?.entries)
    ? caseTimeline.counts.entries
    : Array.isArray(caseTimeline.entries)
      ? caseTimeline.entries.length
      : null;
  if (!Number.isInteger(rows) || rows < 0) return null;
  return { rows };
}

function postureDiagnosisRerunAdvice(status = {}) {
  const state = status.state === "missing"
    ? "missing"
    : status.state === "stale" || status.state === "needs_reconfirmation"
      ? "stale"
      : status.state === "blocked"
        ? "missing_upstream"
        : "current";
  return {
    skill: "/procedural_posture_diagnosis",
    label: "procedural posture diagnosis",
    state,
    shouldConfirm: state !== "current",
    artifactPath: status.artifactPath || "",
    lastRunAt: status.diagnosisUpdatedAt || "",
    reason: state === "current"
      ? "Procedural posture diagnosis is current against Case Timeline and Matter Story."
      : state === "stale"
        ? "Case Timeline or Matter Story changed after the procedural posture diagnosis."
        : status.blockedReasons?.join(" ") || "Case Timeline and Matter Story are required before diagnosis.",
    newestInputAt: status.caseTimelineUpdatedAt || status.matterStoryUpdatedAt || "",
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

function toMatterRelative(root, filePath) {
  return toPosix(path.relative(root, filePath));
}

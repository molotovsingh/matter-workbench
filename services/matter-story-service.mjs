import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { LEGAL_WORKBENCH_POLICY_PROMPT_VERSION } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import {
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  CASE_TIMELINE_READ_MODEL_RELATIVE_CANDIDATES,
  isCaseTimelineArtifactPath,
} from "../shared/matter-artifacts.mjs";
import { makeHttpError, resolveRelativeInside } from "../shared/safe-paths.mjs";
import { buildConfigurableSkillMatterContextPacket, summarizeMatterContext } from "./configurable-skill-context.mjs";
import { createDefaultRunProvider } from "./configurable-skill-providers.mjs";
import { runRecordedStage } from "./skill-stage-service.mjs";

export const DISPUTE_STORY_SKILL_SLASH = "/the_story";
export const DISPUTE_STORY_OUTPUT_RELATIVE = "20_Workshop/The Story.md";
export const DISPUTE_STORY_BASIS_RELATIVE = CASE_TIMELINE_MARKDOWN_RELATIVE;
export const MATTER_WORKBENCH_AUTHOR = "MW";
export const MATTER_WORKBENCH_STORY_SOURCE_TYPE = "matter_workbench_story";
const MATTER_STORY_SCHEMA_VERSION = "matter-story/v1";
const MAX_BRIEF_DESCRIPTION_CHARS = 5000;
const MAX_NATIVE_STORY_MARKDOWN_CHARS = 24_000;
const FILE_TIME_TOLERANCE_MS = 1;
const DISPUTE_STORY_JSON_RELATIVE = "20_Workshop/The Story.json";

const NATIVE_DISPUTE_STORY_SKILL = Object.freeze({
  id: "builtin_the_story",
  title: "The Story",
  slash: DISPUTE_STORY_SKILL_SLASH,
  description: "Write a short Matter Workbench story for the matter overview from the current Case Timeline.",
  outputArtifact: DISPUTE_STORY_OUTPUT_RELATIVE,
  sourceBacked: "required",
  promptConfig: Object.freeze({
    prompt: [
      "Write a concise Matter Workbench story for the selected matter.",
      "Use the current Case Timeline as the primary spine and do not introduce new facts that are not supported by the supplied matter context.",
      "Source Index and matter metadata may clarify names, roles, labels, and procedural context only.",
      "Structure the Markdown in exactly this order: At a glance; What this matter is about; Key dispute; Procedural posture; Main risks and missing facts.",
      "Each section should be one short paragraph with no more than two sentences, so the full story remains readable on the matter overview.",
      "Use plain legal-workbench language for a lawyer reviewing the matter internally.",
      "Do not call the output final, approved, court-ready, or ready to send.",
      "End with a short Internal source handles section containing any raw FILE-NNNN citations used for audit.",
    ].join("\n"),
    citationPolicy: "Use readable source labels in the prose. Keep raw FILE-NNNN pX.bY handles only in an Internal source handles section.",
  }),
});

export function createMatterStoryService({
  matterStore,
  configurableSkillsService,
  nativeRunProvider = null,
  env = process.env,
  fetchImpl = fetch,
  endpoint,
  now = () => new Date(),
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!configurableSkillsService) throw new Error("configurableSkillsService is required");

  async function readDisputeStoryStatus(root = matterStore.ensureMatterRoot()) {
    const matterJson = await readMatterJson(root);
    const storyStat = await fileStatIfFile(path.join(root, DISPUTE_STORY_OUTPUT_RELATIVE));
    const caseTimelineStat = await newestFileStat(CASE_TIMELINE_READ_MODEL_RELATIVE_CANDIDATES.map((relative) => path.join(root, relative)));
    const briefDescriptionSource = matterJson.brief_description_source || null;
    return {
      schema_version: MATTER_STORY_SCHEMA_VERSION,
      hasActiveSkill: await hasActiveDisputeStorySkill(),
      storyMarkdownPresent: Boolean(storyStat),
      storyStale: Boolean(storyStat && caseTimelineStat && caseTimelineStat.mtimeMs > storyStat.mtimeMs + FILE_TIME_TOLERANCE_MS),
      briefDescriptionPresent: Boolean(String(matterJson.brief_description || "").trim()),
      briefDescriptionManagedByMatterWorkbench: isMatterWorkbenchStorySource(briefDescriptionSource),
      originalIntakeNotePresent: Boolean(String(matterJson.original_intake_note || "").trim()),
      artifactPath: DISPUTE_STORY_OUTPUT_RELATIVE,
      storyUpdatedAt: storyStat ? storyStat.mtime.toISOString() : "",
      listOfDatesUpdatedAt: caseTimelineStat ? caseTimelineStat.mtime.toISOString() : "",
      briefDescriptionSource,
    };
  }

  async function runDisputeStory({
    matterName = "",
    overwrite = false,
    matterRootOverride = "",
    matterRecordOverride = null,
    matterContextPacketOverride = null,
    artifactExistsOverride = null,
    artifactWriter = null,
    matterJsonOverride = null,
    matterJsonWriter = null,
    storyMarkdownReader = null,
    stageRecorder = null,
  } = {}) {
    const matterRoot = await matterRootForName({ matterName, matterRootOverride });
    const skillRun = await runConfiguredOrNativeStorySkill({
      matterName,
      matterRoot,
      overwrite,
      matterRootOverride,
      matterRecordOverride,
      matterContextPacketOverride,
      artifactExistsOverride,
      artifactWriter,
      stageRecorder,
    });
    const artifactPath = skillRun.outputPaths?.markdown || skillRun.artifactPath || DISPUTE_STORY_OUTPUT_RELATIVE;
    const markdown = typeof skillRun.markdown === "string" && skillRun.markdown.trim()
      ? skillRun.markdown
      : await readStoryMarkdownForStory({ matterRoot, artifactPath, storyMarkdownReader });
    const { update, matterJsonPersistence } = await runRecordedStage(stageRecorder, {
      id: "sync_matter_summary",
      label: "Sync Matter Story summary to matter metadata",
    }, () => updateBriefDescriptionForStory({
      matterRoot,
      markdown,
      artifactPath,
      matterJsonOverride,
      matterJsonWriter,
      overwrite,
      now,
    }), {
      successPatch: ({ update: summaryUpdate } = {}) => ({
        summary: summaryUpdate?.state || "matter_summary_checked",
        salvageable: true,
      }),
    });

    return {
      schema_version: MATTER_STORY_SCHEMA_VERSION,
      ...update,
      slash: DISPUTE_STORY_SKILL_SLASH,
      artifactPath,
      skillRunState: skillRun.state,
      runId: skillRun.runId,
      runRecord: skillRun.runRecord,
      ...(skillRun.artifactPersistence ? { artifactPersistence: skillRun.artifactPersistence } : {}),
      ...(matterJsonPersistence ? { matterJsonPersistence } : {}),
    };
  }

  async function hasActiveDisputeStorySkill() {
    return true;
  }

  async function hasConfiguredDisputeStorySkill() {
    const payload = await configurableSkillsService.listSkills();
    return Array.isArray(payload?.skills)
      && payload.skills.some((skill) => (
        skill?.slash === DISPUTE_STORY_SKILL_SLASH
        && (skill.status || "active") === "active"
      ));
  }

  async function runConfiguredOrNativeStorySkill({
    matterName,
    matterRoot,
    overwrite,
    matterRootOverride,
    matterRecordOverride,
    matterContextPacketOverride,
    artifactExistsOverride,
    artifactWriter,
    stageRecorder = null,
  }) {
    if (await hasConfiguredDisputeStorySkill()) {
      const skillRunRequest = {
        slash: DISPUTE_STORY_SKILL_SLASH,
        overwrite,
        matterName,
      };
      if (matterRootOverride) skillRunRequest.matterRootOverride = matterRootOverride;
      if (matterRecordOverride) skillRunRequest.matterRecordOverride = matterRecordOverride;
      if (matterContextPacketOverride) skillRunRequest.matterContextPacketOverride = matterContextPacketOverride;
      if (artifactExistsOverride) skillRunRequest.artifactExistsOverride = artifactExistsOverride;
      if (artifactWriter) skillRunRequest.artifactWriter = artifactWriter;
      return configurableSkillsService.runSkill(skillRunRequest);
    }

    return runNativeDisputeStorySkill({
      matterRoot,
      matterName,
      overwrite,
      matterContextPacketOverride,
      artifactExistsOverride,
      artifactWriter,
      stageRecorder,
    });
  }

  async function runNativeDisputeStorySkill({
    matterRoot,
    matterName,
    overwrite,
    matterContextPacketOverride,
    artifactExistsOverride,
    artifactWriter,
    stageRecorder = null,
  }) {
    const outputPaths = {
      markdown: DISPUTE_STORY_OUTPUT_RELATIVE,
      json: DISPUTE_STORY_JSON_RELATIVE,
    };
    const artifactExists = typeof artifactExistsOverride === "function"
      ? await artifactExistsOverride(outputPaths.markdown)
      : Boolean(await fileStatIfFile(resolveRelativeInside(matterRoot, outputPaths.markdown)));
    if (artifactExists && !overwrite) {
      return {
        schema_version: "configurable-skill-run/v1",
        state: "requires_overwrite",
        skill: nativeStoryPublicSkill(),
        artifactPath: outputPaths.markdown,
        outputPaths,
      };
    }

    const { packet, matterContext } = await runRecordedStage(stageRecorder, {
      id: "build_packet",
      label: "Build Matter Story evidence packet",
    }, async () => {
      const builtPacket = matterContextPacketOverride || await buildNativeStoryMatterContextPacket(matterRoot);
      const summarized = summarizeMatterContext(builtPacket);
      assertMatterStoryHasCaseTimeline(summarized);
      return { packet: builtPacket, matterContext: summarized };
    }, {
      successPatch: () => ({ salvageable: true }),
    });
    const policy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, { env });
    const providerConfig = resolveProviderConfig(policy, { endpoint });
    if (!providerConfig.model) {
      throw makeHttpError(
        "Matter Story is not configured.",
        409,
        "matter_story.model_not_configured",
      );
    }
    const provider = nativeRunProvider || createDefaultRunProvider({ providerConfig, env, fetchImpl });
    const aiRun = {
      provider: providerConfig.provider,
      model: providerConfig.model,
      task: AI_TASKS.SOURCE_BACKED_ANALYSIS,
      policyPromptVersion: LEGAL_WORKBENCH_POLICY_PROMPT_VERSION,
    };
    const runId = `matter_story_${randomUUID()}`;
    const markdown = await runRecordedStage(stageRecorder, {
      id: "generate",
      label: "Generate Matter Story",
      provider: providerConfig.provider,
      model: providerConfig.model,
    }, async () => boundedNativeStoryMarkdown(await provider({
      skill: NATIVE_DISPUTE_STORY_SKILL,
      matterContext,
      providerConfig,
    })), {
      successPatch: () => ({ aiRun, salvageable: false }),
    });
    const metadata = {
      schema_version: "matter-story-run/v1",
      skill: nativeStoryPublicSkill(),
      matter: packet.matter || {},
      outputPath: outputPaths.markdown,
      generatedAt: now().toISOString(),
      aiRun,
      warnings: Array.isArray(packet.warnings) ? packet.warnings.slice(0, 5) : [],
    };
    const artifactPersistence = await runRecordedStage(stageRecorder, {
      id: "persist",
      label: "Persist Matter Story artifacts",
    }, async () => (typeof artifactWriter === "function"
      ? artifactWriter({ outputPaths, markdown, metadata, runId })
      : writeNativeStoryArtifacts({ matterRoot, outputPaths, markdown, metadata, runId })), {
      successPatch: () => ({ summary: outputPaths.markdown, salvageable: true }),
    });

    return {
      ...metadata,
      state: "written",
      markdown,
      outputPaths,
      artifactPath: outputPaths.markdown,
      runId,
      ...(artifactPersistence ? { artifactPersistence } : {}),
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
    hasActiveDisputeStorySkill,
    readDisputeStoryStatus,
    runDisputeStory,
  };
}

async function buildNativeStoryMatterContextPacket(matterRoot) {
  if (String(matterRoot || "").startsWith("postgres:")) {
    throw makeHttpError(
      "Matter context is not available for the Matter Story workflow. Ask the operator to check the workspace setup.",
      409,
      "matter_story.context_required",
    );
  }
  return buildConfigurableSkillMatterContextPacket(matterRoot);
}

function assertMatterStoryHasCaseTimeline(matterContext = {}) {
  const artifacts = Array.isArray(matterContext.library_artifacts) ? matterContext.library_artifacts : [];
  const hasCaseTimeline = artifacts.some((artifact) => (
    artifact?.kind === "list_of_dates"
    || artifact?.kind === "list_of_dates_markdown"
    || isCaseTimelineArtifactPath(artifact?.path)
  ));
  if (hasCaseTimeline) return;
  throw makeHttpError(
    "Build the Case Timeline before writing the Matter Story.",
    409,
    "matter_story.list_of_dates_required",
  );
}

function nativeStoryPublicSkill() {
  return {
    id: NATIVE_DISPUTE_STORY_SKILL.id,
    slash: NATIVE_DISPUTE_STORY_SKILL.slash,
    title: NATIVE_DISPUTE_STORY_SKILL.title,
    description: NATIVE_DISPUTE_STORY_SKILL.description,
    outputArtifact: NATIVE_DISPUTE_STORY_SKILL.outputArtifact,
    sourceBacked: NATIVE_DISPUTE_STORY_SKILL.sourceBacked,
    configurable: false,
  };
}

function boundedNativeStoryMarkdown(value) {
  const text = String(value || "").trim();
  if (!text) {
    throw makeHttpError(
      "Matter Story returned an empty result.",
      502,
      "matter_story.empty_output",
    );
  }
  if (text.length <= MAX_NATIVE_STORY_MARKDOWN_CHARS) return text;
  return `${text.slice(0, MAX_NATIVE_STORY_MARKDOWN_CHARS).trimEnd()}\n\n_Trimmed for length._`;
}

async function writeNativeStoryArtifacts({ matterRoot, outputPaths, markdown, metadata, runId }) {
  const markdownPath = resolveRelativeInside(matterRoot, outputPaths.markdown);
  const jsonPath = resolveRelativeInside(matterRoot, outputPaths.json);
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFileAtomic(markdownPath, `${markdown}\n`);
  await writeFileAtomic(jsonPath, `${JSON.stringify({ ...metadata, runId, markdown }, null, 2)}\n`);
  return [
    { relativePath: outputPaths.markdown },
    { relativePath: outputPaths.json },
  ];
}

export async function updateBriefDescriptionFromStory({
  matterRoot,
  markdown,
  artifactPath = DISPUTE_STORY_OUTPUT_RELATIVE,
  overwrite = false,
  now = () => new Date(),
} = {}) {
  if (!matterRoot) throw new Error("matterRoot is required");
  const matterJsonPath = path.join(matterRoot, "matter.json");
  const matterJson = await readMatterJson(matterRoot);
  const { result, nextMatterJson } = buildBriefDescriptionMatterJsonUpdate({
    matterJson,
    markdown,
    artifactPath,
    overwrite,
    now,
  });
  if (nextMatterJson) {
    await writeFileAtomic(matterJsonPath, `${JSON.stringify(nextMatterJson, null, 2)}\n`);
  }
  return result;
}

export function buildBriefDescriptionMatterJsonUpdate({
  matterJson = {},
  markdown = "",
  artifactPath = DISPUTE_STORY_OUTPUT_RELATIVE,
  overwrite = false,
  now = () => new Date(),
} = {}) {
  const currentDescription = String(matterJson.brief_description || "").trim();
  const currentSource = matterJson.brief_description_source || null;
  const currentIsMatterWorkbenchStory = isMatterWorkbenchStorySource(currentSource);
  if (currentDescription && currentIsMatterWorkbenchStory && !overwrite) {
    return {
      result: {
        state: "skipped_current_mw_story",
        description: currentDescription,
        reason: "Matter Workbench story is already current.",
        author: MATTER_WORKBENCH_AUTHOR,
        basedOn: "Current Case Timeline",
        source: normalizeMatterWorkbenchStorySource(currentSource, { artifactPath, now }),
      },
      nextMatterJson: null,
    };
  }

  const description = extractBriefDescriptionFromStoryMarkdown(markdown);
  if (!description) {
    return {
      result: {
        state: "skipped_empty_story",
        description: "",
        reason: "The Story output did not contain a usable dispute description.",
      },
      nextMatterJson: null,
    };
  }

  const originalIntakeNote = preservedOriginalIntakeNote({ matterJson, currentDescription, currentIsMatterWorkbenchStory, description });
  const source = matterWorkbenchStorySource({ artifactPath, now });
  const nextMatterJson = {
    ...matterJson,
    brief_description: description,
    brief_description_source: source,
  };
  if (originalIntakeNote) nextMatterJson.original_intake_note = originalIntakeNote;

  return {
    result: {
      state: "updated",
      description,
      author: MATTER_WORKBENCH_AUTHOR,
      basedOn: "Current Case Timeline",
      originalIntakeNote,
      source,
    },
    nextMatterJson,
  };
}

export function matterWorkbenchStorySource({ artifactPath = DISPUTE_STORY_OUTPUT_RELATIVE, now = () => new Date() } = {}) {
  return {
    type: MATTER_WORKBENCH_STORY_SOURCE_TYPE,
    author: MATTER_WORKBENCH_AUTHOR,
    slash: DISPUTE_STORY_SKILL_SLASH,
    artifact: artifactPath,
    based_on: "Current Case Timeline",
    basis_artifact: DISPUTE_STORY_BASIS_RELATIVE,
    updated_at: now().toISOString(),
  };
}

export function isMatterWorkbenchStorySource(source = {}) {
  if (!source || typeof source !== "object") return false;
  const author = String(source.author || "").trim().toUpperCase();
  const type = String(source.type || "").trim();
  const slash = String(source.slash || "").trim();
  return author === MATTER_WORKBENCH_AUTHOR
    || type === MATTER_WORKBENCH_STORY_SOURCE_TYPE
    || (slash === DISPUTE_STORY_SKILL_SLASH && (type === "custom_skill" || type === "matter_workbench"));
}

function normalizeMatterWorkbenchStorySource(source, { artifactPath, now } = {}) {
  return isMatterWorkbenchStorySource(source)
    ? {
        ...matterWorkbenchStorySource({ artifactPath: source.artifact || artifactPath, now }),
        ...source,
        author: MATTER_WORKBENCH_AUTHOR,
      }
    : matterWorkbenchStorySource({ artifactPath, now });
}

function preservedOriginalIntakeNote({ matterJson = {}, currentDescription = "", currentIsMatterWorkbenchStory = false, description = "" } = {}) {
  const existing = String(matterJson.original_intake_note || "").trim();
  if (existing) return existing;
  if (!currentDescription || currentIsMatterWorkbenchStory) return "";
  if (currentDescription === description) return "";
  return currentDescription;
}

export function extractBriefDescriptionFromStoryMarkdown(markdown = "") {
  const lines = String(markdown || "").split(/\r?\n/);
  const paragraphs = [];
  let current = [];
  let currentHeading = "";
  let stoppedAtNonStorySection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushCurrent();
      continue;
    }
    if (isStopSectionHeading(line)) {
      flushCurrent();
      stoppedAtNonStorySection = true;
      break;
    }
    if (line.startsWith("#")) {
      const heading = normalizeHeading(line);
      if (!heading || isTopStoryHeading(heading)) continue;
      flushCurrent();
      currentHeading = heading;
      continue;
    }
    if (isTechnicalStoryLine(line)) continue;
    current.push(stripMarkdown(line));
  }
  if (!stoppedAtNonStorySection) flushCurrent();
  else current = [];

  return truncateDescription(
    paragraphs
      .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n"),
  );

  function flushCurrent() {
    if (!current.length) return;
    const body = current.join(" ").trim();
    paragraphs.push(currentHeading ? `${currentHeading}\n${body}` : body);
    current = [];
    currentHeading = "";
  }
}

function isStopSectionHeading(line) {
  if (!line.startsWith("#")) return false;
  const heading = normalizeHeading(line).toLowerCase();
  return /^(sources?|citations?|source support|source handles|internal audit.*|audit|metadata|run receipt|technical notes?|provider details?)$/.test(heading)
    || /^(limits?|limitations?)$/.test(heading);
}

function normalizeHeading(line) {
  return stripMarkdown(String(line || "").replace(/^#+\s*/, "")).replace(/:$/, "").trim();
}

function isTopStoryHeading(heading) {
  return /^(the story|matter story|dispute story)$/i.test(heading);
}

function isTechnicalStoryLine(line) {
  if (/^[-*]\s*\[[ x]\]/i.test(line)) return true;
  if (/^\|.*\|$/.test(line)) return true;
  if (/^[-:| ]+$/.test(line)) return true;
  if (/\bFILE-\d{4,}\b/i.test(line)) return true;
  if (/^(sources?|citations?|limits?|limitations?|mode|ai run|generated by|author|based on|updated|warnings?)\s*:/i.test(line)) return true;
  return false;
}

function stripMarkdown(line) {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function truncateDescription(text) {
  if (text.length <= MAX_BRIEF_DESCRIPTION_CHARS) return text;
  const sliced = text.slice(0, MAX_BRIEF_DESCRIPTION_CHARS);
  const boundary = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf("\n\n"), sliced.lastIndexOf(" "));
  return `${sliced.slice(0, boundary > 600 ? boundary + 1 : MAX_BRIEF_DESCRIPTION_CHARS).trim()}…`;
}

async function updateBriefDescriptionForStory({
  matterRoot,
  markdown,
  artifactPath,
  matterJsonOverride,
  matterJsonWriter,
  overwrite = false,
  now,
} = {}) {
  if (matterJsonOverride || typeof matterJsonWriter === "function") {
    const { result, nextMatterJson } = buildBriefDescriptionMatterJsonUpdate({
      matterJson: matterJsonOverride || {},
      markdown,
      artifactPath,
      overwrite,
      now,
    });
    const matterJsonPersistence = nextMatterJson && typeof matterJsonWriter === "function"
      ? await matterJsonWriter({ matterJson: nextMatterJson, result, artifactPath })
      : null;
    return { update: result, matterJsonPersistence };
  }
  return {
    update: await updateBriefDescriptionFromStory({
      matterRoot,
      markdown,
      artifactPath,
      overwrite,
      now,
    }),
    matterJsonPersistence: null,
  };
}

async function readStoryMarkdownForStory({ matterRoot, artifactPath, storyMarkdownReader } = {}) {
  if (typeof storyMarkdownReader === "function") {
    try {
      return await storyMarkdownReader(artifactPath);
    } catch {
      return "";
    }
  }
  return readStoryMarkdown(matterRoot, artifactPath);
}

async function readStoryMarkdown(matterRoot, artifactPath) {
  try {
    return await readFile(path.join(matterRoot, artifactPath), "utf8");
  } catch {
    return "";
  }
}

async function readMatterJson(matterRoot) {
  try {
    return JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  } catch {
    return {};
  }
}

async function fileStatIfFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() ? fileStat : null;
  } catch {
    return null;
  }
}

async function newestFileStat(filePaths = []) {
  const stats = (await Promise.all(filePaths.map(fileStatIfFile))).filter(Boolean);
  return stats.reduce((newest, fileStat) => (
    !newest || fileStat.mtimeMs > newest.mtimeMs ? fileStat : newest
  ), null);
}

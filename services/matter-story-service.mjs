import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../shared/atomic-file.mjs";

export const DISPUTE_STORY_SKILL_SLASH = "/the_story";
export const DISPUTE_STORY_OUTPUT_RELATIVE = "20_Workshop/The Story.md";
const MATTER_STORY_SCHEMA_VERSION = "matter-story/v1";
const MAX_BRIEF_DESCRIPTION_CHARS = 1200;

export function createMatterStoryService({
  matterStore,
  configurableSkillsService,
  now = () => new Date(),
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!configurableSkillsService) throw new Error("configurableSkillsService is required");

  async function readDisputeStoryStatus(root = matterStore.ensureMatterRoot()) {
    const matterJson = await readMatterJson(root);
    return {
      schema_version: MATTER_STORY_SCHEMA_VERSION,
      hasActiveSkill: await hasActiveDisputeStorySkill(),
      storyMarkdownPresent: await fileExists(path.join(root, DISPUTE_STORY_OUTPUT_RELATIVE)),
      briefDescriptionPresent: Boolean(String(matterJson.brief_description || "").trim()),
      artifactPath: DISPUTE_STORY_OUTPUT_RELATIVE,
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
  } = {}) {
    const matterRoot = await matterRootForName({ matterName, matterRootOverride });
    if (!await hasActiveDisputeStorySkill()) {
      return {
        schema_version: MATTER_STORY_SCHEMA_VERSION,
        state: "skipped_missing_skill",
        slash: DISPUTE_STORY_SKILL_SLASH,
        artifactPath: DISPUTE_STORY_OUTPUT_RELATIVE,
      };
    }

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
    const skillRun = await configurableSkillsService.runSkill(skillRunRequest);
    const artifactPath = skillRun.outputPaths?.markdown || skillRun.artifactPath || DISPUTE_STORY_OUTPUT_RELATIVE;
    const markdown = typeof skillRun.markdown === "string" && skillRun.markdown.trim()
      ? skillRun.markdown
      : await readStoryMarkdownForStory({ matterRoot, artifactPath, storyMarkdownReader });
    const { update, matterJsonPersistence } = await updateBriefDescriptionForStory({
      matterRoot,
      markdown,
      artifactPath,
      matterJsonOverride,
      matterJsonWriter,
      now,
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
    const payload = await configurableSkillsService.listSkills();
    return Array.isArray(payload?.skills)
      && payload.skills.some((skill) => (
        skill?.slash === DISPUTE_STORY_SKILL_SLASH
        && (skill.status || "active") === "active"
      ));
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
  if (currentDescription && !overwrite) {
    return {
      result: {
        state: "skipped_nonblank",
        description: currentDescription,
        reason: "Matter description already exists.",
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

  return {
    result: {
      state: "updated",
      description,
    },
    nextMatterJson: {
      ...matterJson,
      brief_description: description,
      brief_description_source: {
        type: "custom_skill",
        slash: DISPUTE_STORY_SKILL_SLASH,
        artifact: artifactPath,
        updated_at: now().toISOString(),
      },
    },
  };
}

export function extractBriefDescriptionFromStoryMarkdown(markdown = "") {
  const lines = String(markdown || "").split(/\r?\n/);
  const paragraphs = [];
  let current = [];
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
    if (line.startsWith("#")) continue;
    if (isTechnicalStoryLine(line)) continue;
    current.push(stripMarkdown(line));
  }
  if (!stoppedAtNonStorySection) flushCurrent();
  else current = [];

  return truncateDescription(
    paragraphs
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n"),
  );

  function flushCurrent() {
    if (!current.length) return;
    paragraphs.push(current.join(" "));
    current = [];
  }
}

function isStopSectionHeading(line) {
  if (!line.startsWith("#")) return false;
  return /\b(sources?|citations?|limits?|limitations?|gaps?|notes?|audit|metadata)\b/i.test(line);
}

function isTechnicalStoryLine(line) {
  if (/^[-*]\s*\[[ x]\]/i.test(line)) return true;
  if (/^\|.*\|$/.test(line)) return true;
  if (/^[-:| ]+$/.test(line)) return true;
  if (/\bFILE-\d{4,}\b/i.test(line)) return true;
  if (/^(sources?|citations?|limits?|limitations?|mode|ai run|generated by|warnings?)\s*:/i.test(line)) return true;
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
  now,
} = {}) {
  if (matterJsonOverride || typeof matterJsonWriter === "function") {
    const { result, nextMatterJson } = buildBriefDescriptionMatterJsonUpdate({
      matterJson: matterJsonOverride || {},
      markdown,
      artifactPath,
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

async function fileExists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { normalizeArtifactPath } from "./configurable-skill-definition.mjs";
import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { resolveRelativeInside } from "../shared/safe-paths.mjs";

export function resolveConfigurableSkillRunArtifacts({ matterRoot, skill } = {}) {
  if (!matterRoot) throw new Error("matterRoot is required");
  if (!skill) throw new Error("skill is required");
  const markdown = normalizeArtifactPath(skill.outputArtifact, skill.targetLane);
  const json = markdown.replace(/\.md$/i, ".json");
  return {
    outputPaths: {
      markdown,
      json,
    },
    filePaths: {
      markdown: resolveRelativeInside(matterRoot, markdown),
      json: resolveRelativeInside(matterRoot, json),
    },
  };
}

export async function writeConfigurableSkillRunArtifacts({
  filePaths,
  markdown,
  metadata,
  runId,
} = {}) {
  if (!filePaths?.markdown || !filePaths?.json) throw new Error("filePaths are required");
  await mkdir(path.dirname(filePaths.markdown), { recursive: true });
  await writeFileAtomic(filePaths.markdown, `${String(markdown || "")}\n`);
  await writeFileAtomic(filePaths.json, `${JSON.stringify({
    ...metadata,
    runId,
    markdown: String(markdown || ""),
  }, null, 2)}\n`);
}

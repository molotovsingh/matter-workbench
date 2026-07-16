import { mkdir, readFile, readdir, stat } from "node:fs/promises";
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

export async function listLocalConfigurableSkillOutputPaths({ matterRoot } = {}) {
  if (!matterRoot) return [];
  const outputPaths = new Set();
  for (const lane of ["10_Library", "20_Workshop"]) {
    for (const sidecarPath of await listJsonFiles(path.join(matterRoot, lane))) {
      let sidecar;
      try {
        sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
      } catch {
        continue;
      }
      if (sidecar?.schema_version !== "configurable-skill-run/v1") continue;
      const outputPath = normalizeRecordedOutputPath(sidecar.outputPath);
      if (!outputPath || outputPath.replace(/\.md$/i, ".json") !== relativePath(matterRoot, sidecarPath)) continue;
      try {
        if ((await stat(resolveRelativeInside(matterRoot, outputPath))).isFile()) outputPaths.add(outputPath);
      } catch {
        // A missing output is not a current artifact to mark for review.
      }
    }
  }
  return [...outputPaths].sort();
}

async function listJsonFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listJsonFiles(entryPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) files.push(entryPath);
  }
  return files;
}

function normalizeRecordedOutputPath(value = "") {
  const outputPath = String(value || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!/^(10_Library|20_Workshop)\//.test(outputPath) || !/\.md$/i.test(outputPath)) return "";
  return outputPath;
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

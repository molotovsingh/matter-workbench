import fs from "fs";
import path from "path";

const MAX_RESULTS = 20;
const SNIPPET_LENGTH = 200;

const SKIP_DIRS = new Set(["Originals"]);

export function createMatterSearchService({ matterStore } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function search({ query, matterRoot } = {}) {
    if (!query || typeof query !== "string") {
      throw Object.assign(new Error("query is required"), { statusCode: 400 });
    }

    const root = matterRoot || matterStore.ensureMatterRoot();
    const results = [];
    const lowerQuery = query.toLowerCase();

    await searchDirectory(root, "", lowerQuery, results);

    return {
      query,
      totalResults: results.length,
      results: results.slice(0, MAX_RESULTS),
    };
  }

  async function searchDirectory(dir, relativeDir, lowerQuery, results) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue;
        await searchDirectory(fullPath, relPath, lowerQuery, results);
        continue;
      }

      if (results.length >= MAX_RESULTS) return;

      if (shouldSkipFile(entry.name)) continue;

      try {
        const content = fs.readFileSync(fullPath, "utf8");
        const lowerContent = content.toLowerCase();
        const index = lowerContent.indexOf(lowerQuery);
        if (index === -1) continue;

        const start = Math.max(0, index - SNIPPET_LENGTH / 2);
        const end = Math.min(content.length, index + lowerQuery.length + SNIPPET_LENGTH / 2);
        const snippet = content.slice(start, end).replace(/\n+/g, " ").trim();
        const highlighted = snippet.replace(
          new RegExp(escapeRegex(lowerQuery), "gi"),
          (match) => `**${match}**`,
        );

        results.push({
          path: relPath,
          snippet: highlighted,
          line: content.slice(0, index).split("\n").length,
        });
      } catch {
        // skip unreadable files
      }
    }
  }

  return { search };
}

function shouldSkipDirectory(name) {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

function shouldSkipFile(filename) {
  const skipExtensions = [
    ".png", ".jpg", ".jpeg", ".gif", ".pdf",
    ".docx", ".xlsx", ".eml", ".zip",
    ".py", ".sh", ".js", ".mjs", ".bat", ".cmd",
  ];
  const ext = path.extname(filename).toLowerCase();
  return skipExtensions.includes(ext);
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

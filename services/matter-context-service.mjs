import fs from "node:fs";
import path from "node:path";

const MAX_CONTEXT_CHARS = 64000;
const MAX_LIBRARY_RECORDS = 20;

export function createMatterContextService({ matterStore } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function buildMatterContext(matterRoot) {
    const root = matterRoot || matterStore.ensureMatterRoot();
    const parts = [];

    const matterJsonPath = path.join(root, "matter.json");
    if (fs.existsSync(matterJsonPath)) {
      parts.push(`[matter.json]\n${fs.readFileSync(matterJsonPath, "utf8")}`);
    }

    const intakes = await matterStore.listIntakeFolders(root);
    for (const intake of intakes) {
      const intakeDir = path.join(root, "00_Inbox", intake.name);

      const registerPath = path.join(intakeDir, "File Register.csv");
      if (fs.existsSync(registerPath)) {
        parts.push(`[${intake.name}/File Register.csv]\n${fs.readFileSync(registerPath, "utf8")}`);
      }

      const extractedPath = path.join(intakeDir, "_extracted");
      if (fs.existsSync(extractedPath)) {
        const records = collectExtractionRecords(extractedPath);
        for (const record of records) {
          parts.push(`[extraction record: ${record.file_id || "unknown"}]\n${formatMatterContextRecord(record)}`);
        }
      }
    }

    for (const candidate of discoverTopLevelDirs(root)) {
      if (candidate.name === "00_Inbox") continue;
      const records = collectExtractionRecords(candidate.fullPath);
      if (records.length) {
        for (const record of records.slice(0, MAX_LIBRARY_RECORDS)) {
          parts.push(`[${candidate.name}: ${record.file_id || "unknown"}]\n${formatMatterContextRecord(record)}`);
        }
      }
    }

    const fullContext = parts.join("\n\n---\n\n");
    return fullContext.length > MAX_CONTEXT_CHARS
      ? fullContext.slice(0, MAX_CONTEXT_CHARS) + "\n...[truncated]"
      : fullContext;
  }

  return { buildMatterContext };
}

export function formatMatterContextRecord(record) {
  if (Array.isArray(record.entries)) {
    return record.entries.map((entry) => {
      const citation = entry.citation || entry.file_id || "";
      const date = entry.date_iso || entry.date_text || "";
      const event = entry.event || entry.summary || "";
      const source = entry.original_name || entry.source_path || "";
      return [citation, date, event, source ? `source: ${source}` : ""].filter(Boolean).join(" | ");
    }).join("\n");
  }

  const pages = Array.isArray(record.pages) ? record.pages : [];
  const blocks = pages.flatMap((p) => Array.isArray(p.blocks) ? p.blocks : []);
  const textParts = blocks.map((b) => {
    const id = b.id || "?";
    const text = b.text || "";
    return `${id}: ${text}`;
  });
  return textParts.join("\n");
}

function discoverTopLevelDirs(matterRoot) {
  const results = [];
  try {
    const entries = fs.readdirSync(matterRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        results.push({ name: entry.name, fullPath: path.join(matterRoot, entry.name) });
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return results;
}

function collectExtractionRecords(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectExtractionRecords(fullPath));
      } else if (entry.name.endsWith(".json")) {
        try {
          results.push(JSON.parse(fs.readFileSync(fullPath, "utf8")));
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return results;
}

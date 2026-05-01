import fs from "node:fs";
import path from "node:path";

const MAX_CONTEXT_CHARS = 64000;
const MAX_LIBRARY_RECORDS = 20;
const CONTEXT_SEPARATOR = "\n\n---\n\n";

export function createMatterContextService({ matterStore } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function buildMatterContext(matterRoot) {
    const root = matterRoot || matterStore.ensureMatterRoot();
    const priorityParts = [];
    const secondaryParts = [];

    const matterJsonPath = path.join(root, "matter.json");
    if (fs.existsSync(matterJsonPath)) {
      priorityParts.push(`[matter.json]\n${fs.readFileSync(matterJsonPath, "utf8")}`);
    }

    const intakes = await matterStore.listIntakeFolders(root);
    for (const intake of intakes) {
      const intakeDir = path.join(root, "00_Inbox", intake.name);

      const registerPath = path.join(intakeDir, "File Register.csv");
      if (fs.existsSync(registerPath)) {
        secondaryParts.push(`[${intake.name}/File Register.csv]\n${fs.readFileSync(registerPath, "utf8")}`);
      }

      const extractedPath = path.join(intakeDir, "_extracted");
      if (fs.existsSync(extractedPath)) {
        const records = collectExtractionRecords(extractedPath);
        for (const record of records) {
          secondaryParts.push(`[extraction record: ${record.file_id || "unknown"}]\n${formatMatterContextRecord(record)}`);
        }
      }
    }

    for (const candidate of discoverTopLevelDirs(root)) {
      if (candidate.name === "00_Inbox") continue;
      const records = collectExtractionRecords(candidate.fullPath);
      if (records.length) {
        for (const record of records.slice(0, MAX_LIBRARY_RECORDS)) {
          priorityParts.push(`[${candidate.name}: ${record.file_id || "unknown"}]\n${formatMatterContextRecord(record)}`);
        }
      }
    }

    return buildBoundedContext(priorityParts, secondaryParts);
  }

  return { buildMatterContext };
}

function buildBoundedContext(priorityParts, secondaryParts) {
  let context = "";
  let truncated = false;
  for (const part of [...priorityParts, ...secondaryParts]) {
    const prefix = context ? CONTEXT_SEPARATOR : "";
    const available = MAX_CONTEXT_CHARS - context.length - prefix.length;
    if (available <= 0) {
      truncated = true;
      break;
    }
    if (part.length > available) {
      context += `${prefix}${part.slice(0, available)}`;
      truncated = true;
      break;
    }
    context += `${prefix}${part}`;
  }
  return truncated ? `${context}\n...[truncated]` : context;
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

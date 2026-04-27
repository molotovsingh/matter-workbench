import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, toCsv } from "./shared/csv.mjs";
import { loadLocalEnv } from "./shared/local-env.mjs";
import { toPosix } from "./shared/safe-paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_VERSION = "create-listofdates-v1-ai";
export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
export const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 3000;
const BLOCK_CHAR_LIMIT = 2800;
const CHUNK_CHAR_LIMIT = 18000;

const CSV_HEADERS = [
  "date_iso",
  "date_text",
  "event",
  "citation",
  "file_id",
  "source_path",
  "page",
  "block_id",
  "needs_review",
  "confidence",
];

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date_iso", "date_text", "event", "citation", "needs_review", "confidence"],
        properties: {
          date_iso: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          },
          date_text: {
            type: "string",
          },
          event: {
            type: "string",
          },
          citation: {
            type: "string",
            pattern: "^FILE-\\d{4,} p\\d+\\.b\\d+$",
          },
          needs_review: {
            type: "boolean",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
      },
    },
  },
};

export async function runCreateListOfDates(options = {}) {
  const matterRoot = options.matterRoot
    ? path.resolve(options.matterRoot)
    : (process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null);
  if (!matterRoot) throw new Error("MATTER_ROOT is not set. Pass options.matterRoot or set the env var.");

  const dryRun = Boolean(options.dryRun);
  const provider = options.aiProvider || createOpenAiProvider({
    apiKey: options.apiKey || process.env.OPENAI_API_KEY,
    model: options.model || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    maxOutputTokens: parsePositiveInteger(options.maxOutputTokens || process.env.OPENAI_MAX_OUTPUT_TOKENS)
      || DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  });

  const matterJson = await readMatterJson(matterRoot);
  const intakes = getIntakes(matterJson);
  if (!intakes.length) throw new Error("No intakes recorded in matter.json. Run /matter-init first.");

  const fileIndex = await readFileRegisterIndex(matterRoot, intakes);
  const records = await readExtractionRecords(matterRoot, intakes);
  if (!records.length) throw new Error("No extraction records found. Run /extract before /create_listofdates.");

  const blocks = buildSourceBlocks(records, fileIndex);
  if (!blocks.length) throw new Error("Extraction records contain no text blocks to analyze.");

  const chunks = chunkBlocks(blocks);
  const outputLines = [
    `> workbench.run /create_listofdates${dryRun ? " (dry-run)" : ""}`,
    `[listofdates] read ${records.length} extraction record(s)`,
    `[listofdates] sending ${blocks.length} source block(s) in ${chunks.length} AI request(s)`,
  ];

  const rawEntries = [];
  for (const [index, chunk] of chunks.entries()) {
    const response = await provider({
      matter: matterSummary(matterJson),
      chunk,
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      schema: OUTPUT_SCHEMA,
    });
    if (!response || !Array.isArray(response.entries)) {
      const error = new Error(`AI provider returned an invalid list-of-dates payload for chunk ${index + 1}`);
      error.statusCode = 502;
      throw error;
    }
    rawEntries.push(...response.entries);
    outputLines.push(`[listofdates] AI chunk ${index + 1}/${chunks.length}: ${response.entries.length} candidate event(s)`);
  }

  const validEntries = validateAndHydrateEntries(rawEntries, blocks);
  const entries = dedupeEntries(validEntries).sort(compareEntries);

  const outputDir = path.join(matterRoot, "10_Library");
  const outputPaths = {
    directory: toPosix(path.relative(matterRoot, outputDir)),
    json: toPosix(path.relative(matterRoot, path.join(outputDir, "List of Dates.json"))),
    csv: toPosix(path.relative(matterRoot, path.join(outputDir, "List of Dates.csv"))),
    markdown: toPosix(path.relative(matterRoot, path.join(outputDir, "List of Dates.md"))),
  };

  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, "List of Dates.json"),
      `${JSON.stringify({
        schema_version: "list-of-dates/v1",
        engine_version: ENGINE_VERSION,
        generated_at: new Date().toISOString(),
        matter: matterSummary(matterJson),
        source_record_count: records.length,
        entries,
      }, null, 2)}\n`,
    );
    await writeFile(path.join(outputDir, "List of Dates.csv"), toCsv(entries, CSV_HEADERS));
    await writeFile(path.join(outputDir, "List of Dates.md"), renderMarkdown(matterJson, entries));
  }

  outputLines.push(`[listofdates] accepted ${entries.length} cited date event(s)`);
  outputLines.push(dryRun
    ? "[listofdates] dry run only. Re-run with apply to write list of dates."
    : `[listofdates] wrote ${outputPaths.json}, ${outputPaths.csv}, ${outputPaths.markdown}`);

  return {
    dryRun,
    matterRoot,
    engineVersion: ENGINE_VERSION,
    counts: {
      recordsRead: records.length,
      blocksSent: blocks.length,
      aiRequests: chunks.length,
      candidateEntries: rawEntries.length,
      entries: entries.length,
      rejectedEntries: rawEntries.length - entries.length,
    },
    outputPaths,
    entries,
    outputLines,
  };
}

export function createOpenAiProvider({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  endpoint = "https://api.openai.com/v1/responses",
  maxOutputTokens = DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
} = {}) {
  return async function openAiListOfDatesProvider({ matter, chunk, chunkIndex, chunkCount, schema }) {
    if (!apiKey) {
      const error = new Error("OPENAI_API_KEY is required for /create_listofdates");
      error.statusCode = 409;
      throw error;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_output_tokens: maxOutputTokens,
        input: [
          {
            role: "system",
            content: [
              "You are a careful Indian legal chronology assistant.",
              "Create a source-backed list of dates from extracted document blocks.",
              "Use only the supplied source blocks.",
              "Extract legally or factually relevant dated events.",
              "Do not invent dates, facts, parties, or citations.",
              "Every entry must cite exactly one supplied citation in the form FILE-NNNN pX.bY.",
              "Return JSON only in the requested schema.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Create list of dates from this chunk of extraction records.",
              matter,
              chunk_index: chunkIndex,
              chunk_count: chunkCount,
              instructions: [
                "Include exact calendar dates only when the source gives day, month, and year.",
                "Normalize dates to YYYY-MM-DD.",
                "Write event text as a concise lawyer-reviewable fact from the cited block.",
                "Use needs_review=true if OCR noise, ambiguity, or low source confidence makes the event uncertain.",
                "Ignore bare years, statute years, section numbers, page numbers, and unrelated citation years unless tied to an event in the source block.",
              ],
              source_blocks: chunk.map((block) => ({
                citation: block.citation,
                source: block.original_name || block.source_path,
                confidence: block.confidence,
                needs_review: block.needs_review,
                text: block.text,
              })),
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "list_of_dates_chunk",
            description: "Cited legal chronology entries extracted from source blocks.",
            strict: true,
            schema,
          },
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `OpenAI Responses API returned ${response.status}`);
      error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
      throw error;
    }
    const outputText = extractOutputText(payload);
    if (!outputText) {
      const error = new Error("OpenAI response did not include output text");
      error.statusCode = 502;
      throw error;
    }
    try {
      return JSON.parse(outputText);
    } catch (parseError) {
      const error = new Error(`OpenAI response was not valid JSON: ${parseError.message}`);
      error.statusCode = 502;
      throw error;
    }
  };
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("").trim();
}

async function readMatterJson(matterRoot) {
  const matterJsonPath = path.join(matterRoot, "matter.json");
  try {
    return JSON.parse(await readFile(matterJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`matter.json not found or invalid at ${matterJsonPath}. Run /matter-init first. (${error.message})`);
  }
}

function getIntakes(matterJson) {
  const intakes = Array.isArray(matterJson.intakes) ? [...matterJson.intakes] : [];
  if (!intakes.length && matterJson.phase_1_intake) {
    intakes.push({
      intake_id: matterJson.phase_1_intake.intake_id || "INTAKE-01",
      intake_dir: matterJson.phase_1_intake.intake_dir || "00_Inbox/Intake 01 - Initial",
    });
  }
  return intakes.filter((intake) => intake && intake.intake_dir);
}

async function readFileRegisterIndex(matterRoot, intakes) {
  const index = new Map();
  for (const intake of intakes) {
    const registerPath = path.join(matterRoot, intake.intake_dir, "File Register.csv");
    try {
      const rows = parseCsv(await readFile(registerPath, "utf8"));
      for (const row of rows) {
        if (row.file_id) index.set(row.file_id, row);
      }
    } catch {
      // Missing historical registers should not block chronology from records.
    }
  }
  return index;
}

async function readExtractionRecords(matterRoot, intakes) {
  const records = [];
  for (const intake of intakes) {
    const extractedDir = path.join(matterRoot, intake.intake_dir, "_extracted");
    let entries = [];
    try {
      entries = await readdir(extractedDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.filter((item) => item.isFile() && /^FILE-\d+\.json$/.test(item.name))) {
      const recordPath = path.join(extractedDir, entry.name);
      try {
        const record = JSON.parse(await readFile(recordPath, "utf8"));
        if (record.schema_version === "extraction-record/v1" && record.file_id) records.push(record);
      } catch {
        // /doctor will own invalid-record reporting; this skill skips them.
      }
    }
  }
  return records.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id)));
}

function buildSourceBlocks(records, fileIndex) {
  const blocks = [];
  for (const record of records) {
    const fileInfo = fileIndex.get(record.file_id) || {};
    for (const page of record.pages || []) {
      for (const block of page.blocks || []) {
        if (!block?.id || typeof block.text !== "string" || !block.text.trim()) continue;
        const citation = `${record.file_id} ${block.id}`;
        blocks.push({
          citation,
          file_id: record.file_id,
          source_path: record.source_path,
          original_name: fileInfo.original_name || path.basename(record.source_path || ""),
          page: page.page,
          block_id: block.id,
          block_type: block.type || "",
          confidence: page.confidence_avg ?? 1,
          needs_review: Boolean(page.needs_review),
          engine: record.engine,
          sha256: record.sha256,
          text: block.text.length > BLOCK_CHAR_LIMIT
            ? `${block.text.slice(0, BLOCK_CHAR_LIMIT)}\n[block truncated for AI input]`
            : block.text,
        });
      }
    }
  }
  return blocks;
}

function chunkBlocks(blocks) {
  const chunks = [];
  let current = [];
  let currentSize = 0;
  for (const block of blocks) {
    const size = block.text.length + block.citation.length + 120;
    if (current.length && currentSize + size > CHUNK_CHAR_LIMIT) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(block);
    currentSize += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function validateAndHydrateEntries(rawEntries, blocks) {
  const blockByCitation = new Map(blocks.map((block) => [block.citation, block]));
  const entries = [];
  for (const raw of rawEntries) {
    const block = blockByCitation.get(raw.citation);
    if (!block) continue;
    if (!isValidDateIso(raw.date_iso)) continue;
    const event = String(raw.event || "").replace(/\s+/g, " ").trim();
    const dateText = String(raw.date_text || "").replace(/\s+/g, " ").trim();
    if (!event || !dateText) continue;
    entries.push({
      date_iso: raw.date_iso,
      date_text: dateText,
      event: event.slice(0, 1000),
      citation: raw.citation,
      file_id: block.file_id,
      source_path: block.source_path,
      original_name: block.original_name,
      page: block.page,
      block_id: block.block_id,
      block_type: block.block_type,
      needs_review: Boolean(raw.needs_review || block.needs_review),
      confidence: normalizeConfidence(raw.confidence),
      source_excerpt: block.text.slice(0, 500),
    });
  }
  return entries;
}

function isValidDateIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

function dedupeEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.date_iso}|${entry.event}|${entry.citation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareEntries(a, b) {
  return a.date_iso.localeCompare(b.date_iso)
    || a.file_id.localeCompare(b.file_id)
    || String(a.block_id).localeCompare(String(b.block_id))
    || a.date_text.localeCompare(b.date_text);
}

function matterSummary(matterJson) {
  return {
    matter_name: matterJson.matter_name || "",
    client_name: matterJson.client_name || "",
    opposite_party: matterJson.opposite_party || "",
    matter_type: matterJson.matter_type || "",
    jurisdiction: matterJson.jurisdiction || "",
    brief_description: matterJson.brief_description || "",
  };
}

function renderMarkdown(matterJson, entries) {
  const rows = entries.map((entry) => (
    `| ${escapeMarkdownCell(entry.date_iso)} | ${escapeMarkdownCell(entry.event)} | ${escapeMarkdownCell(entry.citation)} | ${escapeMarkdownCell(entry.original_name || entry.source_path)} |`
  ));
  return `# List of Dates\n\nMatter: ${matterJson.matter_name || "Matter"}\n\nGenerated by ${ENGINE_VERSION}. Review before relying on this chronology.\n\n| Date | Event | Citation | Source |\n|---|---|---|---|\n${rows.join("\n")}\n`;
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

if (process.argv[1] === __filename) {
  const dryRun = !process.argv.includes("--apply");
  await loadLocalEnv({ appDir: path.dirname(__filename), override: true });
  runCreateListOfDates({ dryRun })
    .then((result) => {
      console.log(result.outputLines.join("\n"));
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}

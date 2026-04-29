import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
} from "./shared/ai-defaults.mjs";
import { modelPolicyMetadata, resolveProviderConfig } from "./shared/ai-provider-policy.mjs";
import { parseCsv, toCsv } from "./shared/csv.mjs";
import { loadLocalEnv } from "./shared/local-env.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "./shared/model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT, requestResponsesJson } from "./shared/responses-client.mjs";
import { toPosix } from "./shared/safe-paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_VERSION = "create-listofdates-v1-ai";
export { DEFAULT_OPENAI_MAX_OUTPUT_TOKENS, DEFAULT_OPENAI_MODEL } from "./shared/ai-defaults.mjs";
const BLOCK_CHAR_LIMIT = 2800;
const CHUNK_CHAR_LIMIT = 18000;

const CSV_HEADERS = [
  "date_iso",
  "date_text",
  "event",
  "citation",
  "source_file_id",
  "source_label",
  "source_short_label",
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
  const env = options.env || process.env;
  const modelPolicy = resolveModelPolicy(AI_TASKS.SOURCE_BACKED_ANALYSIS, { env });
  const providerConfig = resolveProviderConfig(modelPolicy, {
    endpoint: options.endpoint,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs,
  });
  const baseAiRun = modelPolicyMetadata(modelPolicy, providerConfig);
  const provider = options.aiProvider || createListOfDatesProvider({
    providerConfig,
    apiKey: options.apiKey,
    env,
    fetchImpl: options.fetchImpl || fetch,
  });

  const matterJson = await readMatterJson(matterRoot);
  const intakes = getIntakes(matterJson);
  if (!intakes.length) throw new Error("No intakes recorded in matter.json. Run /matter-init first.");

  const fileIndex = await readFileRegisterIndex(matterRoot, intakes);
  const records = await readExtractionRecords(matterRoot, intakes);
  if (!records.length) throw new Error("No extraction records found. Run /extract before /create_listofdates.");

  const blocks = buildSourceBlocks(records, fileIndex);
  if (!blocks.length) throw new Error("Extraction records contain no text blocks to analyze.");
  const sourceIndex = await readSourceIndex(matterRoot, blocks);

  const chunks = chunkBlocks(blocks);
  const outputLines = [
    `> workbench.run /create_listofdates${dryRun ? " (dry-run)" : ""}`,
    `[listofdates] read ${records.length} extraction record(s)`,
    `[listofdates] sending ${blocks.length} source block(s) in ${chunks.length} AI request(s)`,
  ];

  const rawEntries = [];
  const responseAiRuns = [];
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
    if (response.ai_run) responseAiRuns.push(response.ai_run);
    outputLines.push(`[listofdates] AI chunk ${index + 1}/${chunks.length}: ${response.entries.length} candidate event(s)`);
  }

  const validEntries = validateAndHydrateEntries(rawEntries, blocks, sourceIndex);
  const entries = dedupeEntries(validEntries).sort(compareEntries);
  const aiRun = mergeAiRunMetadata(baseAiRun, responseAiRuns);

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
        ai_run: aiRun,
        source_record_count: records.length,
        entries,
      }, null, 2)}\n`,
    );
    await writeFile(path.join(outputDir, "List of Dates.csv"), toCsv(entries, CSV_HEADERS));
    await writeFile(path.join(outputDir, "List of Dates.md"), renderMarkdown(matterJson, entries));
  }

  outputLines.push(`[listofdates] accepted ${entries.length} cited date event(s)`);
  outputLines.push(`[listofdates] provider ${aiRun.provider}: ${aiRun.model}`);
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
    aiRun,
    entries,
    outputLines,
  };
}

function createListOfDatesProvider({ providerConfig, apiKey, env, fetchImpl }) {
  if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
    return createOpenRouterProvider({
      apiKey: apiKey || env.OPENROUTER_API_KEY,
      endpoint: providerConfig.endpoint,
      fetchImpl,
      maxOutputTokens: providerConfig.maxOutputTokens,
      model: providerConfig.model,
      requireParameters: providerConfig.requireParameters,
      allowFallbacks: providerConfig.allowFallbacks,
      providerOrder: providerConfig.providerOrder,
      providerSort: providerConfig.providerSort,
      maxPrice: providerConfig.maxPrice,
      timeoutMs: providerConfig.timeoutMs,
    });
  }
  return createOpenAiProvider({
    apiKey: apiKey || env.OPENAI_API_KEY,
    model: providerConfig.model,
    endpoint: providerConfig.endpoint,
    maxOutputTokens: providerConfig.maxOutputTokens,
  });
}

export function createOpenAiProvider({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  endpoint = DEFAULT_RESPONSES_ENDPOINT,
  maxOutputTokens = DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
} = {}) {
  return async function openAiListOfDatesProvider({ matter, chunk, chunkIndex, chunkCount, schema }) {
    return requestResponsesJson({
      apiKey,
      endpoint,
      missingApiKeyMessage: "OPENAI_API_KEY is required for /create_listofdates",
      body: {
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
            content: JSON.stringify(listOfDatesPromptPayload({ matter, chunk, chunkIndex, chunkCount })),
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
      },
    });
  };
}

export function createOpenRouterProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  maxOutputTokens,
  model,
  providerOrder = [],
  providerSort = "",
  maxPrice = null,
  requireParameters = true,
  allowFallbacks = false,
  timeoutMs,
} = {}) {
  return async function openRouterListOfDatesProvider({ matter, chunk, chunkIndex, chunkCount, schema }) {
    if (!apiKey) {
      const error = new Error("OPENROUTER_API_KEY is required for /create_listofdates");
      error.statusCode = 409;
      throw error;
    }
    if (!model) {
      const error = new Error("OPENROUTER_SOURCE_BACKED_ANALYSIS_MODEL is required for /create_listofdates");
      error.statusCode = 409;
      throw error;
    }

    const body = {
      model,
      messages: [
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
          content: JSON.stringify(listOfDatesPromptPayload({ matter, chunk, chunkIndex, chunkCount })),
        },
      ],
      temperature: 0,
      max_tokens: maxOutputTokens,
      provider: {
        require_parameters: requireParameters,
        allow_fallbacks: allowFallbacks,
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "list_of_dates_chunk",
          strict: true,
          schema,
        },
      },
    };
    if (providerOrder.length) body.provider.order = providerOrder;
    if (providerSort) body.provider.sort = providerSort;
    if (maxPrice) body.provider.max_price = maxPrice;

    const { signal, cancelTimeout } = createRequestSignal(timeoutMs);
    let response;
    let payload;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://github.com/molotovsingh/matter-workbench",
          "x-title": "Matter Workbench List of Dates",
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      payload = await response.json().catch((error) => {
        if (signal?.aborted || error?.name === "AbortError") throw error;
        return null;
      });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") {
        const timeoutError = new Error(`OpenRouter list-of-dates request timed out after ${timeoutMs}ms`);
        timeoutError.statusCode = 504;
        throw timeoutError;
      }
      throw error;
    } finally {
      cancelTimeout();
    }
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `OpenRouter returned ${response.status}`);
      error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
      throw error;
    }

    return parseOpenRouterJsonContent(payload);
  };
}

function listOfDatesPromptPayload({ matter, chunk, chunkIndex, chunkCount }) {
  return {
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
  };
}

function createRequestSignal(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return {
      signal: null,
      cancelTimeout: () => {},
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancelTimeout: () => clearTimeout(timer),
  };
}

function parseOpenRouterJsonContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    try {
      return attachOpenRouterAiRunMetadata(JSON.parse(content), payload);
    } catch (parseError) {
      const error = new Error(`OpenRouter response did not include valid JSON message content: ${parseError.message}`);
      error.statusCode = 502;
      throw error;
    }
  }
  if (content && typeof content === "object") return attachOpenRouterAiRunMetadata(content, payload);
  const error = new Error("OpenRouter response did not include JSON message content");
  error.statusCode = 502;
  throw error;
}

function attachOpenRouterAiRunMetadata(content, payload) {
  const aiRun = extractOpenRouterAiRunMetadata(payload);
  if (!Object.keys(aiRun).length) return content;
  return {
    ...content,
    ai_run: aiRun,
  };
}

function mergeAiRunMetadata(baseAiRun, responseAiRuns) {
  const aiRuns = Array.isArray(responseAiRuns) ? responseAiRuns : [responseAiRuns].filter(Boolean);
  if (!aiRuns.length) return baseAiRun;
  const merged = { ...baseAiRun };
  const usage = {};
  for (const aiRun of aiRuns) {
    if (!aiRun || typeof aiRun !== "object" || Array.isArray(aiRun)) continue;
    if (aiRun.returnedModel) merged.returnedModel = aiRun.returnedModel;
    if (aiRun.returnedProvider) merged.returnedProvider = aiRun.returnedProvider;
    if (aiRun.usage) {
      addNumber(usage, "promptTokens", aiRun.usage.promptTokens);
      addNumber(usage, "completionTokens", aiRun.usage.completionTokens);
      addNumber(usage, "totalTokens", aiRun.usage.totalTokens);
      addNumber(usage, "cost", aiRun.usage.cost);
    }
  }
  if (Object.keys(usage).length) merged.usage = usage;
  return merged;
}

function extractOpenRouterAiRunMetadata(payload) {
  const metadata = {};
  const returnedModel = normalizeOptionalString(payload?.model);
  const returnedProvider = normalizeOptionalString(payload?.provider)
    || normalizeOptionalString(payload?.provider_name)
    || normalizeOptionalString(payload?.choices?.[0]?.provider);
  const usage = normalizeOpenRouterUsage(payload?.usage);
  if (returnedModel) metadata.returnedModel = returnedModel;
  if (returnedProvider) metadata.returnedProvider = returnedProvider;
  if (usage) metadata.usage = usage;
  return metadata;
}

function normalizeOpenRouterUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const normalized = {};
  const promptTokens = parseNonNegativeInteger(usage.prompt_tokens ?? usage.promptTokens);
  const completionTokens = parseNonNegativeInteger(usage.completion_tokens ?? usage.completionTokens);
  const totalTokens = parseNonNegativeInteger(usage.total_tokens ?? usage.totalTokens);
  const cost = parseNonNegativeNumber(usage.cost);
  if (promptTokens !== null) normalized.promptTokens = promptTokens;
  if (completionTokens !== null) normalized.completionTokens = completionTokens;
  if (totalTokens !== null) normalized.totalTokens = totalTokens;
  if (cost !== null) normalized.cost = cost;
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeOptionalString(value) {
  const text = String(value || "").trim();
  return text || "";
}

function parseNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function parseNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function addNumber(target, key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  target[key] = (target[key] || 0) + number;
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

async function readSourceIndex(matterRoot, blocks) {
  const indexPath = path.join(matterRoot, "10_Library", "Source Index.json");
  let artifact;
  try {
    artifact = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    return new Map();
  }
  if (artifact?.schema_version !== "source-index/v1" || !Array.isArray(artifact.sources)) return new Map();

  const blockByFileId = new Map(blocks.map((block) => [block.file_id, block]));
  const index = new Map();
  for (const source of artifact.sources) {
    const block = blockByFileId.get(source?.file_id);
    if (!block || source.sha256 !== block.sha256) continue;
    if (source.source_path !== block.source_path) continue;
    const label = normalizeDisplayText(source.display_label);
    const shortLabel = normalizeDisplayText(source.short_label);
    if (!label || hasFileIdPrefix(label) || hasFileIdPrefix(shortLabel)) continue;
    index.set(source.file_id, {
      source_label: label,
      source_short_label: shortLabel || label,
    });
  }
  return index;
}

function validateAndHydrateEntries(rawEntries, blocks, sourceIndex = new Map()) {
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
      source_file_id: block.file_id,
      ...sourceIndex.get(block.file_id),
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

function normalizeDisplayText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasFileIdPrefix(value) {
  return /\bFILE-\d{4,}\b/.test(String(value || ""));
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
    `| ${escapeMarkdownCell(entry.date_iso)} | ${escapeMarkdownCell(entry.event)} | ${escapeMarkdownCell(entry.citation)} | ${escapeMarkdownCell(formatSourceForDisplay(entry))} |`
  ));
  return `# List of Dates\n\nMatter: ${matterJson.matter_name || "Matter"}\n\nGenerated by ${ENGINE_VERSION}. Review before relying on this chronology.\n\n| Date | Event | Citation | Source |\n|---|---|---|---|\n${rows.join("\n")}\n`;
}

function formatSourceForDisplay(entry) {
  const fallback = entry.original_name || entry.source_path;
  if (!entry.source_label) return fallback;
  return `${entry.source_label} (${entry.citation})`;
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

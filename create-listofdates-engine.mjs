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
const LAWYER_FACING_PERSPECTIVE = "client_favourable";
const EVENT_TYPES = [
  "agreement",
  "payment",
  "notice",
  "demand",
  "reply",
  "admission",
  "denial",
  "objection",
  "deadline",
  "deadline_missed",
  "hearing",
  "filing",
  "inspection",
  "contradiction",
  "gap_marker",
  "other",
];
const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const LIST_OF_DATES_SYSTEM_PROMPT = [
  "You are a careful Indian legal chronology assistant.",
  "Create a lawyer-facing, client-favourable, source-backed list of dates from extracted document blocks.",
  "Use only the supplied source blocks and the declared client recorded in the matter metadata.",
  "Extract legally or factually relevant dated events.",
  "Do not invent dates, facts, parties, citations, advocacy, or legal conclusions.",
  "Every entry must cite exactly one supplied citation in the form FILE-NNNN pX.bY.",
  "Every legal_relevance sentence must be supported by the same cited block as the event.",
  "Use claimed, denied, alleged, states, records, objected, failed, missed, demanded, or acknowledged for disputed facts.",
  "Do not say fraud, bad faith, breach, breach proved, liability admitted, or equivalent unless the cited source says it.",
  "Keep readable source labels separate from raw citations; raw FILE-NNNN pX.bY citations remain canonical.",
  "Do not repeat raw FILE-NNNN pX.bY citations inside event or legal_relevance text.",
  "Return one compact JSON object only, matching the requested schema.",
].join(" ");
const HIGH_RISK_CONCLUSION_TERMS = [
  "fraud",
  "bad faith",
  "breach proved",
  "liability admitted",
];
const RAW_CITATION_RE = /\bFILE-\d{4,}\s+p\d+\.b\d+\b/g;
const META_DOCUMENT_TYPE_SET = new Set([
  "readme",
  "manifest",
  "index",
  "file_index",
  "bundle_index",
  "exhibit_index",
  "metadata",
]);
const META_SOURCE_NAME_RE = /\b(readme|manifest|(?:file|document|exhibit|bundle)\s*index|(?:file|document|exhibit|bundle)\s*list|table\s*of\s*contents|metadata)\b/i;
const PAYMENT_TAGS = new Set(["payment", "receipt", "instalment", "installment", "paid", "debit"]);
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "per",
  "the",
  "this",
  "to",
  "under",
  "with",
  "was",
  "were",
  "which",
]);

const CSV_HEADERS = [
  "date_iso",
  "date_text",
  "event",
  "event_type",
  "legal_relevance",
  "issue_tags",
  "perspective",
  "cluster_id",
  "cluster_type",
  "supporting_citations",
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
        required: [
          "date_iso",
          "date_text",
          "event",
          "event_type",
          "legal_relevance",
          "issue_tags",
          "perspective",
          "citation",
          "needs_review",
          "confidence",
        ],
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
          event_type: {
            type: "string",
            enum: EVENT_TYPES,
          },
          legal_relevance: {
            type: "string",
          },
          issue_tags: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 64,
            },
          },
          perspective: {
            type: "string",
            enum: [LAWYER_FACING_PERSPECTIVE],
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
  const chronologyBlocks = filterChronologyCandidateBlocks(blocks, sourceIndex);
  if (!chronologyBlocks.length) {
    throw new Error("Extraction records contain no chronology-eligible text blocks to analyze.");
  }

  const chunks = chunkBlocks(chronologyBlocks);
  const filteredBlockCount = blocks.length - chronologyBlocks.length;
  const outputLines = [
    `> workbench.run /create_listofdates${dryRun ? " (dry-run)" : ""}`,
    `[listofdates] read ${records.length} extraction record(s)`,
    `[listofdates] sending ${chronologyBlocks.length} source block(s) in ${chunks.length} AI request(s)`,
  ];
  if (filteredBlockCount) {
    outputLines.push(`[listofdates] filtered ${filteredBlockCount} meta/index source block(s) before AI input`);
  }

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

  const validEntries = validateAndHydrateEntries(rawEntries, chronologyBlocks, sourceIndex);
  const acceptedEntries = validEntries.sort(compareEntries);
  const entries = clusterChronologyEntries(acceptedEntries).sort(compareEntries);
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

  outputLines.push(`[listofdates] accepted ${acceptedEntries.length} cited date event(s)`);
  if (acceptedEntries.length !== entries.length) {
    outputLines.push(`[listofdates] rendered ${entries.length} chronology row(s) after cluster classification`);
  }
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
      blocksSent: chronologyBlocks.length,
      blocksFiltered: filteredBlockCount,
      aiRequests: chunks.length,
      candidateEntries: rawEntries.length,
      acceptedEntries: acceptedEntries.length,
      clusteredEntries: acceptedEntries.length - entries.length,
      entries: entries.length,
      rejectedEntries: rawEntries.length - acceptedEntries.length,
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
            content: LIST_OF_DATES_SYSTEM_PROMPT,
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
          content: LIST_OF_DATES_SYSTEM_PROMPT,
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
      `Write perspective exactly as ${LAWYER_FACING_PERSPECTIVE}.`,
      "Classify event_type using one allowed event type.",
      "Write legal_relevance as one source-supported sentence explaining why this event matters to the declared client's case.",
      "Use client-favourable legal framing only when the cited block supports it.",
      "Use issue_tags as short conservative review handles such as payment, delay, possession, notice, deadline, contradiction, admission, denial, objection, evidence_gap, procedure, or damages.",
      "Use claimed, denied, alleged, states, or records for disputed facts; do not present disputed allegations as proven.",
      "Do not say fraud, bad faith, breach, breach proved, liability admitted, or equivalent unless the cited block itself says it.",
      "Do not repeat raw FILE-NNNN pX.bY citations inside event or legal_relevance text; use the citation field only.",
      "Do not collapse multiple same-day events when they carry different legal meaning or different citations.",
      "Use needs_review=true if OCR noise, ambiguity, or low source confidence makes the event uncertain.",
      "Ignore bare years, statute years, section numbers, page numbers, and unrelated citation years unless tied to an event in the source block.",
    ],
    allowed_event_types: EVENT_TYPES,
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
          category: fileInfo.category || "",
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
    const metadata = {
      document_type: normalizeDisplayText(source.document_type).toLowerCase(),
      display_label: label,
      short_label: shortLabel,
    };
    if (label && !hasFileIdPrefix(label) && !hasFileIdPrefix(shortLabel)) {
      metadata.source_label = label;
      metadata.source_short_label = shortLabel || label;
    }
    index.set(source.file_id, metadata);
  }
  return index;
}

function filterChronologyCandidateBlocks(blocks, sourceIndex = new Map()) {
  return blocks.filter((block) => !isMetaChronologySource(block, sourceIndex.get(block.file_id)));
}

function isMetaChronologySource(block, sourceMetadata = {}) {
  const documentType = normalizeDisplayText(sourceMetadata.document_type).toLowerCase();
  if (META_DOCUMENT_TYPE_SET.has(documentType)) return true;

  const names = [
    sourceMetadata.display_label,
    sourceMetadata.short_label,
    block.original_name,
    path.basename(block.source_path || ""),
  ].map(normalizeEligibilityText).filter(Boolean);

  return names.some((name) => META_SOURCE_NAME_RE.test(name));
}

function normalizeEligibilityText(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateAndHydrateEntries(rawEntries, blocks, sourceIndex = new Map()) {
  const blockByCitation = new Map(blocks.map((block) => [block.citation, block]));
  const entries = [];
  for (const raw of rawEntries) {
    const block = blockByCitation.get(raw.citation);
    if (!block) continue;
    if (!isValidDateIso(raw.date_iso)) continue;
    const event = normalizeEventText(raw.event, block.text);
    const dateText = String(raw.date_text || "").replace(/\s+/g, " ").trim();
    const eventType = normalizeEventType(raw.event_type);
    const legalRelevance = normalizeLegalRelevance(raw.legal_relevance, block.text);
    const issueTags = normalizeIssueTags(raw.issue_tags);
    const perspective = String(raw.perspective || "").replace(/\s+/g, " ").trim();
    if (!event || !dateText || !eventType || !legalRelevance || !issueTags.length) continue;
    if (perspective !== LAWYER_FACING_PERSPECTIVE) continue;
    entries.push({
      date_iso: raw.date_iso,
      date_text: dateText,
      event,
      event_type: eventType,
      legal_relevance: legalRelevance,
      issue_tags: issueTags,
      perspective,
      citation: raw.citation,
      file_id: block.file_id,
      source_file_id: block.file_id,
      ...sourceLabelFields(sourceIndex.get(block.file_id)),
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

function sourceLabelFields(sourceMetadata = {}) {
  const fields = {};
  if (sourceMetadata.source_label) fields.source_label = sourceMetadata.source_label;
  if (sourceMetadata.source_short_label) fields.source_short_label = sourceMetadata.source_short_label;
  return fields;
}

function normalizeEventType(value) {
  const eventType = String(value || "").trim().toLowerCase();
  return EVENT_TYPE_SET.has(eventType) ? eventType : "";
}

function normalizeEventText(value, sourceText) {
  const event = normalizeNarrativeText(value, sourceText);
  if (!event) return "";
  if (hasUnsupportedHighRiskConclusion(event, sourceText)) return "";
  return event.slice(0, 1000);
}

function normalizeNarrativeText(value, sourceText) {
  return softenUnsupportedConclusionLanguage(String(value || ""))
    .replace(RAW_CITATION_RE, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

function normalizeLegalRelevance(value, sourceText) {
  const relevance = normalizeNarrativeText(value, sourceText);
  if (!relevance) return "";
  if (hasUnsupportedHighRiskConclusion(relevance, sourceText)) return "";
  return relevance.slice(0, 1000);
}

function softenUnsupportedConclusionLanguage(value) {
  return value
    .replace(/\bproves?\b/gi, "supports")
    .replace(/\bproved\b/gi, "supported")
    .replace(/\bconstitutes\s+a\s+breach\b/gi, "supports a contractual default issue")
    .replace(/\bestablishing\s+the\s+breach\b/gi, "supporting the client's default issue")
    .replace(/\bbreach\s+of\s+(?:the\s+)?agreement\b/gi, "contractual default issue")
    .replace(/\bbreached\b/gi, "missed")
    .replace(/\bbreach\b/gi, "default issue");
}

function hasUnsupportedHighRiskConclusion(relevance, sourceText) {
  const source = String(sourceText || "").toLowerCase();
  const text = relevance.toLowerCase();
  return HIGH_RISK_CONCLUSION_TERMS.some((term) => text.includes(term) && !source.includes(term));
}

function normalizeIssueTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || "").split(/[,;]/);
  const tags = [];
  const seen = new Set();
  for (const rawTag of rawTags) {
    const tag = String(rawTag || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag.slice(0, 64));
    if (tags.length >= 8) break;
  }
  return tags;
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

function clusterChronologyEntries(entries) {
  const clusters = [];
  for (const entry of entries) {
    const cluster = clusters.find((candidate) => canClusterEntries(candidate, entry));
    if (cluster) {
      cluster.entries.push(entry);
    } else {
      clusters.push({ entries: [entry] });
    }
  }
  return clusters.map((cluster, index) => buildClusterEntry(cluster.entries, index + 1));
}

function canClusterEntries(cluster, entry) {
  if (cluster.entries[0].date_iso !== entry.date_iso) return false;
  return cluster.entries.some((candidate) => areRelatedChronologyEntries(candidate, entry));
}

function areRelatedChronologyEntries(a, b) {
  if (a.citation === b.citation && normalizeEventKey(a.event) === normalizeEventKey(b.event)) return true;
  if (isPaymentEntry(a) && isPaymentEntry(b)) return relatedPaymentEntries(a, b);
  const similarity = Math.max(
    textSimilarity(a.event, b.event),
    textSimilarity(`${a.event} ${a.legal_relevance}`, `${b.event} ${b.legal_relevance}`),
  );
  if (similarity >= 0.58) return true;
  if (relatedEventTypes(a, b) && similarity >= 0.38) return true;
  if (sharedIssueTag(a, b) && similarity >= 0.34) return true;
  return false;
}

function buildClusterEntry(clusterEntries, clusterNumber) {
  const clusterType = classifyCluster(clusterEntries);
  const leadEntry = chooseClusterLead(clusterEntries, clusterType);
  const supportingSources = uniqueSupportingSources(clusterEntries);
  const entry = {
    ...leadEntry,
    cluster_id: `LOD-CLUSTER-${String(clusterNumber).padStart(4, "0")}`,
    cluster_type: clusterType,
    supporting_sources: supportingSources,
    supporting_citations: supportingSources.map((source) => source.citation).join("; "),
  };
  if (clusterType === "payment_discrepancy") return paymentDiscrepancyEntry(entry, clusterEntries);
  return entry;
}

function classifyCluster(entries) {
  if (entries.length === 1) return "single_event";
  if (isTrueDuplicateCluster(entries)) return "true_duplicate";
  if (isPaymentCluster(entries) && extractClusterAmounts(entries).length > 1) return "payment_discrepancy";
  if (isSourceRepeatCluster(entries)) return "source_repeat";
  return "corroborated_event";
}

function isTrueDuplicateCluster(entries) {
  const signatures = new Set(entries.map((entry) => `${entry.date_iso}|${normalizeEventKey(entry.event)}|${entry.citation}`));
  return signatures.size === 1;
}

function isSourceRepeatCluster(entries) {
  const citations = new Set(entries.map((entry) => entry.citation));
  const files = new Set(entries.map((entry) => entry.source_file_id || entry.file_id));
  return citations.size === 1 || files.size === 1;
}

function isPaymentCluster(entries) {
  return entries.every(isPaymentEntry);
}

function isPaymentEntry(entry) {
  if (entry.event_type === "payment") return true;
  return (entry.issue_tags || []).some((tag) => PAYMENT_TAGS.has(String(tag).toLowerCase()));
}

function relatedPaymentEntries(a, b) {
  if (overlappingNumbers(entryAmounts(a), entryAmounts(b))) return true;
  if (overlappingStrings(paymentOrdinals(a), paymentOrdinals(b))) return true;
  if ((hasPaymentDiscrepancySignal(a) || hasPaymentDiscrepancySignal(b)) && sharedIssueTag(a, b)) return true;
  return false;
}

function entryAmounts(entry) {
  return extractRupeeAmounts(`${entry.event} ${entry.legal_relevance}`);
}

function paymentOrdinals(entry) {
  const text = `${entry.event} ${entry.legal_relevance}`.toLowerCase();
  const ordinals = [];
  const pattern = /\b(\d+)(?:st|nd|rd|th)?\s+(?:instalment|installment)|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:instalment|installment)/gi;
  for (const match of text.matchAll(pattern)) {
    ordinals.push(String(match[1] || match[2]).toLowerCase());
  }
  return ordinals;
}

function hasPaymentDiscrepancySignal(entry) {
  return /\b(discrepanc(?:y|ies)|difference|shortfall|contradict(?:ion|ory|ed|s)?|inconsistent)\b/i
    .test(`${entry.event} ${entry.legal_relevance} ${(entry.issue_tags || []).join(" ")}`);
}

function overlappingNumbers(a, b) {
  const bSet = new Set(b);
  return a.some((value) => bSet.has(value));
}

function overlappingStrings(a, b) {
  const bSet = new Set(b);
  return a.some((value) => bSet.has(value));
}

function chooseClusterLead(entries, clusterType) {
  const sorted = [...entries].sort((a, b) => sourcePriority(a, clusterType) - sourcePriority(b, clusterType)
    || b.confidence - a.confidence
    || compareEntries(a, b));
  return sorted[0];
}

function sourcePriority(entry, clusterType) {
  const label = `${entry.source_label || ""} ${entry.original_name || ""} ${entry.source_path || ""}`.toLowerCase();
  if (clusterType === "payment_discrepancy" || clusterType === "corroborated_event") {
    if (/\bbank\b|statement|ledger/.test(label)) return 0;
    if (/receipt/.test(label)) return 1;
  }
  if (/agreement|contract/.test(label)) return 0;
  if (/legal notice|demand notice|notice/.test(label)) return 1;
  if (/email/.test(label)) return 2;
  if (/interview/.test(label)) return 4;
  return 3;
}

function paymentDiscrepancyEntry(entry, clusterEntries) {
  const amounts = extractClusterAmounts(clusterEntries);
  const amountText = amounts.map(formatRupeeAmount).join(" vs ");
  return {
    ...entry,
    event_type: "contradiction",
    event: amountText
      ? `Payment discrepancy: same-date sources record inconsistent amounts (${amountText})`
      : "Payment discrepancy: same-date sources record inconsistent amounts",
    legal_relevance: "Flags a payment-record inconsistency for lawyer review because same-date sources record different amounts for the client's payment.",
    issue_tags: uniqueStrings([...entry.issue_tags, "payment", "contradiction"]),
    needs_review: true,
  };
}

function uniqueSupportingSources(entries) {
  const seen = new Set();
  const sources = [];
  for (const entry of entries) {
    if (seen.has(entry.citation)) continue;
    seen.add(entry.citation);
    sources.push({
      citation: entry.citation,
      source_file_id: entry.source_file_id || entry.file_id,
      source_label: entry.source_label || "",
      source_short_label: entry.source_short_label || "",
      source_path: entry.source_path || "",
      original_name: entry.original_name || "",
      event: entry.event,
    });
  }
  return sources;
}

function extractClusterAmounts(entries) {
  const amounts = [];
  const seen = new Set();
  for (const entry of entries) {
    for (const amount of entryAmounts(entry)) {
      if (seen.has(amount)) continue;
      seen.add(amount);
      amounts.push(amount);
    }
  }
  return amounts.sort((a, b) => a - b);
}

function extractRupeeAmounts(text) {
  const amounts = [];
  const pattern = /\b(?:rs\.?|inr)\s*([0-9][0-9,.]*)(?:\s*(lakh|lakhs|crore|crores))?/gi;
  for (const match of text.matchAll(pattern)) {
    if (isDifferenceAmountContext(text, match.index || 0)) continue;
    const amount = parseAmountNumber(match[1], match[2]);
    if (amount !== null) amounts.push(amount);
  }
  return amounts;
}

function isDifferenceAmountContext(text, matchIndex) {
  const context = text.slice(Math.max(0, matchIndex - 32), matchIndex).toLowerCase();
  return /\b(discrepancy|difference|shortfall|gap|delta)\s+(?:of\s+)?$/.test(context);
}

function parseAmountNumber(rawNumber, unit) {
  const normalized = String(rawNumber || "").replace(/,/g, "");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  const normalizedUnit = String(unit || "").toLowerCase();
  if (normalizedUnit.startsWith("lakh")) return Math.round(number * 100000);
  if (normalizedUnit.startsWith("crore")) return Math.round(number * 10000000);
  return Math.round(number);
}

function formatRupeeAmount(amount) {
  return `Rs.${amount.toLocaleString("en-IN")}`;
}

function relatedEventTypes(a, b) {
  if (a.event_type === b.event_type) return true;
  if (isPaymentEntry(a) && isPaymentEntry(b)) return true;
  return sharedIssueTag(a, b);
}

function sharedIssueTag(a, b) {
  const aTags = new Set((a.issue_tags || []).map((tag) => String(tag).toLowerCase()));
  return (b.issue_tags || []).some((tag) => aTags.has(String(tag).toLowerCase()));
}

function normalizeEventKey(value) {
  return tokenize(value).join(" ");
}

function textSimilarity(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  return shared / Math.max(aTokens.size, bTokens.size);
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/rs\.?\s*/g, "rs")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !STOPWORDS.has(token));
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
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
    `| ${escapeMarkdownCell(entry.date_iso)} | ${escapeMarkdownCell(entry.event)} | ${escapeMarkdownCell(entry.legal_relevance)} | ${escapeMarkdownCell(formatSourceForDisplay(entry))} |`
  ));
  return `# List of Dates\n\nMatter: ${matterJson.matter_name || "Matter"}\n\nGenerated by ${ENGINE_VERSION}. Review before relying on this chronology.\n\n| Date | Event | Legal Relevance | Source |\n|---|---|---|---|\n${rows.join("\n")}\n`;
}

function formatSourceForDisplay(entry) {
  if (Array.isArray(entry.supporting_sources) && entry.supporting_sources.length) {
    return entry.supporting_sources.map(formatSupportingSourceForDisplay).join("<br>");
  }
  return formatSupportingSourceForDisplay(entry);
}

function formatSupportingSourceForDisplay(source) {
  const label = source.source_label || source.original_name || source.source_path;
  return label ? `${label} (${source.citation})` : source.citation;
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

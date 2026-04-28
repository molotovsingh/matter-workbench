import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modelPolicyMetadata, resolveProviderConfig } from "./shared/ai-provider-policy.mjs";
import { loadLocalEnv } from "./shared/local-env.mjs";
import { AI_TASKS, resolveModelPolicy } from "./shared/model-policy.mjs";
import { toPosix } from "./shared/safe-paths.mjs";

const __filename = fileURLToPath(import.meta.url);
const ENGINE_VERSION = "source-descriptors-v1-skeleton";
const SOURCE_INDEX_SCHEMA_VERSION = "source-index/v1";
const OUTPUT_JSON_NAME = "Source Index.json";
const OUTPUT_DIR_NAME = "10_Library";
const BLOCK_CHAR_LIMIT = 1200;
const MAX_BLOCKS_PER_SOURCE = 12;
const SOURCE_DESCRIPTOR_SYSTEM_INSTRUCTIONS = [
  "You create source descriptors for legal matter source documents.",
  "Follow the Source Descriptors contract: keep FILE-NNNN citations canonical, add human-readable document labels, and never overstate weak evidence.",
  "When a reliable document date is known, include that date in display_label.",
  "In display_label and short_label, write dates in lawyer-readable form such as 20 April 2026, not ISO form such as 2026-04-20.",
  "Use the strongest date_basis: email_header for email headers, court_order_date for court order headings, and file_name only when the filename is the best reliable evidence.",
  "document_date must be null or a real ISO calendar date in YYYY-MM-DD form.",
  "If source text says the document is blurred, unclear, or low confidence, do not use a filename date as the document_date; use null, date_basis unknown, needs_review true, and lower confidence.",
  "For unknown party string fields, return an empty string, not None, unknown, or N/A.",
  "Do not include FILE-NNNN identifiers in display_label or short_label; those identifiers belong only in file_id, evidence citations, and audit fields.",
  "Return JSON only in the requested schema.",
  "Use only the supplied source packets.",
];

const DOCUMENT_TYPES = new Set([
  "email",
  "letter",
  "legal_notice",
  "court_order",
  "pleading",
  "application",
  "reply",
  "affidavit",
  "agreement",
  "invoice",
  "receipt",
  "bank_record",
  "government_record",
  "photo",
  "screenshot",
  "whatsapp_chat",
  "unknown",
]);

const DATE_BASES = new Set([
  "email_header",
  "document_heading",
  "signature_block",
  "court_order_date",
  "file_name",
  "body_text",
  "inferred",
  "unknown",
]);

const SOURCE_REQUIRED_FIELDS = [
  "file_id",
  "sha256",
  "source_path",
  "display_label",
  "short_label",
  "document_type",
  "document_date",
  "date_basis",
  "parties",
  "confidence",
  "needs_review",
  "evidence",
  "warnings",
];

const PARTY_REQUIRED_FIELDS = [
  "from",
  "to",
  "cc",
  "author",
  "court",
  "judge",
  "issuing_party",
  "recipient_party",
  "deponent",
  "signatory",
];

export const SOURCE_INDEX_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sources"],
  properties: {
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: SOURCE_REQUIRED_FIELDS,
        properties: {
          file_id: { type: "string", pattern: "^FILE-\\d{4,}$" },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          source_path: { type: "string" },
          display_label: { type: "string" },
          short_label: { type: "string" },
          document_type: { type: "string", enum: [...DOCUMENT_TYPES] },
          document_date: {
            anyOf: [
              { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              { type: "null" },
            ],
          },
          date_basis: { type: "string", enum: [...DATE_BASES] },
          parties: {
            type: "object",
            additionalProperties: false,
            required: PARTY_REQUIRED_FIELDS,
            properties: {
              from: { type: "string" },
              to: { type: "array", items: { type: "string" } },
              cc: { type: "array", items: { type: "string" } },
              author: { type: "string" },
              court: { type: "string" },
              judge: { type: "string" },
              issuing_party: { type: "string" },
              recipient_party: { type: "string" },
              deponent: { type: "string" },
              signatory: { type: "string" },
            },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needs_review: { type: "boolean" },
          evidence: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["citation", "reason"],
              properties: {
                citation: { type: "string", pattern: "^FILE-\\d{4,} p\\d+\\.b\\d+$" },
                reason: { type: "string" },
              },
            },
          },
          warnings: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export async function runSourceDescriptors(options = {}) {
  const matterRoot = options.matterRoot
    ? path.resolve(options.matterRoot)
    : (process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null);
  if (!matterRoot) throw new Error("MATTER_ROOT is not set. Pass options.matterRoot or set the env var.");

  const providerSetup = resolveSourceDescriptorProvider(options);
  const provider = providerSetup.provider;

  const dryRun = Boolean(options.dryRun);
  const matterJson = await readMatterJson(matterRoot);
  const intakes = getIntakes(matterJson);
  if (!intakes.length) throw new Error("No intakes recorded in matter.json. Run /matter-init first.");

  const records = await readExtractionRecords(matterRoot, intakes);
  if (!records.length) throw new Error("No extraction records found. Run /extract before creating a source index.");

  const sourcePackets = buildSourcePackets(records);
  if (!sourcePackets.length) throw new Error("Extraction records contain no source packets to describe.");

  const matter = matterSummary(matterJson);
  const providerResponse = await provider({
    matter,
    sources: sourcePackets,
    schema: SOURCE_INDEX_OUTPUT_SCHEMA,
  });
  const descriptors = validateAndSortDescriptors(providerResponse, sourcePackets);
  const aiRun = options.aiRun || providerSetup.aiRun;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const artifact = {
    schema_version: SOURCE_INDEX_SCHEMA_VERSION,
    engine_version: ENGINE_VERSION,
    generated_at: generatedAt,
    matter,
    ai_run: aiRun,
    source_record_count: records.length,
    sources: descriptors,
  };

  const outputDir = path.join(matterRoot, OUTPUT_DIR_NAME);
  const outputJson = path.join(outputDir, OUTPUT_JSON_NAME);
  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputJson, `${JSON.stringify(artifact, null, 2)}\n`);
  }

  return {
    dryRun,
    matterRoot,
    engineVersion: ENGINE_VERSION,
    counts: {
      recordsRead: records.length,
      sourcePackets: sourcePackets.length,
      descriptors: descriptors.length,
    },
    outputPaths: {
      directory: toPosix(path.relative(matterRoot, outputDir)),
      json: toPosix(path.relative(matterRoot, outputJson)),
    },
    aiRun,
    sourcePackets,
    sources: descriptors,
    artifact,
    outputLines: [
      `> workbench.run /describe_sources${dryRun ? " (dry-run)" : ""}`,
      `[source-index] read ${records.length} extraction record(s)`,
      `[source-index] built ${sourcePackets.length} bounded source packet(s)`,
      dryRun
        ? "[source-index] dry run only. Re-run with apply to write Source Index.json."
        : `[source-index] wrote ${toPosix(path.relative(matterRoot, outputJson))}`,
    ],
  };
}

export function createOpenRouterSourceDescriptorProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  maxOutputTokens,
  model,
  providerOrder = [],
} = {}) {
  return async function openRouterSourceDescriptorProvider({ matter, sources, schema }) {
    if (!apiKey) {
      const error = new Error("OPENROUTER_API_KEY is required for source description");
      error.statusCode = 409;
      throw error;
    }
    if (!model) {
      const error = new Error("OPENROUTER_SOURCE_DESCRIPTION_MODEL is required for source description");
      error.statusCode = 409;
      throw error;
    }

    const body = {
      model,
      messages: [
        {
          role: "system",
          content: SOURCE_DESCRIPTOR_SYSTEM_INSTRUCTIONS.join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Create source descriptors for these source packets.",
            matter,
            contract_summary: {
              artifact: "10_Library/Source Index.json",
              schema_version: SOURCE_INDEX_SCHEMA_VERSION,
              descriptor_key: ["file_id", "sha256"],
              evidence_required: true,
              display_label_should_include_reliable_document_date: true,
              raw_citations_remain_canonical: true,
              source_text_beats_filename_for_date_basis: true,
              prefer_unknown_over_guess: true,
            },
            sources,
          }),
        },
      ],
      temperature: 0,
      max_tokens: maxOutputTokens,
      provider: {
        require_parameters: true,
        allow_fallbacks: false,
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "source_index",
          strict: true,
          schema,
        },
      },
    };
    if (providerOrder.length) body.provider.order = providerOrder;

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
        "http-referer": "https://github.com/molotovsingh/matter-workbench",
        "x-title": "Matter Workbench Source Descriptors",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `OpenRouter returned ${response.status}`);
      error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
      throw error;
    }

    return parseOpenRouterJsonContent(payload);
  };
}

function resolveSourceDescriptorProvider(options) {
  const injectedProvider = options.provider || options.sourceDescriptorProvider;
  if (typeof injectedProvider === "function") {
    return {
      provider: injectedProvider,
      aiRun: options.aiRun || fakeProviderMetadata(),
    };
  }

  const env = options.env || process.env;
  const policy = resolveModelPolicy(AI_TASKS.SOURCE_DESCRIPTION, { env });
  const model = options.model || policy.model;
  if (!model) {
    throw new Error("sourceDescriptorProvider is required unless OPENROUTER_SOURCE_DESCRIPTION_MODEL is configured.");
  }
  const providerConfig = resolveProviderConfig(policy, {
    endpoint: options.endpoint,
    maxOutputTokens: options.maxOutputTokens,
    model,
    providerOrder: options.providerOrder,
  });
  return {
    provider: createOpenRouterSourceDescriptorProvider({
      apiKey: options.apiKey || env.OPENROUTER_API_KEY,
      endpoint: providerConfig.endpoint,
      fetchImpl: options.fetchImpl || fetch,
      maxOutputTokens: providerConfig.maxOutputTokens,
      model: providerConfig.model,
      providerOrder: providerConfig.providerOrder,
    }),
    aiRun: options.aiRun || modelPolicyMetadata(policy, providerConfig),
  };
}

function parseOpenRouterJsonContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch (parseError) {
      const error = new Error(`OpenRouter response did not include valid JSON message content: ${parseError.message}`);
      error.statusCode = 502;
      throw error;
    }
  }
  if (content && typeof content === "object") return content;
  const error = new Error("OpenRouter response did not include JSON message content");
  error.statusCode = 502;
  throw error;
}

export function buildSourcePackets(records) {
  const packets = [];
  const seen = new Set();
  for (const record of records) {
    if (!record?.file_id) continue;
    if (seen.has(record.file_id)) throw new Error(`Duplicate extraction record for ${record.file_id}`);
    seen.add(record.file_id);

    const blocks = collectSourceBlocks(record);
    packets.push({
      file_id: record.file_id,
      sha256: record.sha256 || "",
      source_path: record.source_path || "",
      original_name: path.basename(record.source_path || ""),
      extraction: {
        engine: record.engine || "",
        page_count: record.page_count ?? (Array.isArray(record.pages) ? record.pages.length : 0),
        warnings: Array.isArray(record.warnings) ? record.warnings : [],
      },
      blocks,
    });
  }
  return packets.sort((a, b) => a.file_id.localeCompare(b.file_id));
}

export function validateAndSortDescriptors(providerResponse, sourcePackets) {
  if (!providerResponse || !Array.isArray(providerResponse.sources)) {
    const error = new Error("Source descriptor provider returned an invalid payload: expected sources[]");
    error.statusCode = 502;
    throw error;
  }
  if (providerResponse.sources.length !== sourcePackets.length) {
    const error = new Error(`Expected ${sourcePackets.length} source descriptors, got ${providerResponse.sources.length}`);
    error.statusCode = 502;
    throw error;
  }

  const packetByFileId = new Map(sourcePackets.map((packet) => [packet.file_id, packet]));
  const seen = new Set();
  const descriptors = [];
  for (const descriptor of providerResponse.sources) {
    validateDescriptorShape(descriptor);
    const packet = packetByFileId.get(descriptor.file_id);
    if (!packet) throwProviderError(`Unexpected source descriptor file_id: ${descriptor.file_id}`);
    if (seen.has(descriptor.file_id)) throwProviderError(`Duplicate source descriptor for ${descriptor.file_id}`);
    seen.add(descriptor.file_id);
    if (descriptor.sha256 !== packet.sha256) throwProviderError(`sha256 mismatch for ${descriptor.file_id}`);
    if (descriptor.source_path !== packet.source_path) throwProviderError(`source_path mismatch for ${descriptor.file_id}`);
    validateDescriptorEvidence(descriptor, packet);
    descriptors.push(normalizeDescriptor(descriptor));
  }

  return descriptors.sort((a, b) => a.file_id.localeCompare(b.file_id));
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
        // /doctor owns invalid extraction-record reporting; this skeleton skips bad records.
      }
    }
  }
  return records.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id)));
}

function collectSourceBlocks(record) {
  const blocks = [];
  for (const page of record.pages || []) {
    for (const block of page.blocks || []) {
      if (!block?.id || typeof block.text !== "string" || !block.text.trim()) continue;
      blocks.push({
        citation: `${record.file_id} ${block.id}`,
        page: page.page,
        block_id: block.id,
        block_type: block.type || "",
        confidence: page.confidence_avg ?? 1,
        needs_review: Boolean(page.needs_review),
        text: truncateText(block.text),
      });
    }
  }
  return selectLabelRelevantBlocks(blocks);
}

function selectLabelRelevantBlocks(blocks) {
  const selected = [];
  for (const block of blocks) {
    if (selected.length >= MAX_BLOCKS_PER_SOURCE) break;
    selected.push(block);
  }
  return selected;
}

function truncateText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > BLOCK_CHAR_LIMIT
    ? `${normalized.slice(0, BLOCK_CHAR_LIMIT)} [block truncated for source descriptor input]`
    : normalized;
}

function validateDescriptorShape(descriptor) {
  assertObject(descriptor, "source descriptor");
  for (const field of SOURCE_REQUIRED_FIELDS) {
    if (!(field in descriptor)) throwProviderError(`Missing required source field ${field}`);
  }
  assertNonEmptyString(descriptor.file_id, "file_id");
  if (!/^FILE-\d{4,}$/.test(descriptor.file_id)) throwProviderError(`Invalid file_id: ${descriptor.file_id}`);
  assertNonEmptyString(descriptor.sha256, `sha256 for ${descriptor.file_id}`);
  if (!/^[0-9a-f]{64}$/.test(descriptor.sha256)) throwProviderError(`Invalid sha256 for ${descriptor.file_id}`);
  assertNonEmptyString(descriptor.source_path, `source_path for ${descriptor.file_id}`);
  assertNonEmptyString(descriptor.display_label, `display_label for ${descriptor.file_id}`);
  assertNonEmptyString(descriptor.short_label, `short_label for ${descriptor.file_id}`);
  validateHumanLabel(descriptor.display_label, `display_label for ${descriptor.file_id}`);
  validateHumanLabel(descriptor.short_label, `short_label for ${descriptor.file_id}`);
  if (!DOCUMENT_TYPES.has(descriptor.document_type)) throwProviderError(`Invalid document_type for ${descriptor.file_id}`);
  if (descriptor.document_date !== null && !isValidIsoDate(descriptor.document_date)) {
    throwProviderError(`Invalid document_date for ${descriptor.file_id}`);
  }
  if (!DATE_BASES.has(descriptor.date_basis)) throwProviderError(`Invalid date_basis for ${descriptor.file_id}`);
  if (typeof descriptor.confidence !== "number" || !Number.isFinite(descriptor.confidence)
    || descriptor.confidence < 0 || descriptor.confidence > 1) {
    throwProviderError(`Invalid confidence for ${descriptor.file_id}`);
  }
  if (typeof descriptor.needs_review !== "boolean") throwProviderError(`Invalid needs_review for ${descriptor.file_id}`);
  validateParties(descriptor.parties, descriptor.file_id);
  validateWarnings(descriptor.warnings, descriptor.file_id);
}

function validateParties(parties, fileId) {
  assertObject(parties, `parties for ${fileId}`);
  const allowed = new Set(PARTY_REQUIRED_FIELDS);
  for (const field of PARTY_REQUIRED_FIELDS) {
    if (!(field in parties)) throwProviderError(`Missing parties.${field} for ${fileId}`);
  }
  for (const field of Object.keys(parties)) {
    if (!allowed.has(field)) throwProviderError(`Unexpected parties.${field} for ${fileId}`);
  }
  for (const field of PARTY_REQUIRED_FIELDS) {
    if (field === "to" || field === "cc") {
      if (!Array.isArray(parties[field]) || !parties[field].every((value) => typeof value === "string")) {
        throwProviderError(`parties.${field} must be an array of strings for ${fileId}`);
      }
    } else if (typeof parties[field] !== "string") {
      throwProviderError(`parties.${field} must be a string for ${fileId}`);
    } else if (/^(none|unknown|n\/a)$/i.test(parties[field].trim())) {
      throwProviderError(`parties.${field} should be empty instead of ${parties[field]} for ${fileId}`);
    }
  }
}

function validateWarnings(warnings, fileId) {
  if (!Array.isArray(warnings) || !warnings.every((warning) => typeof warning === "string")) {
    throwProviderError(`warnings must be an array of strings for ${fileId}`);
  }
}

function validateHumanLabel(label, fieldLabel) {
  if (/\bFILE-\d{4,}\b/.test(label)) {
    throwProviderError(`${fieldLabel} must not include FILE-NNNN identifiers`);
  }
}

function validateDescriptorEvidence(descriptor, packet) {
  if (!Array.isArray(descriptor.evidence) || !descriptor.evidence.length) {
    throwProviderError(`Missing evidence for ${descriptor.file_id}`);
  }
  const validCitations = new Set(packet.blocks.map((block) => block.citation));
  for (const evidence of descriptor.evidence) {
    assertObject(evidence, `evidence for ${descriptor.file_id}`);
    assertNonEmptyString(evidence.citation, `evidence.citation for ${descriptor.file_id}`);
    assertNonEmptyString(evidence.reason, `evidence.reason for ${descriptor.file_id}`);
    if (!/^FILE-\d{4,} p\d+\.b\d+$/.test(evidence.citation)) {
      throwProviderError(`Invalid evidence citation for ${descriptor.file_id}: ${evidence.citation}`);
    }
    if (!validCitations.has(evidence.citation)) {
      throwProviderError(`Evidence citation ${evidence.citation} does not belong to ${descriptor.file_id}`);
    }
  }
}

function normalizeDescriptor(descriptor) {
  return {
    file_id: descriptor.file_id,
    sha256: descriptor.sha256,
    source_path: descriptor.source_path,
    display_label: descriptor.display_label.trim(),
    short_label: descriptor.short_label.trim(),
    document_type: descriptor.document_type,
    document_date: descriptor.document_date,
    date_basis: descriptor.date_basis,
    parties: {
      from: descriptor.parties.from,
      to: [...descriptor.parties.to],
      cc: [...descriptor.parties.cc],
      author: descriptor.parties.author,
      court: descriptor.parties.court,
      judge: descriptor.parties.judge,
      issuing_party: descriptor.parties.issuing_party,
      recipient_party: descriptor.parties.recipient_party,
      deponent: descriptor.parties.deponent,
      signatory: descriptor.parties.signatory,
    },
    confidence: descriptor.confidence,
    needs_review: descriptor.needs_review,
    evidence: descriptor.evidence.map((evidence) => ({
      citation: evidence.citation,
      reason: evidence.reason.trim(),
    })),
    warnings: [...descriptor.warnings],
  };
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

function fakeProviderMetadata() {
  return {
    policyVersion: "source-index-skeleton/v1",
    task: "source_description",
    tier: "source_description",
    provider: "fake-provider",
    model: "injected-test-provider",
    maxOutputTokens: null,
    fallback: "none",
  };
}

function isValidIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throwProviderError(`${label} must be an object`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throwProviderError(`${label} must be a non-empty string`);
}

function throwProviderError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  throw error;
}

if (process.argv[1] === __filename) {
  const dryRun = !process.argv.includes("--apply");
  await loadLocalEnv({ appDir: path.dirname(__filename), override: false });
  runSourceDescriptors({ dryRun })
    .then((result) => {
      console.log(result.outputLines.join("\n"));
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}

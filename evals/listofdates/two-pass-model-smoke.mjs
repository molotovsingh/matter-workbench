#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../../shared/local-env.mjs";
import { fetchProviderJsonWithTimeout, parseOpenRouterJsonMessage } from "../../shared/provider-http.mjs";
import { extractResponsesOutputText, fetchResponses } from "../../shared/responses-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_STRICT_SCHEMA_UNSUPPORTED_KEYS = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "multipleOf",
  "pattern",
]);

const CANDIDATE_TYPES = [
  "matter_fact",
  "procedural_step",
  "deadline",
  "payment_or_amount",
  "notice_or_communication",
  "evidence_or_inspection",
  "authority_or_precedent",
  "ocr_or_metadata_noise",
  "other",
];

const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "date_iso",
          "date_text",
          "event_candidate",
          "legal_materiality",
          "source_label",
          "citation",
          "source_excerpt",
          "candidate_type",
          "party_posture",
          "same_fact_hint",
          "date_uncertainty",
          "ocr_suspicion",
          "needs_review",
          "confidence",
        ],
        properties: {
          date_iso: { type: "string" },
          date_text: { type: "string" },
          event_candidate: { type: "string" },
          legal_materiality: { type: "string" },
          source_label: { type: "string" },
          citation: { type: "string" },
          source_excerpt: { type: "string" },
          candidate_type: { type: "string", enum: CANDIDATE_TYPES },
          party_posture: { type: "string" },
          same_fact_hint: { type: "string" },
          date_uncertainty: { type: "string" },
          ocr_suspicion: { type: "string" },
          needs_review: { type: "boolean" },
          confidence: { type: "number" },
        },
      },
    },
  },
};

const POLISHED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["editor_summary", "entries", "dropped_candidates"],
  properties: {
    editor_summary: { type: "string" },
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "date_iso",
          "date_text",
          "event",
          "legal_relevance",
          "supporting_sources",
          "merged_candidate_ids",
          "needs_review",
          "editor_note",
        ],
        properties: {
          date_iso: { type: "string" },
          date_text: { type: "string" },
          event: { type: "string" },
          legal_relevance: { type: "string" },
          supporting_sources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["source_label", "citation"],
              properties: {
                source_label: { type: "string" },
                citation: { type: "string" },
              },
            },
          },
          merged_candidate_ids: {
            type: "array",
            items: { type: "string" },
          },
          needs_review: { type: "boolean" },
          editor_note: { type: "string" },
        },
      },
    },
    dropped_candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_ids", "date_iso", "event_candidate", "reason"],
        properties: {
          candidate_ids: {
            type: "array",
            items: { type: "string" },
          },
          date_iso: { type: "string" },
          event_candidate: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

const PASS1_SYSTEM = [
  "You are an evidence harvester for an Indian legal chronology.",
  "This is the verbose first pass. Your job is high recall and source fidelity, not elegance.",
  "Extract every potentially material dated event candidate from the supplied source blocks.",
  "Keep duplicates if the same fact appears in multiple sources, pleadings, orders, appeal papers, affidavits, or revision papers.",
  "Do not merge candidates. Do not write a final chronology. Do not discard a candidate just because it is messy.",
  "Every candidate must cite exactly one supplied source block citation in FILE-NNNN pX.bY form.",
  "Use only supplied text. Do not infer missing facts, parties, dates, or legal conclusions.",
  "Be verbose in the candidate ledger: include a source_excerpt long enough for the editor pass to audit the date, fact, and uncertainty without returning to the raw document.",
  "Explain legal_materiality in practical lawyer terms, including whether the event helps the client, hurts the client, is neutral procedure, or is only an authority/precedent date.",
  "Keep foundation and collateral-proceeding dates if they explain ownership, authority, limitation, parallel litigation, appeal delay, or enforceability.",
  "Use same_fact_hint to help the editor merge candidates later, for example agreement execution, delivery deadline, expert inspection, forum order, appeal order, revision filing.",
  "If a date is partial, OCR-corrupted, internally inconsistent, or suspicious, keep the candidate, set needs_review true, and explain date_uncertainty or ocr_suspicion.",
  "Classify pure cited precedent/case-law dates as authority_or_precedent, not as matter_fact.",
  "Never expose source_path, original filename, technical working-copy filename, or FILE-NNNN__filename in source_label.",
  "Return strict JSON only.",
].join(" ");

const PASS2_SYSTEM = [
  "You are a senior Indian litigation chronology editor.",
  "You receive a verbose, high-recall candidate ledger with citations and excerpts.",
  "Create the lawyer-facing, client-perspective List of Dates.",
  "Merge same-date/same-fact variants into one row and preserve all useful supporting citations.",
  "Do not create separate rows for minor wording differences across complaint, affidavit, order, appeal, revision petition, or written version.",
  "If the same fact appears in several sources, write one event and list all supporting citations.",
  "Drop pure precedent or case-law decision dates unless the date is itself part of this matter's procedural history or strategically necessary to understand a party's argument.",
  "If candidate dates conflict, keep the conflict only if legally important, mark needs_review true, and explain the conflict in editor_note.",
  "If date text appears OCR-corrupted or conflicts with the surrounding chronology, keep only if important, mark needs_review true, and explain in editor_note.",
  "Do not invent new facts. Do not add an event unless it is grounded in one or more candidate citations.",
  "Do not mention source_path, original filenames, technical filenames, or internal candidate details except merged_candidate_ids.",
  "Use readable source labels plus raw FILE-NNNN pX.bY citations.",
  "Do not overstate legal conclusions. Use supports, rebuts, corroborates, records, preserves objection, shows notice, or may support subject to proof.",
  "Return strict JSON only.",
].join(" ");

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

await run();

async function run() {
  const outDir = options.outDir
    ? path.resolve(options.outDir)
    : path.join(REPO_ROOT, ".local", "listofdates-two-pass", options.runLabel || defaultRunLabel(options));

  await mkdir(outDir, { recursive: true });

  const env = { ...process.env };
  await loadLocalEnv({ appDir: REPO_ROOT, targetEnv: env, override: true });
  requireProviderKeys(env, options);

  if (options.candidatesFile) {
    await runPass2FromCandidates({ outDir, env });
    return;
  }

  const matterRoot = options.matterRoot ? path.resolve(options.matterRoot) : "";
  if (!matterRoot) throw new Error("--matter-root is required unless --candidates-file is supplied");

  const matter = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  const sourceIndex = await readSourceIndex(matterRoot);
  const labels = new Map((sourceIndex.sources || []).map((source) => [
    source.file_id,
    source.display_label || source.short_label || source.file_id,
  ]));

  const sourceBlocks = await readSourceBlocks({
    matterRoot,
    labels,
    includeAllBlocks: options.includeAllBlocks,
    sourceTextChars: options.sourceTextChars,
  });
  const chunks = chunkBlocks(sourceBlocks, options.chunkCharLimit);
  const candidates = [];
  const pass1Runs = [];

  console.log(`[two-pass] matter ${matter.matter_name || matterRoot}`);
  console.log(`[two-pass] pass1 ${formatProviderModel(resolveProvider(options.pass1Provider, options.pass1Model), options.pass1Model)}; pass2 ${formatProviderModel(resolveProvider(options.pass2Provider, options.pass2Model), options.pass2Model)}`);
  console.log(`[two-pass] source blocks ${sourceBlocks.length}, chunks ${chunks.length}`);
  console.log(`[two-pass] output ${outDir}`);

  for (const [index, chunk] of chunks.entries()) {
    const response = await requestJson({
      apiKey: env.OPENAI_API_KEY,
      model: options.pass1Model,
      system: PASS1_SYSTEM,
      schemaName: "chronology_candidate_ledger",
      schema: CANDIDATE_SCHEMA,
      maxOutputTokens: options.pass1MaxOutputTokens,
      user: {
        matter: matterSummary(matter),
        chunkIndex: index + 1,
        chunkCount: chunks.length,
        instructions: [
          "Extract candidate dated events only from these source blocks.",
          "This first pass should be verbose enough for a second-pass editor to work from the candidate ledger.",
          "Keep duplicates and conflicting dates; the editor pass will merge or drop them.",
        ],
        sourceBlocks: chunk,
      },
    });
    const chunkCandidates = Array.isArray(response.json.candidates) ? response.json.candidates : [];
    for (const [candidateIndex, candidate] of chunkCandidates.entries()) {
      candidates.push({
        candidate_id: `C${String(index + 1).padStart(2, "0")}-${String(candidateIndex + 1).padStart(3, "0")}`,
        chunkIndex: index + 1,
        ...candidate,
      });
    }
    pass1Runs.push(response.meta);
    console.log(`[two-pass] pass1 chunk ${index + 1}/${chunks.length}: ${chunkCandidates.length} candidate(s)`);
  }

  const candidatesDocument = {
    schema_version: "chronology-candidates/v1-smoke",
    generated_at: new Date().toISOString(),
    matter: matterSummary(matter),
    pass1: {
      provider: resolveProvider(options.pass1Provider, options.pass1Model),
      model: options.pass1Model,
      maxOutputTokens: options.pass1MaxOutputTokens,
      sourceTextChars: options.sourceTextChars,
      includeAllBlocks: options.includeAllBlocks,
      chunkCharLimit: options.chunkCharLimit,
      chunkCount: chunks.length,
    },
    source_block_count: sourceBlocks.length,
    candidates,
    runs: pass1Runs,
  };
  await writeJson(path.join(outDir, "candidates.json"), candidatesDocument);
  if (options.pass1Only) {
    console.log(`[two-pass] pass1-only candidates ${candidates.length}`);
    console.log(`[two-pass] candidates ${path.join(outDir, "candidates.json")}`);
    return;
  }

  await runPass2({
    outDir,
    env,
    matter: matterSummary(matter),
    candidatesDocument,
    sourceBlockCount: sourceBlocks.length,
    chunkCount: chunks.length,
    renderMatter: matter,
  });
}

async function runPass2FromCandidates({ outDir, env }) {
  const candidatesDocument = JSON.parse(await readFile(path.resolve(options.candidatesFile), "utf8"));
  const matter = candidatesDocument.matter || {};
  const sourceBlockCount = candidatesDocument.source_block_count || 0;
  const chunkCount = candidatesDocument.pass1?.chunkCount
    || Math.max(0, ...((candidatesDocument.candidates || []).map((candidate) => Number(candidate.chunkIndex) || 0)));
  console.log(`[two-pass] candidates ${options.candidatesFile}`);
  console.log(`[two-pass] pass1 ${formatProviderModel(candidatesDocument.pass1?.provider, candidatesDocument.pass1?.model || "unknown")}; pass2 ${formatProviderModel(resolveProvider(options.pass2Provider, options.pass2Model), options.pass2Model)}`);
  console.log(`[two-pass] candidates ${(candidatesDocument.candidates || []).length}, chunks ${chunkCount}`);
  console.log(`[two-pass] output ${outDir}`);
  await runPass2({
    outDir,
    env,
    matter,
    candidatesDocument,
    sourceBlockCount,
    chunkCount,
    renderMatter: matter,
  });
}

async function runPass2({ outDir, env, matter, candidatesDocument, sourceBlockCount, chunkCount, renderMatter }) {
  const candidates = Array.isArray(candidatesDocument.candidates) ? candidatesDocument.candidates : [];
  const pass2 = await requestJson({
    apiKey: env.OPENAI_API_KEY,
    model: options.pass2Model,
    system: PASS2_SYSTEM,
    schemaName: "polished_list_of_dates",
    schema: POLISHED_SCHEMA,
    maxOutputTokens: options.pass2MaxOutputTokens,
    user: {
      matter: matterSummary(matter),
      rules: [
        "Merge duplicates into lawyer-facing rows.",
        "Drop pure precedent dates unless necessary to this matter history.",
        "Preserve readable labels and raw citations.",
        "Mark suspicious OCR/conflicting dates needs_review.",
        "Use merged_candidate_ids so the output remains auditable against candidates.json.",
      ],
      candidates,
    },
  });

  const polishedDocument = {
    schema_version: "polished-list-of-dates/v1-smoke",
    generated_at: new Date().toISOString(),
    matter,
    pass2: {
      provider: resolveProvider(options.pass2Provider, options.pass2Model),
      model: options.pass2Model,
      maxOutputTokens: options.pass2MaxOutputTokens,
    },
    ai_run: pass2.meta,
    ...pass2.json,
  };
  await writeJson(path.join(outDir, "polished.json"), polishedDocument);
  await writeFile(
    path.join(outDir, "List of Dates.md"),
    renderMarkdown({
      matter: renderMatter,
      modelLabel: `${formatProviderModel(candidatesDocument.pass1?.provider, candidatesDocument.pass1?.model || options.pass1Model)} -> ${formatProviderModel(resolveProvider(options.pass2Provider, options.pass2Model), options.pass2Model)}`,
      polished: polishedDocument,
    }),
  );

  const report = buildReport({
    matter,
    outDir,
    sourceBlockCount,
    chunkCount,
    candidatesDocument,
    polishedDocument,
  });
  await writeJson(path.join(outDir, "report.json"), report);

  console.log(`[two-pass] pass2 polished rows ${report.polishedEntries}, dropped ${report.droppedCandidates}`);
  console.log(JSON.stringify(report, null, 2));
}

async function readSourceIndex(matterRoot) {
  try {
    return JSON.parse(await readFile(path.join(matterRoot, "10_Library", "Source Index.json"), "utf8"));
  } catch {
    return { sources: [] };
  }
}

async function readSourceBlocks({ matterRoot, labels, includeAllBlocks, sourceTextChars }) {
  const matter = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
  const intakes = Array.isArray(matter.intakes) ? matter.intakes : [];
  const blocks = [];
  for (const intake of intakes) {
    const extractedDir = path.join(matterRoot, intake.intake_dir, "_extracted");
    let files = [];
    try {
      files = (await readdir(extractedDir)).filter((file) => /^FILE-\d+\.json$/.test(file)).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const record = JSON.parse(await readFile(path.join(extractedDir, file), "utf8"));
      const sourceLabel = labels.get(record.file_id) || record.file_id;
      for (const page of record.pages || []) {
        for (const block of page.blocks || []) {
          const text = compact(block.text);
          if (!text || text.length < 12) continue;
          if (!includeAllBlocks && !isChronologyCandidateText(text)) continue;
          blocks.push({
            citation: `${record.file_id} p${page.page}.b${String(block.id || "").replace(/^p\d+\.b/, "")}`,
            source_label: sourceLabel,
            page: page.page,
            block_id: block.id || "",
            block_type: block.type || "",
            page_needs_review: Boolean(page.needs_review),
            text: text.slice(0, sourceTextChars),
          });
        }
      }
    }
  }
  return blocks;
}

function isChronologyCandidateText(text) {
  return /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{2,4}|20\d{2}|19\d{2})\b/i.test(text)
    || /\b(?:agreement|complaint|appeal|revision|petition|order|judgment|notice|affidavit|inspection|expert|possession|delivery|deadline|revocation|occupancy|certificate|forum|commission|NCDRC|payment|receipt|cause of action|limitation)\b/i.test(text);
}

function chunkBlocks(sourceBlocks, limit) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const block of sourceBlocks) {
    const blockSize = JSON.stringify(block).length + 2;
    if (current.length && size + blockSize > limit) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += blockSize;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function requestJson({ apiKey, model, system, user, schemaName, schema, maxOutputTokens }) {
  const provider = schemaName === "chronology_candidate_ledger"
    ? resolveProvider(options.pass1Provider, model)
    : resolveProvider(options.pass2Provider, model);
  if (provider === "openrouter") {
    return requestOpenRouterJson({
      apiKey: options.openRouterApiKey,
      endpoint: options.openRouterEndpoint,
      model,
      system,
      user,
      schemaName,
      schema,
      maxOutputTokens,
    });
  }
  return requestOpenAiJson({ apiKey, model, system, user, schemaName, schema, maxOutputTokens });
}

async function requestOpenAiJson({ apiKey, model, system, user, schemaName, schema, maxOutputTokens }) {
  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await fetchResponses({
        apiKey,
        body: {
          model,
          max_output_tokens: maxOutputTokens,
          input: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(user) },
          ],
          text: {
            format: {
              type: "json_schema",
              name: schemaName,
              strict: true,
              schema,
            },
          },
        },
      });
      const outputText = extractResponsesOutputText(payload);
      if (!outputText) throw new Error(`No output text returned for ${schemaName}`);
      return {
        json: JSON.parse(outputText),
        meta: {
          requestedModel: model,
          returnedModel: payload.model || "",
          status: payload.status || "",
          usage: payload.usage || null,
          provider: "openai-direct",
          attempts: attempt,
        },
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderError(error) || attempt === maxAttempts) break;
      const delayMs = 1500 * attempt;
      console.warn(`[two-pass] retrying ${schemaName} after provider error (${attempt}/${maxAttempts}): ${error.message}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function requestOpenRouterJson({ apiKey, endpoint, model, system, user, schemaName, schema, maxOutputTokens }) {
  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await fetchProviderJsonWithTimeout({
        fetchImpl: fetch,
        endpoint,
        apiKey,
        timeoutMs: options.openRouterTimeoutMs,
        extraHeaders: {
          "http-referer": "https://github.com/molotovsingh/matter-workbench",
          "x-title": "Matter Workbench List of Dates Two-Pass Smoke",
        },
        timeoutMessage: `OpenRouter ${schemaName} request timed out after ${options.openRouterTimeoutMs}ms`,
        body: {
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(user) },
          ],
          max_tokens: maxOutputTokens,
          provider: {
            require_parameters: true,
            allow_fallbacks: false,
          },
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema: stripUnsupportedJsonSchemaKeywords(schema),
            },
          },
        },
      });
      return {
        json: parseOpenRouterJsonMessage(payload, `OpenRouter ${schemaName}`),
        meta: {
          requestedModel: model,
          returnedModel: payload.model || "",
          status: "",
          usage: payload.usage || null,
          provider: "openrouter",
          returnedProvider: payload.provider || payload.provider_name || payload.choices?.[0]?.provider || "",
          attempts: attempt,
        },
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderError(error) || attempt === maxAttempts) break;
      const delayMs = 1500 * attempt;
      console.warn(`[two-pass] retrying OpenRouter ${schemaName} after provider error (${attempt}/${maxAttempts}): ${error.message}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function stripUnsupportedJsonSchemaKeywords(value) {
  if (Array.isArray(value)) return value.map(stripUnsupportedJsonSchemaKeywords);
  if (!value || typeof value !== "object") return value;
  const copy = {};
  for (const [key, child] of Object.entries(value)) {
    if (OPENROUTER_STRICT_SCHEMA_UNSUPPORTED_KEYS.has(key)) continue;
    copy[key] = stripUnsupportedJsonSchemaKeywords(child);
  }
  return copy;
}

function isRetryableProviderError(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  return status >= 500 || /fetch failed|network|ECONNRESET|ETIMEDOUT|timeout/i.test(error?.message || "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireProviderKeys(env, currentOptions) {
  const providers = new Set();
  if (!currentOptions.candidatesFile) {
    providers.add(resolveProvider(currentOptions.pass1Provider, currentOptions.pass1Model));
  }
  if (!currentOptions.pass1Only) {
    providers.add(resolveProvider(currentOptions.pass2Provider, currentOptions.pass2Model));
  }
  if (providers.has("openai") && !env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for OpenAI-direct two-pass list-of-dates smoke calls");
  }
  if (providers.has("openrouter") && !env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required for OpenRouter two-pass list-of-dates smoke calls");
  }
  currentOptions.openAiApiKey = env.OPENAI_API_KEY || "";
  currentOptions.openRouterApiKey = env.OPENROUTER_API_KEY || "";
}

function resolveProvider(provider, model) {
  const value = String(provider || "auto").trim().toLowerCase();
  if (value === "openai" || value === "openai-direct") return "openai";
  if (value === "openrouter") return "openrouter";
  if (value && value !== "auto") throw new Error(`Unsupported provider: ${provider}`);
  return String(model || "").includes("/") ? "openrouter" : "openai";
}

function formatProviderModel(provider, model) {
  const normalized = provider === "openrouter"
    ? "openrouter"
    : provider === "openai" ? "openai-direct" : provider || "";
  return normalized ? `${normalized} / ${model}` : model;
}

function buildReport({ matter, outDir, sourceBlockCount, chunkCount, candidatesDocument, polishedDocument }) {
  const entries = Array.isArray(polishedDocument.entries) ? polishedDocument.entries : [];
  const candidates = Array.isArray(candidatesDocument.candidates) ? candidatesDocument.candidates : [];
  return {
    schema_version: "listofdates-two-pass-smoke-report/v1",
    matter: matterSummary(matter),
    outputDir: outDir,
    pass1Provider: candidatesDocument.pass1.provider || resolveProvider(options.pass1Provider, candidatesDocument.pass1.model),
    pass1Model: candidatesDocument.pass1.model,
    pass2Provider: polishedDocument.pass2.provider || resolveProvider(options.pass2Provider, polishedDocument.pass2.model),
    pass2Model: polishedDocument.pass2.model,
    pass1ReturnedModels: unique((candidatesDocument.runs || []).map((run) => run.returnedModel).filter(Boolean)),
    pass2ReturnedModel: polishedDocument.ai_run?.returnedModel || "",
    sourceBlocks: sourceBlockCount,
    chunks: chunkCount,
    candidates: candidates.length,
    candidateTypeCounts: countBy(candidates, "candidate_type"),
    candidateNeedsReview: candidates.filter((candidate) => candidate.needs_review).length,
    polishedEntries: entries.length,
    droppedCandidates: polishedDocument.dropped_candidates?.length || 0,
    duplicateDateClusters: duplicateDateClusters(entries),
    needsReview: entries.filter((entry) => entry.needs_review).length,
    technicalLabelLeaks: countTechnicalLeaks(entries),
    precedentLikeRows: entries.filter((entry) => /precedent|Supreme Court|NCDRC|High Court|decision|authority|cited/i.test(`${entry.event} ${entry.legal_relevance}`)).length,
    usage: summarizeUsage([...(candidatesDocument.runs || []), polishedDocument.ai_run]),
  };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function summarizeUsage(runs) {
  const usage = { input: 0, output: 0, total: 0 };
  for (const run of runs) {
    const details = run?.usage || {};
    usage.input += details.input_tokens || details.prompt_tokens || 0;
    usage.output += details.output_tokens || details.completion_tokens || 0;
    usage.total += details.total_tokens || 0;
  }
  return usage;
}

function duplicateDateClusters(entries) {
  const counts = {};
  for (const entry of entries) counts[entry.date_iso] = (counts[entry.date_iso] || 0) + 1;
  return Object.entries(counts).filter(([, count]) => count > 1);
}

function countTechnicalLeaks(entries) {
  return entries.filter((entry) => /00_Inbox|By Type|Source Files|FILE-\d{4}__|\bdg\d+\.pdf\b|petition1\.pdf/.test(JSON.stringify(entry))).length;
}

function renderMarkdown({ matter, modelLabel, polished }) {
  const rows = (polished.entries || []).map((entry) => {
    const sources = (entry.supporting_sources || [])
      .map((source) => `${source.source_label} (${source.citation})`)
      .join("<br>");
    return `| ${escapeCell(entry.date_iso)} | ${escapeCell(entry.event)} | ${escapeCell(entry.legal_relevance)} | ${escapeCell(sources)} | ${entry.needs_review ? "Yes" : "No"} | ${escapeCell(entry.editor_note)} |`;
  });
  return [
    "# Two-Pass List of Dates Smoke",
    "",
    `Matter: ${matter.matter_name || "Matter"}`,
    "",
    `Models: ${modelLabel}`,
    "",
    polished.editor_summary ? `Editor summary: ${polished.editor_summary}` : "",
    "",
    "| Date | Event | Legal Relevance | Source | Review | Editor Note |",
    "|---|---|---|---|---|---|",
    rows.join("\n"),
    "",
  ].join("\n");
}

function matterSummary(matterJson) {
  return {
    matter_name: matterJson.matter_name || "",
    client_name: matterJson.client_name || "",
    opposite_party: matterJson.opposite_party || "",
    matter_type: matterJson.matter_type || "",
    jurisdiction: matterJson.jurisdiction || "",
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {
    matterRoot: "",
    candidatesFile: "",
    outDir: "",
    runLabel: "",
    pass1Model: process.env.LISTOFDATES_PASS1_MODEL || "gpt-5.4-mini",
    pass2Model: process.env.LISTOFDATES_PASS2_MODEL || "gpt-5.4",
    pass1Provider: process.env.LISTOFDATES_PASS1_PROVIDER || "auto",
    pass2Provider: process.env.LISTOFDATES_PASS2_PROVIDER || "auto",
    pass1MaxOutputTokens: Number(process.env.LISTOFDATES_PASS1_MAX_OUTPUT_TOKENS || 9000),
    pass2MaxOutputTokens: Number(process.env.LISTOFDATES_PASS2_MAX_OUTPUT_TOKENS || 12000),
    openRouterEndpoint: process.env.OPENROUTER_ENDPOINT || DEFAULT_OPENROUTER_ENDPOINT,
    openRouterTimeoutMs: Number(process.env.LISTOFDATES_OPENROUTER_TIMEOUT_MS || 180000),
    chunkCharLimit: Number(process.env.LISTOFDATES_TWO_PASS_CHUNK_CHAR_LIMIT || 18000),
    sourceTextChars: Number(process.env.LISTOFDATES_TWO_PASS_SOURCE_TEXT_CHARS || 2400),
    includeAllBlocks: false,
    pass1Only: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--matter-root") {
      options.matterRoot = argv[++index] || "";
    } else if (arg === "--candidates-file") {
      options.candidatesFile = argv[++index] || "";
    } else if (arg === "--out-dir") {
      options.outDir = argv[++index] || "";
    } else if (arg === "--run-label") {
      options.runLabel = argv[++index] || "";
    } else if (arg === "--pass1-model") {
      options.pass1Model = argv[++index] || "";
    } else if (arg === "--pass2-model") {
      options.pass2Model = argv[++index] || "";
    } else if (arg === "--pass1-provider") {
      options.pass1Provider = argv[++index] || "";
    } else if (arg === "--pass2-provider") {
      options.pass2Provider = argv[++index] || "";
    } else if (arg === "--pass1-max-output-tokens") {
      options.pass1MaxOutputTokens = Number(argv[++index]);
    } else if (arg === "--pass2-max-output-tokens") {
      options.pass2MaxOutputTokens = Number(argv[++index]);
    } else if (arg === "--chunk-char-limit") {
      options.chunkCharLimit = Number(argv[++index]);
    } else if (arg === "--source-text-chars") {
      options.sourceTextChars = Number(argv[++index]);
    } else if (arg === "--include-all-blocks") {
      options.includeAllBlocks = true;
    } else if (arg === "--pass1-only") {
      options.pass1Only = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.pass1Model) throw new Error("--pass1-model is required");
    if (!options.pass2Model) throw new Error("--pass2-model is required");
    for (const key of ["pass1MaxOutputTokens", "pass2MaxOutputTokens", "chunkCharLimit", "sourceTextChars", "openRouterTimeoutMs"]) {
      if (!Number.isFinite(options[key]) || options[key] <= 0) throw new Error(`${key} must be a positive number`);
    }
  }
  return options;
}

function defaultRunLabel(options) {
  const models = `${safeSlug(options.pass1Model)}-to-${safeSlug(options.pass2Model)}`;
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${models}`;
}

function printHelp() {
  console.log(`Usage:
  node evals/listofdates/two-pass-model-smoke.mjs --matter-root <matter-folder> [options]
  node evals/listofdates/two-pass-model-smoke.mjs --candidates-file <candidates.json> [options]

Options:
  --pass1-model <model>              Candidate extraction model. Default: gpt-5.4-mini
  --pass2-model <model>              Chronology editor model. Default: gpt-5.4
  --pass1-provider <provider>        auto, openai, or openrouter. Default: auto
  --pass2-provider <provider>        auto, openai, or openrouter. Default: auto
  --pass1-only                       Write candidates.json and skip editor pass
  --candidates-file <path>           Reuse an existing first-pass candidates.json
  --run-label <label>                Output folder name under .local/listofdates-two-pass/
  --out-dir <path>                   Explicit output folder
  --pass1-max-output-tokens <n>      Default: 9000
  --pass2-max-output-tokens <n>      Default: 12000
  --chunk-char-limit <n>             Default: 18000
  --source-text-chars <n>            Source text per block in pass 1. Default: 2400
  --include-all-blocks               Send all extracted text blocks, not just chronology-likely blocks

Outputs:
  candidates.json                    Verbose first-pass candidate ledger
  polished.json                      Second-pass lawyer-facing chronology JSON
  List of Dates.md                   Readable smoke chronology
  report.json                        Metrics for model comparison
`);
}

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeCell(value) {
  return compact(value).replace(/\|/g, "\\|");
}

function safeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "model";
}

function unique(values) {
  return [...new Set(values)];
}

import {
  buildMatterContextPacket,
} from "./matter-context-service.mjs";
import { AI_TASKS } from "../shared/model-policy.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { createAiProviderService } from "./ai-provider-service.mjs";
import {
  COPILOT_ANSWER_SYSTEM_PROMPT,
  copilotUserPayload,
} from "./matter-copilot-providers.mjs";

export const MATTER_COPILOT_ANSWER_SCHEMA_VERSION = "matter-copilot-answer/v1";

const FULL_SNIPPET_OVERLAP_SCORE = 1000;

export const MATTER_COPILOT_ANSWER_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    answer_status: {
      type: "string",
      enum: ["answered", "partial", "not_found", "blocked"],
    },
    answer_markdown: {
      type: "string",
      description: "Concise lawyer-readable answer in Markdown. Use source labels in prose, not raw FILE IDs.",
    },
    confidence: {
      type: "number",
      description: "Confidence from 0 to 1. The server clamps this value after provider output.",
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          raw_citation: { type: "string" },
          source_label: { type: "string" },
          snippet: { type: "string" },
        },
        required: ["raw_citation", "source_label", "snippet"],
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["answer_status", "answer_markdown", "confidence", "sources", "warnings"],
});

const COPILOT_CONTEXT_LIMITS = Object.freeze({
  maxSources: 60,
  maxBlocks: 100,
  maxCharsPerBlock: 1100,
  maxLibraryArtifacts: 4,
  maxChronologyEntries: 120,
  maxChronologyMarkdownChars: 32000,
});

const MAX_QUESTION_LENGTH = 1200;
const MAX_ANSWER_LENGTH = 8000;
const MAX_SNIPPET_LENGTH = 700;
const MAX_CONVERSATION_TURNS = 6;
const MAX_CONVERSATION_CHARS = 6000;
const SOURCE_REQUIRED_STATUSES = new Set(["answered", "partial"]);

export function createMatterCopilotService({
  matterStore,
  answerProvider,
  providerService,
  env = process.env,
  fetchImpl = fetch,
  endpoint,
  now = () => new Date(),
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  const aiProviderService = providerService || createAiProviderService({ env, fetchImpl });

  async function answerQuestion({
    root = matterStore.getMatterRoot?.(),
    question = "",
    conversation = [],
  } = {}) {
    if (!root) throw makeHttpError("Pick a matter before asking a matter question.", 409, "matter_copilot.matter_required");
    const packet = await buildMatterContextPacket(root, COPILOT_CONTEXT_LIMITS);
    return answerQuestionFromPacket({ packet, question, conversation });
  }

  async function answerQuestionFromPacket({
    packet,
    question = "",
    conversation = [],
  } = {}) {
    const normalizedQuestion = normalizeQuestion(question);
    const conversationContext = normalizeConversationContext(conversation);
    if (!packet || typeof packet !== "object") {
      throw makeHttpError("Matter context is not available for this question.", 409, "matter_copilot.context_required");
    }
    const { providerConfig, aiRun: resolvedAiRun } = aiProviderService.resolveTask(AI_TASKS.COPILOT_ANSWER, { endpoint });
    if (!providerConfig.model) throw makeHttpError("Matter copilot answer model is not configured.", 409, "matter_copilot.model_not_configured");
    const matterContext = summarizeMatterContextForCopilot(packet);
    const { rawAnswer, aiRun } = answerProvider
      ? {
          rawAnswer: await answerProvider({
            question: normalizedQuestion,
            matterContext,
            conversationContext,
            schema: MATTER_COPILOT_ANSWER_JSON_SCHEMA,
            providerConfig,
          }),
          aiRun: resolvedAiRun,
        }
      : await invokeMatterCopilotAnswer({
        aiProviderService,
        question: normalizedQuestion,
        matterContext,
        conversationContext,
      });
    return normalizeMatterCopilotAnswer({
      rawAnswer,
      question: normalizedQuestion,
      packet,
      aiRun,
      conversationContext,
      answeredAt: now().toISOString(),
    });
  }

  return { answerQuestion, answerQuestionFromPacket };
}

async function invokeMatterCopilotAnswer({
  aiProviderService,
  question,
  matterContext,
  conversationContext,
}) {
  let result;
  try {
    result = await aiProviderService.invoke({
      task: AI_TASKS.COPILOT_ANSWER,
      systemPrompt: COPILOT_ANSWER_SYSTEM_PROMPT,
      userPayload: copilotUserPayload({ question, matterContext, conversationContext }),
      schema: MATTER_COPILOT_ANSWER_JSON_SCHEMA,
      schemaName: "matter_copilot_answer",
      responseMode: "json",
      label: "Matter copilot answer",
    });
  } catch (error) {
    if (String(error?.code || "").endsWith("api_key_required")) {
      throw makeHttpError("OPENAI_API_KEY or OPENROUTER_API_KEY is required for matter copilot answers", 409, "matter_copilot.provider_api_key_required");
    }
    throw error;
  }
  return { rawAnswer: result.parsed, aiRun: result.aiRun };
}

function summarizeMatterContextForCopilot(packet) {
  const evidenceBlocks = Array.isArray(packet?.evidence_blocks) ? packet.evidence_blocks : [];
  const sources = Array.isArray(packet?.sources) ? packet.sources : [];
  const libraryArtifacts = Array.isArray(packet?.library_artifacts) ? packet.library_artifacts : [];
  const chronologyEntries = libraryArtifacts
    .filter((artifact) => artifact?.kind === "list_of_dates" && Array.isArray(artifact.entries))
    .flatMap((artifact) => artifact.entries);
  const chronologyCitationIndex = libraryArtifacts
    .filter((artifact) => artifact?.kind === "list_of_dates" && Array.isArray(artifact.citation_index))
    .flatMap((artifact) => artifact.citation_index);
  const chronologyMarkdown = libraryArtifacts.find((artifact) => artifact?.kind === "list_of_dates_markdown");
  return {
    schema_version: packet?.schema_version || "",
    generated_at: packet?.generated_at || "",
    matter: packet?.matter || {},
    context_priority: [
      "Read list_of_dates_markdown and chronology_entries first when present.",
      "Use source records and evidence_blocks to verify, cite, or fill gaps.",
      "Preserve OCR or source-review warnings when they affect reliability.",
    ],
    list_of_dates_markdown: chronologyMarkdown ? {
      path: chronologyMarkdown.path || "",
      heading: chronologyMarkdown.heading || "",
      markdown: chronologyMarkdown.markdown || "",
      markdown_truncated: Boolean(chronologyMarkdown.markdown_truncated),
    } : null,
    chronology_entries: chronologyEntries.map((entry) => ({
      date_iso: entry.date_iso || "",
      date_text: entry.date_text || "",
      event: entry.event || "",
      legal_relevance: entry.legal_relevance || "",
      issue_tags: Array.isArray(entry.issue_tags) ? entry.issue_tags : [],
      citation: entry.citation || "",
      source_label: entry.source_label || "",
      source_short_label: entry.source_short_label || "",
      source_excerpt: boundedText(entry.source_excerpt, COPILOT_CONTEXT_LIMITS.maxCharsPerBlock),
      needs_review: Boolean(entry.needs_review),
      supporting_sources: Array.isArray(entry.supporting_sources) ? entry.supporting_sources : [],
    })),
    chronology_citation_index: chronologyCitationIndex.map((entry) => ({
      citation: entry.citation || "",
      source_label: entry.source_label || "",
      source_short_label: entry.source_short_label || "",
      source_excerpt: boundedText(entry.source_excerpt, 300),
      event: boundedText(entry.event, 300),
    })),
    counts: {
      sources: sources.length,
      evidence_blocks_included: evidenceBlocks.length,
      library_artifacts: libraryArtifacts.length,
      chronology_entries: chronologyEntries.length,
    },
    sources: sources.map((source) => ({
      file_id: source.file_id || "",
      source_label: source.source_label || "",
      source_short_label: source.source_short_label || "",
      document_type: source.document_type || "",
      document_date: source.document_date ?? null,
      needs_review: Boolean(source.needs_review),
      sample_citations: Array.isArray(source.sample_citations) ? source.sample_citations.slice(0, 3) : [],
    })),
    evidence_blocks: evidenceBlocks.map((block) => ({
      citation: block.citation || "",
      source_label: block.source_label || "",
      source_short_label: block.source_short_label || "",
      page: block.page ?? null,
      block_id: block.block_id || "",
      needs_review: Boolean(block.needs_review),
      text: boundedText(block.text, COPILOT_CONTEXT_LIMITS.maxCharsPerBlock),
    })),
    library_artifacts: libraryArtifacts.map((artifact) => ({
      path: artifact.path || "",
      kind: artifact.kind || "",
      summary: artifact.summary || artifact.heading || "",
      entry_count: artifact.entry_count ?? null,
      source_count: artifact.source_count ?? null,
      generated_at: artifact.generated_at || "",
    })),
    warnings: Array.isArray(packet?.warnings) ? packet.warnings.slice(0, 8) : [],
  };
}

function normalizeMatterCopilotAnswer({
  rawAnswer,
  question,
  packet,
  aiRun,
  conversationContext = [],
  answeredAt,
}) {
  const record = rawAnswer && typeof rawAnswer === "object" && !Array.isArray(rawAnswer) ? rawAnswer : {};
  const answerStatus = normalizeAnswerStatus(record.answer_status);
  const sourceResolver = buildSourceResolver(packet);
  const { sources, unsupportedCount } = normalizeSources(record.sources, sourceResolver);
  const answerMarkdown = boundedText(record.answer_markdown, MAX_ANSWER_LENGTH) || fallbackAnswer(answerStatus);
  const effectiveAnswerStatus = answerStatus === "answered" && unsupportedCount > 0 ? "partial" : answerStatus;
  if (SOURCE_REQUIRED_STATUSES.has(effectiveAnswerStatus) && !sources.length) {
    return blockedUnsupportedCitationAnswer({
      question,
      packet,
      aiRun,
      answeredAt,
    });
  }
  if (
    SOURCE_REQUIRED_STATUSES.has(effectiveAnswerStatus)
    && answerHasUnsupportedRawCitations(answerMarkdown, sources, sourceResolver)
  ) {
    return blockedUnsupportedCitationAnswer({
      question,
      packet,
      aiRun,
      answeredAt,
    });
  }
  const sourceWarnings = unsupportedCount > 0 && sources.length > 0
    ? ["Some source references could not be verified and were ignored."]
    : [];

  return {
    schema_version: MATTER_COPILOT_ANSWER_SCHEMA_VERSION,
    answered_at: answeredAt,
    question,
    answer_status: effectiveAnswerStatus,
    answer_markdown: answerMarkdown,
    confidence: normalizeConfidence(record.confidence),
    sources,
    warnings: [
      ...(Array.isArray(record.warnings) ? record.warnings.map(normalizeText).filter(Boolean).slice(0, 8) : []),
      ...sourceWarnings,
      ...(Array.isArray(packet?.warnings) ? packet.warnings.slice(0, 5) : []),
    ],
    matter: packet?.matter || {},
    context: {
      packet_schema_version: packet?.schema_version || "",
      evidence_blocks_included: Number(packet?.limits?.included_blocks || 0),
      evidence_blocks_omitted: Number(packet?.limits?.omitted_blocks || 0),
      conversation_turns: conversationContext.length,
    },
    ai_run: aiRun || {},
  };
}

function blockedUnsupportedCitationAnswer({
  question,
  packet,
  aiRun,
  answeredAt,
}) {
  return {
    schema_version: MATTER_COPILOT_ANSWER_SCHEMA_VERSION,
    answered_at: answeredAt,
    question,
    answer_status: "blocked",
    answer_markdown: "I could not verify the source references for that answer from the current matter record, so I am not showing it as a supported answer.",
    confidence: 0,
    sources: [],
    warnings: [
      "The source references could not be verified against the current matter record.",
      ...(Array.isArray(packet?.warnings) ? packet.warnings.slice(0, 5) : []),
    ],
    matter: packet?.matter || {},
    context: {
      packet_schema_version: packet?.schema_version || "",
      evidence_blocks_included: Number(packet?.limits?.included_blocks || 0),
      evidence_blocks_omitted: Number(packet?.limits?.omitted_blocks || 0),
    },
    ai_run: aiRun || {},
  };
}

function buildSourceResolver(packet) {
  const byCitation = new Map();
  const byLabel = new Map();
  for (const block of Array.isArray(packet?.evidence_blocks) ? packet.evidence_blocks : []) {
    if (block?.citation) {
      byCitation.set(block.citation, block);
      indexSourceLabel(byLabel, block.source_label, block);
      indexSourceLabel(byLabel, block.source_short_label, block);
    }
  }
  for (const artifact of Array.isArray(packet?.library_artifacts) ? packet.library_artifacts : []) {
    if (artifact?.kind !== "list_of_dates" || !Array.isArray(artifact.entries)) continue;
    for (const entry of artifact.entries) {
      const entryBlock = addChronologyCitation(byCitation, entry, entry);
      indexSourceLabel(byLabel, entry.source_label, entryBlock);
      indexSourceLabel(byLabel, entry.source_short_label, entryBlock);
      for (const source of Array.isArray(entry.supporting_sources) ? entry.supporting_sources : []) {
        const sourceBlock = addChronologyCitation(byCitation, source, entry);
        indexSourceLabel(byLabel, source.source_label || entry.source_label, sourceBlock);
        indexSourceLabel(byLabel, source.source_short_label || entry.source_short_label, sourceBlock);
      }
    }
    for (const entry of Array.isArray(artifact.citation_index) ? artifact.citation_index : []) {
      const entryBlock = addChronologyCitation(byCitation, entry, entry);
      indexSourceLabel(byLabel, entry.source_label, entryBlock);
      indexSourceLabel(byLabel, entry.source_short_label, entryBlock);
    }
  }
  return { byCitation, byLabel };
}

function addChronologyCitation(byCitation, source = {}, entry = {}) {
  const citation = normalizeText(source.citation);
  if (!citation) return null;
  if (byCitation.has(citation)) return byCitation.get(citation);
  const block = {
    citation,
    source_label: normalizeText(source.source_label) || normalizeText(entry.source_label),
    source_short_label: normalizeText(source.source_short_label) || normalizeText(entry.source_short_label),
    text: normalizeText(entry.source_excerpt) || normalizeText(entry.event),
  };
  byCitation.set(citation, block);
  return block;
}

function indexSourceLabel(byLabel, label, block) {
  const key = normalizeSourceReference(label);
  if (!key || !block?.citation) return;
  if (!byLabel.has(key)) byLabel.set(key, []);
  const blocks = byLabel.get(key);
  if (!blocks.some((candidate) => candidate.citation === block.citation)) blocks.push(block);
}

function normalizeSources(rawSources, sourceResolver) {
  const sources = [];
  const seen = new Set();
  let unsupportedCount = 0;
  for (const source of Array.isArray(rawSources) ? rawSources : []) {
    const sourceReference = normalizeText(source?.raw_citation);
    if (!sourceReference) continue;
    const block = resolveSourceReference(sourceReference, source, sourceResolver);
    const rawCitation = block?.citation || sourceReference;
    if (!block) {
      unsupportedCount += 1;
      continue;
    }
    if (seen.has(rawCitation)) continue;
    seen.add(rawCitation);
    sources.push({
      raw_citation: rawCitation,
      source_label: normalizeText(source?.source_label) || block.source_label || block.source_short_label || "",
      snippet: boundedText(source?.snippet || block.text, MAX_SNIPPET_LENGTH),
    });
  }
  return { sources, unsupportedCount };
}

function resolveSourceReference(sourceReference, source = {}, sourceResolver = {}) {
  const byCitation = sourceResolver.byCitation || new Map();
  const direct = byCitation.get(sourceReference);
  if (direct) return direct;

  const byLabel = sourceResolver.byLabel || new Map();
  const candidates = byLabel.get(normalizeSourceReference(sourceReference)) || [];
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const snippet = normalizeText(source?.snippet);
  if (snippet) {
    const scored = candidates
      .map((block) => ({ block, score: sourceMatchScore(snippet, block.text) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0]?.score > 0) return scored[0].block;
  }

  const label = normalizeSourceReference(source?.source_label);
  if (label && label !== normalizeSourceReference(sourceReference)) {
    const labelCandidates = byLabel.get(label) || [];
    if (labelCandidates.length === 1) return labelCandidates[0];
  }

  return candidates[0];
}

function answerHasUnsupportedRawCitations(answerMarkdown, sources = [], sourceResolver = {}) {
  const tokens = extractRawCitationTokens(answerMarkdown);
  if (!tokens.length) return false;
  const allowed = new Set(sources.map((source) => source.raw_citation).filter(Boolean));
  for (const token of tokens) {
    if (allowed.has(token)) continue;
    if (resolveSourceReference(token, { raw_citation: token }, sourceResolver)) continue;
    return true;
  }
  return false;
}

function extractRawCitationTokens(text = "") {
  return [...new Set(String(text).match(/\bFILE-\d{4}\s+p\d+\.b\d+\b/g) || [])];
}

function sourceMatchScore(snippet, blockText) {
  const snippetText = normalizeSourceReference(snippet);
  const evidenceText = normalizeSourceReference(blockText);
  if (!snippetText || !evidenceText) return 0;
  if (evidenceText.includes(snippetText) || snippetText.includes(evidenceText)) return FULL_SNIPPET_OVERLAP_SCORE;
  const words = new Set(snippetText.split(" ").filter((word) => word.length > 4));
  if (!words.size) return 0;
  let score = 0;
  for (const word of words) {
    if (evidenceText.includes(word)) score += 1;
  }
  return score;
}

function normalizeSourceReference(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeQuestion(value) {
  const question = boundedText(value, MAX_QUESTION_LENGTH);
  if (!question) throw makeHttpError("Question is required.", 400, "matter_copilot.question_required");
  return question;
}

function normalizeConversationContext(value) {
  const turns = Array.isArray(value) ? value : [];
  const normalized = [];
  let remainingChars = MAX_CONVERSATION_CHARS;
  for (const item of turns.slice(-MAX_CONVERSATION_TURNS)) {
    const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : "";
    if (!role) continue;
    const mode = ["ask", "research"].includes(item?.mode) ? item.mode : "ask";
    const content = boundedText(item?.content ?? item?.text, Math.min(1200, remainingChars));
    if (!content) continue;
    normalized.push({ role, mode, content });
    remainingChars -= content.length;
    if (remainingChars <= 0) break;
  }
  return normalized;
}

function normalizeAnswerStatus(value) {
  const status = normalizeText(value);
  if (["answered", "partial", "not_found", "blocked"].includes(status)) return status;
  return "not_found";
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function fallbackAnswer(status) {
  if (status === "blocked") return "I cannot safely answer that from this matter context.";
  return "I could not find enough support in the current matter record to answer that.";
}

function boundedText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length > maxLength) return text.slice(0, maxLength).trimEnd();
  return text;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

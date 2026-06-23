import {
  createDefaultCopilotWebResearchAnswerProvider,
  isCopilotWebResearchAnswerProviderConfigured,
} from "./copilot-web-research-answer-providers.mjs";
import { buildMatterContextPacket } from "./matter-context-service.mjs";
import {
  buildCopilotWebSearchQueries,
  createExaWebResearchProvider,
} from "./web-research-providers.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

export const COPILOT_WEB_RESEARCH_ANSWER_SCHEMA_VERSION = "matter-copilot-research-answer/v1";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const DEFAULT_WEB_RESEARCH_PROVIDER = "exa";
const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESULT_CHARS = 9000;
const MAX_QUESTION_LENGTH = 1200;

export function createCopilotWebResearchService({
  matterStore,
  env = process.env,
  fetchImpl = fetch,
  endpoint,
  webResearchProvider = null,
  researchAnswerProvider = null,
  webResearchAnswerProvider = null,
} = {}) {
  const config = readCopilotWebResearchConfig(env);
  const searchProvider = webResearchProvider || createDefaultWebResearchProvider({ config, env, fetchImpl });
  const answerProvider = researchAnswerProvider || webResearchAnswerProvider || createDefaultCopilotWebResearchAnswerProvider({ env, fetchImpl, endpoint });
  const answerProviderConfigured = Boolean(researchAnswerProvider || webResearchAnswerProvider || isCopilotWebResearchAnswerProviderConfigured({ env }));

  function readAvailability() {
    return {
      schema_version: "copilot-web-research-availability/v1",
      enabled: Boolean(config.enabled && config.providerConfigured && searchProvider && answerProvider && answerProviderConfigured),
      featureEnabled: config.enabled,
      provider: config.provider,
      providerConfigured: config.providerConfigured,
      maxResults: config.maxResults,
      timeoutMs: config.timeoutMs,
      maxResultChars: config.maxResultChars,
    };
  }

  function isEnabled() {
    return readAvailability().enabled;
  }

  function assertReady() {
    assertResearchReady(config, searchProvider, answerProvider, answerProviderConfigured);
  }

  async function answerResearchQuestion({
    root = matterStore?.getMatterRoot?.(),
    question = "",
  } = {}) {
    if (!root) {
      throw makeHttpError("Pick or prepare a matter before using Research.", 409, "copilot_research.context_required");
    }
    const packet = await buildMatterContextPacket(root);
    return answerResearchQuestionFromPacket({ packet, question });
  }

  async function answerResearchQuestionFromPacket({ packet, question = "" } = {}) {
    const normalizedQuestion = normalizeResearchQuestion(question);
    assertResearchReady(config, searchProvider, answerProvider, answerProviderConfigured);
    if (!packet || typeof packet !== "object") {
      throw makeHttpError("Pick or prepare a matter before using Research.", 409, "copilot_research.context_required");
    }
    const queries = buildCopilotWebSearchQueries(normalizedQuestion);
    const research = await searchProvider({
      query: queries[0] || normalizedQuestion,
      queries,
      question: normalizedQuestion,
      config,
    });
    const publicSources = Array.isArray(research?.sources) ? research.sources : [];
    if (!publicSources.length) {
      throw makeHttpError("I could not find useful public sources. I can still answer from the matter record.", 404, "copilot_research.no_results");
    }
    const answer = await answerProvider({
      question: normalizedQuestion,
      packet,
      publicSources,
      searchQuery: research.query || queries[0] || normalizedQuestion,
      config,
    });
    return normalizeResearchAnswer({
      answer,
      question: normalizedQuestion,
      config,
      publicSources,
      searchQuery: research.query || queries[0] || normalizedQuestion,
    });
  }

  return {
    answerResearchQuestion,
    answerResearchQuestionFromPacket,
    assertReady,
    isEnabled,
    readAvailability,
  };
}

export function readCopilotWebResearchConfig(env = process.env) {
  const provider = normalizeProvider(env.COPILOT_WEB_RESEARCH_PROVIDER || DEFAULT_WEB_RESEARCH_PROVIDER);
  const apiKeyEnvKey = apiKeyEnvKeyForProvider(provider);
  return {
    enabled: ENABLED_VALUES.has(String(env.COPILOT_WEB_RESEARCH_ENABLED || "").trim().toLowerCase()),
    provider,
    apiKeyEnvKey,
    providerConfigured: Boolean(apiKeyEnvKey && String(env[apiKeyEnvKey] || "").trim()),
    maxResults: parsePositiveInteger(env.COPILOT_WEB_RESEARCH_MAX_RESULTS) || DEFAULT_MAX_RESULTS,
    timeoutMs: parsePositiveInteger(env.COPILOT_WEB_RESEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    maxResultChars: parsePositiveInteger(env.COPILOT_WEB_RESEARCH_MAX_RESULT_CHARS) || DEFAULT_MAX_RESULT_CHARS,
  };
}

function createDefaultWebResearchProvider({ config, env, fetchImpl }) {
  if (config.provider === "exa") {
    return createExaWebResearchProvider({
      apiKey: env[config.apiKeyEnvKey],
      fetchImpl,
      timeoutMs: config.timeoutMs,
      maxResults: config.maxResults,
      maxResultChars: config.maxResultChars,
    });
  }
  return null;
}

function assertResearchReady(config, webResearchProvider, answerProvider, answerProviderConfigured) {
  if (!config.enabled) {
    throw makeHttpError("Research is not enabled for this workspace.", 409, "copilot_research.disabled");
  }
  if (!config.providerConfigured || typeof webResearchProvider !== "function" || typeof answerProvider !== "function" || !answerProviderConfigured) {
    throw makeHttpError("Research is temporarily unavailable.", 409, "copilot_research.provider_not_configured");
  }
}

function normalizeResearchQuestion(value) {
  const question = String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_LENGTH);
  if (!question) throw makeHttpError("Research question is required.", 400, "copilot_research.question_required");
  return question;
}

function normalizeResearchAnswer({ answer, question, config, publicSources = [], searchQuery = "" }) {
  const raw = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {};
  const sourceValidation = validatePublicSources(raw.public_sources, publicSources);
  const warnings = [
    ...sourceValidation.warnings,
    ...(Array.isArray(raw.warnings) ? raw.warnings.map((warning) => String(warning || "").trim()).filter(Boolean) : []),
  ];
  return {
    schema_version: COPILOT_WEB_RESEARCH_ANSWER_SCHEMA_VERSION,
    question,
    answer_status: normalizeAnswerStatus(raw.answer_status),
    answer_markdown: String(raw.answer_markdown || "").trim(),
    matter_sources: Array.isArray(raw.matter_sources) ? raw.matter_sources : [],
    public_sources: sourceValidation.sources,
    warnings,
    research: {
      provider: config.provider,
      query: String(raw.research?.query || searchQuery || "").trim(),
      result_count: sourceValidation.sources.length,
    },
    ai_run: raw.ai_run && typeof raw.ai_run === "object" ? raw.ai_run : {},
  };
}

function validatePublicSources(modelSources, publicSources) {
  const allowed = new Map(publicSources
    .filter((source) => source?.id)
    .map((source) => [String(source.id), source]));
  const requested = Array.isArray(modelSources) && modelSources.length
    ? modelSources
    : publicSources;
  const sources = [];
  const warnings = [];
  const seen = new Set();
  for (const source of requested) {
    const id = String(source?.id || "").trim();
    if (!id || seen.has(id)) continue;
    const validated = allowed.get(id);
    if (!validated) {
      warnings.push(`Dropped unsupported public source ${id}.`);
      continue;
    }
    seen.add(id);
    sources.push({
      id: validated.id,
      title: validated.title || "Untitled public source",
      url: validated.url || "",
      published_at: validated.publishedAt || validated.published_at || "",
      source_type: validated.sourceType || validated.source_type || "other",
      snippet: validated.snippet || "",
    });
  }
  return { sources, warnings };
}

function normalizeAnswerStatus(value) {
  const status = String(value || "").trim();
  return ["answered", "partial", "not_found", "blocked", "failed"].includes(status) ? status : "failed";
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return provider || DEFAULT_WEB_RESEARCH_PROVIDER;
}

function apiKeyEnvKeyForProvider(provider) {
  if (provider === "exa") return "EXA_API_KEY";
  return "";
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

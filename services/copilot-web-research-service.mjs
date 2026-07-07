import {
  createDefaultCopilotWebResearchAnswerProvider,
  isCopilotWebResearchAnswerProviderConfigured,
} from "./copilot-web-research-answer-providers.mjs";
import { buildMatterContextPacket } from "./matter-context-service.mjs";
import { createLegalSourceSidecarProvider } from "./legal-source-sidecar-provider.mjs";
import {
  buildCopilotWebSearchQueries,
  createExaWebResearchProvider,
} from "./web-research-providers.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

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
  providerService = null,
} = {}) {
  const config = readCopilotWebResearchConfig(env);
  const searchProvider = webResearchProvider || createDefaultWebResearchProvider({ config, env, fetchImpl });
  const answerProvider = researchAnswerProvider || webResearchAnswerProvider || createDefaultCopilotWebResearchAnswerProvider({ providerService, env, fetchImpl, endpoint });
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
    const providerWarnings = normalizeWarnings(research?.warnings);
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
      providerWarnings,
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
    providerConfigured: isProviderConfigured({ provider, apiKeyEnvKey, env }),
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
  if (config.provider === "legal_source_sidecar") {
    return createLegalSourceSidecarProvider({
      baseUrl: env.COPILOT_LEGAL_SOURCE_SERVICE_URL,
      token: env.COPILOT_LEGAL_SOURCE_SERVICE_TOKEN,
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

function normalizeResearchAnswer({ answer, question, config, publicSources = [], providerWarnings = [], searchQuery = "" }) {
  const raw = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {};
  const sourceValidation = validatePublicSources(raw.public_sources, publicSources, raw.answer_markdown);
  const warnings = [
    ...sourceValidation.warnings,
    ...normalizeWarnings(providerWarnings),
    ...normalizeWarnings(raw.warnings),
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

function validatePublicSources(modelSources, publicSources, answerMarkdown = "") {
  const allowed = new Map(publicSources
    .filter((source) => source?.id)
    .map((source) => [String(source.id).trim().toUpperCase(), source]));
  const requestedIds = [];
  const addRequestedId = (value) => {
    const id = String(value || "").trim().toUpperCase();
    if (id && !requestedIds.includes(id)) requestedIds.push(id);
  };

  if (Array.isArray(modelSources)) {
    for (const source of modelSources) addRequestedId(source?.id);
  }
  for (const id of referencedPublicSourceIds(answerMarkdown)) addRequestedId(id);
  if (!requestedIds.length) {
    for (const source of publicSources) addRequestedId(source?.id);
  }

  const sources = [];
  const warnings = [];
  for (const id of requestedIds) {
    const validated = allowed.get(id);
    if (!validated) {
      warnings.push(`Dropped unsupported public source ${id}.`);
      continue;
    }
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

function referencedPublicSourceIds(value = "") {
  return [...String(value || "").matchAll(/\b(?:WEB|STATUTE)-\d{4}\b/gi)].map((match) => match[0].toUpperCase());
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

function isProviderConfigured({ provider, apiKeyEnvKey, env }) {
  if (provider === "exa") return Boolean(apiKeyEnvKey && String(env[apiKeyEnvKey] || "").trim());
  if (provider === "legal_source_sidecar") return Boolean(String(env.COPILOT_LEGAL_SOURCE_SERVICE_URL || "").trim());
  return false;
}

function normalizeWarnings(values) {
  return (Array.isArray(values) ? values : [])
    .map((warning) => redactSensitiveText(String(warning || "").replace(/\s+/g, " ").trim()).slice(0, 500))
    .filter(Boolean);
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

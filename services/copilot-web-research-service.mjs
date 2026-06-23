import { buildMatterContextPacket } from "./matter-context-service.mjs";
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
  webResearchAnswerProvider = null,
} = {}) {
  const config = readCopilotWebResearchConfig(env);

  function readAvailability() {
    return {
      schema_version: "copilot-web-research-availability/v1",
      enabled: Boolean(config.enabled && config.providerConfigured && webResearchAnswerProvider),
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
    assertResearchReady(config, webResearchAnswerProvider);
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
    assertResearchReady(config, webResearchAnswerProvider);
    if (!packet || typeof packet !== "object") {
      throw makeHttpError("Pick or prepare a matter before using Research.", 409, "copilot_research.context_required");
    }
    const answer = await webResearchAnswerProvider({
      question: normalizedQuestion,
      packet,
      config,
    });
    return normalizeResearchAnswer({ answer, question: normalizedQuestion, config });
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

function assertResearchReady(config, webResearchAnswerProvider) {
  if (!config.enabled) {
    throw makeHttpError("Research is not enabled for this workspace.", 409, "copilot_research.disabled");
  }
  if (!config.providerConfigured) {
    throw makeHttpError("Research is temporarily unavailable.", 409, "copilot_research.provider_not_configured");
  }
  if (typeof webResearchAnswerProvider !== "function") {
    throw makeHttpError("Research is temporarily unavailable.", 503, "copilot_research.provider_not_configured");
  }
}

function normalizeResearchQuestion(value) {
  const question = String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_LENGTH);
  if (!question) throw makeHttpError("Research question is required.", 400, "copilot_research.question_required");
  return question;
}

function normalizeResearchAnswer({ answer, question, config }) {
  const raw = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {};
  return {
    schema_version: COPILOT_WEB_RESEARCH_ANSWER_SCHEMA_VERSION,
    question,
    answer_status: normalizeAnswerStatus(raw.answer_status),
    answer_markdown: String(raw.answer_markdown || "").trim(),
    matter_sources: Array.isArray(raw.matter_sources) ? raw.matter_sources : [],
    public_sources: Array.isArray(raw.public_sources) ? raw.public_sources : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map((warning) => String(warning || "").trim()).filter(Boolean) : [],
    research: {
      provider: config.provider,
      query: String(raw.research?.query || "").trim(),
      result_count: Number.isInteger(raw.research?.result_count) && raw.research.result_count >= 0
        ? raw.research.result_count
        : 0,
    },
    ai_run: raw.ai_run && typeof raw.ai_run === "object" ? raw.ai_run : {},
  };
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

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createJsonStorePersistence, formatJsonStore } from "./json-store-persistence.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

export const COPILOT_INTERACTION_RECEIPT_LEDGER_SCHEMA_VERSION = "copilot-interaction-receipts-ledger/v1";
export const COPILOT_INTERACTION_RECEIPT_SCHEMA_VERSION = "copilot-interaction-receipt/v1";

const DEFAULT_LIMIT = 100;
const MAX_RECEIPTS = 1000;
const MAX_TEXT_LENGTH = 1200;
const MAX_PREVIEW_LENGTH = 1600;
const MAX_WARNINGS = 8;
const VALID_MODES = new Set(["ask", "research"]);
const VALID_OUTCOMES = new Set(["answered", "partial", "not_found", "blocked", "failed", "error"]);

export function createCopilotInteractionReceiptService({
  appDir = process.cwd(),
  receiptsPath,
  now = () => new Date(),
  idFactory = () => `copilot_receipt_${randomUUID()}`,
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = receiptsPath || path.join(root, ".local", "copilot-interaction-receipts.json");
  const persistence = createJsonStorePersistence({
    storePath,
    serialize: (store) => formatJsonStore(normalizeStore(store)),
  });

  async function appendReceipt(input = {}) {
    const receipt = normalizeReceipt({
      ...input,
      id: input.id || idFactory(),
      createdAt: input.createdAt || now().toISOString(),
    });
    return persistence.withStoreMutation(async () => {
      const store = await loadStore();
      store.receipts.push(receipt);
      if (store.receipts.length > MAX_RECEIPTS) store.receipts.splice(0, store.receipts.length - MAX_RECEIPTS);
      await persistence.writeStoreFile(store);
      return {
        schema_version: "copilot-interaction-receipt-write/v1",
        recorded: true,
        id: receipt.id,
        path: path.relative(root, storePath).replaceAll(path.sep, "/"),
      };
    });
  }

  async function listReceipts(filters = {}) {
    const store = await loadStore();
    const limit = parseLimit(filters.limit);
    const matter = normalizeText(filters.matterName || filters.matter, 240);
    const mode = normalizeMode(filters.mode);
    return {
      schema_version: COPILOT_INTERACTION_RECEIPT_LEDGER_SCHEMA_VERSION,
      receipts: store.receipts
        .filter((receipt) => !matter || receipt.matterName === matter)
        .filter((receipt) => !mode || receipt.mode === mode)
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
        .slice(0, limit),
    };
  }

  async function loadStore() {
    try {
      return normalizeStore(JSON.parse(await readFile(storePath, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  return {
    appendReceipt,
    listReceipts,
    receiptsPath: storePath,
  };
}

export function buildCopilotInteractionReceipt({
  mode = "ask",
  matterName = "",
  question = "",
  answer = null,
  error = null,
  runtimeMode = "",
  route = "",
  conversationTurns = null,
} = {}) {
  const answerRecord = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : null;
  const hasError = Boolean(error);
  const sourceSummary = sourceSummaryForAnswer(answerRecord);
  return normalizeReceipt({
    mode,
    matterName,
    question,
    outcome: hasError ? "error" : answerRecord?.answer_status || "failed",
    answerPreview: hasError ? "" : answerRecord?.answer_markdown || "",
    errorCode: hasError ? safeErrorCode(error?.code) || "copilot.error" : "",
    errorClass: hasError ? errorClass(error) : "",
    warningMessages: hasError
      ? [safeErrorMessage(error)]
      : Array.isArray(answerRecord?.warnings) ? answerRecord.warnings : [],
    sourceSummary,
    aiRun: answerRecord?.ai_run || {},
    context: {
      runtimeMode,
      route,
      conversationTurns: Number.isInteger(conversationTurns)
        ? conversationTurns
        : Number(answerRecord?.context?.conversation_turns || 0),
      packetSchemaVersion: answerRecord?.context?.packet_schema_version || "",
    },
  });
}

function normalizeReceipt(input = {}) {
  const mode = normalizeMode(input.mode) || "ask";
  const outcome = normalizeOutcome(input.outcome || input.answerStatus);
  return {
    schema_version: COPILOT_INTERACTION_RECEIPT_SCHEMA_VERSION,
    id: normalizeText(input.id, 160) || `copilot_receipt_${randomUUID()}`,
    createdAt: normalizeIso(input.createdAt) || new Date().toISOString(),
    mode,
    matterName: normalizeText(input.matterName, 240),
    question: normalizeText(input.question, MAX_TEXT_LENGTH),
    outcome,
    answerPreview: normalizeText(input.answerPreview, MAX_PREVIEW_LENGTH),
    errorCode: safeErrorCode(input.errorCode),
    errorClass: normalizeText(input.errorClass, 120),
    warnings: normalizeWarnings(input.warningMessages || input.warnings),
    sourceSummary: normalizeSourceSummary(input.sourceSummary),
    aiRun: normalizeAiRun(input.aiRun),
    context: normalizeContext(input.context),
  };
}

function sourceSummaryForAnswer(answer = null) {
  const matterSources = Array.isArray(answer?.sources)
    ? answer.sources
    : Array.isArray(answer?.matter_sources)
      ? answer.matter_sources
      : [];
  const publicSources = Array.isArray(answer?.public_sources) ? answer.public_sources : [];
  return {
    matterSourceCount: matterSources.length,
    publicSourceCount: publicSources.length,
    matterSourceIds: matterSources.map((source) => normalizeText(source.raw_citation || source.file_id || source.id, 120)).filter(Boolean).slice(0, 20),
    publicSourceIds: publicSources.map((source) => normalizeText(source.id, 120)).filter(Boolean).slice(0, 20),
    publicUrls: publicSources.map((source) => normalizeText(source.url, 500)).filter(Boolean).slice(0, 20),
  };
}

function normalizeSourceSummary(value = {}) {
  const sourceSummary = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    matterSourceCount: Math.max(0, Math.trunc(Number(sourceSummary.matterSourceCount) || 0)),
    publicSourceCount: Math.max(0, Math.trunc(Number(sourceSummary.publicSourceCount) || 0)),
    matterSourceIds: normalizeStringArray(sourceSummary.matterSourceIds, 120, 20),
    publicSourceIds: normalizeStringArray(sourceSummary.publicSourceIds, 120, 20),
    publicUrls: normalizeStringArray(sourceSummary.publicUrls, 500, 20),
  };
}

function normalizeAiRun(value = {}) {
  const aiRun = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    provider: normalizeText(aiRun.provider, 120),
    model: normalizeText(aiRun.model, 160),
    task: normalizeText(aiRun.task, 120),
    tier: normalizeText(aiRun.tier, 120),
    policyPromptVersion: normalizeText(aiRun.policyPromptVersion, 160),
  };
}

function normalizeContext(value = {}) {
  const context = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    runtimeMode: normalizeText(context.runtimeMode, 80),
    route: normalizeText(context.route, 160),
    conversationTurns: Math.max(0, Math.trunc(Number(context.conversationTurns) || 0)),
    packetSchemaVersion: normalizeText(context.packetSchemaVersion, 160),
  };
}

function normalizeStore(store = {}) {
  return {
    schema_version: COPILOT_INTERACTION_RECEIPT_LEDGER_SCHEMA_VERSION,
    receipts: Array.isArray(store.receipts) ? store.receipts.map(normalizeReceipt) : [],
  };
}

function emptyStore() {
  return { schema_version: COPILOT_INTERACTION_RECEIPT_LEDGER_SCHEMA_VERSION, receipts: [] };
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return VALID_MODES.has(mode) ? mode : "";
}

function normalizeOutcome(value) {
  const outcome = String(value || "").trim().toLowerCase();
  return VALID_OUTCOMES.has(outcome) ? outcome : "failed";
}

function normalizeWarnings(values) {
  return normalizeStringArray(values, 500, MAX_WARNINGS);
}

function normalizeStringArray(values, maxLength, maxItems) {
  return (Array.isArray(values) ? values : values ? [values] : [])
    .map((value) => normalizeText(value, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeText(value, maxLength = MAX_TEXT_LENGTH) {
  const redacted = redactSensitiveText(String(value || "").replace(/\s+/g, " ").trim());
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}…`;
}

function normalizeIso(value) {
  const text = normalizeText(value, 80);
  if (!text) return "";
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function safeErrorCode(value) {
  const code = normalizeText(value, 160);
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(code) ? code : "";
}

function safeErrorMessage(error) {
  return normalizeText(error?.message || error || "Unknown error", 500);
}

function errorClass(error) {
  if (error instanceof Error) return error.name || "Error";
  if (Array.isArray(error)) return "Array";
  if (error && typeof error === "object") return "Object";
  return typeof error || "unknown";
}

function parseLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
  return Math.min(500, Math.trunc(number));
}

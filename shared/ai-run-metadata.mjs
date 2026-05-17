export const AI_RUN_STATUS_FIELDS = [
  "provider",
  "model",
  "returnedModel",
  "returnedProvider",
  "policyPromptVersion",
  "maxOutputTokens",
];

export const AI_RUN_LEDGER_FIELDS = [
  "provider",
  "model",
  "task",
  "policyPromptVersion",
];

export const AI_RUN_CONTEXT_FIELDS = [
  "policyVersion",
  "policyPromptVersion",
  "task",
  "tier",
  "provider",
  "model",
  "maxOutputTokens",
  "fallback",
  "returnedModel",
  "returnedProvider",
];

const AI_RUN_USAGE_FIELDS = [
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "cost",
];

export function normalizeAiRunMetadata(aiRun, {
  fields = AI_RUN_STATUS_FIELDS,
  includeEmptyFields = false,
  includeUsage = false,
  maxTextLength = 1200,
} = {}) {
  if (!aiRun || typeof aiRun !== "object" || Array.isArray(aiRun)) {
    return includeEmptyFields
      ? emptyMetadata(fields)
      : null;
  }

  const normalized = {};
  for (const field of fields) {
    if (field === "maxOutputTokens") {
      const maxOutputTokens = Number(aiRun.maxOutputTokens);
      if (Number.isInteger(maxOutputTokens) && maxOutputTokens > 0) {
        normalized.maxOutputTokens = maxOutputTokens;
      } else if (includeEmptyFields) {
        normalized.maxOutputTokens = "";
      }
      continue;
    }

    const value = normalizeText(aiRun[field], maxTextLength);
    if (value || includeEmptyFields) normalized[field] = value;
  }

  if (includeUsage && aiRun.usage && typeof aiRun.usage === "object" && !Array.isArray(aiRun.usage)) {
    const usage = {};
    for (const field of AI_RUN_USAGE_FIELDS) {
      if (aiRun.usage[field] !== undefined && aiRun.usage[field] !== null) usage[field] = aiRun.usage[field];
    }
    if (Object.keys(usage).length) normalized.usage = usage;
  }

  return Object.keys(normalized).length ? normalized : null;
}

function emptyMetadata(fields) {
  const metadata = {};
  for (const field of fields) metadata[field] = "";
  return metadata;
}

function normalizeText(value, maxLength = 1200) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

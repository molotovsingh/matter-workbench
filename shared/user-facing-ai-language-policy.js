const USER_FACING_RESTRICTED_AI_LANGUAGE_SOURCE = [
  "openai",
  "openrouter",
  "gpt(?:[-_\\s]?\\d(?:\\.\\d+)*)?",
  "llm",
  "api[\\s_-]*key",
  "provider",
  "model",
  "quota",
  "billing",
  "credits?",
  "insufficient[\\s_-]*funds",
].join("|");

export const USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE = "Assistant is temporarily unavailable. You can continue using the workspace.";
export const USER_FACING_RESTRICTED_AI_LANGUAGE_PATTERN = new RegExp(`(?:^|[^A-Za-z0-9])(?:${USER_FACING_RESTRICTED_AI_LANGUAGE_SOURCE})(?=$|[^A-Za-z0-9])`, "i");

export function containsUserFacingRestrictedAiLanguage(value) {
  return USER_FACING_RESTRICTED_AI_LANGUAGE_PATTERN.test(stringifyUserFacingPolicyValue(value));
}

function stringifyUserFacingPolicyValue(value, seen = new WeakSet()) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => stringifyUserFacingPolicyValue(item, seen)).join("\n");
  return Object.values(value).map((item) => stringifyUserFacingPolicyValue(item, seen)).join("\n");
}

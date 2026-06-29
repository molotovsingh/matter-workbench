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
export const USER_FACING_ASSISTANT_UNAVAILABLE_CODE = "assistant.unavailable";
export const USER_FACING_RESTRICTED_AI_LANGUAGE_PATTERN = new RegExp(`(?:^|[^A-Za-z0-9])(?:${USER_FACING_RESTRICTED_AI_LANGUAGE_SOURCE})(?=$|[^A-Za-z0-9])`, "i");

export function containsUserFacingRestrictedAiLanguage(value) {
  return USER_FACING_RESTRICTED_AI_LANGUAGE_PATTERN.test(stringifyUserFacingPolicyValue(value));
}

export function isAssistantAvailabilityError(value, code = "") {
  const message = stringifyUserFacingPolicyValue(value);
  const diagnosticCode = String(code || "").trim();
  return isAiAvailabilityCode(diagnosticCode)
    || /\buser not found\b|\bauth(?:entication|orization)? failed\b|\bunauthori[sz]ed\b|\bforbidden\b|\bpermission denied\b|\baccess denied\b|\binvalid credentials\b/i.test(message)
    || containsUserFacingRestrictedAiLanguage(message);
}

export function userFacingAiErrorMessage(value, code = "") {
  return isAssistantAvailabilityError(value, code)
    ? USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE
    : String(value || "").replace(/\s+/g, " ").trim();
}

export function userFacingAiErrorCode(value, code = "") {
  return isAssistantAvailabilityError(value, code)
    ? USER_FACING_ASSISTANT_UNAVAILABLE_CODE
    : String(code || "").trim();
}

function isAiAvailabilityCode(code = "") {
  return /^(?:provider|ai_provider)\.|^matter_copilot\.provider|^copilot_research\.provider|^skill_router\.provider/i.test(String(code || "").trim());
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

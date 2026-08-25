import { PIPELINE_VERSIONS } from "../../packages/extraction-contracts/index.mjs";

const INCOMPLETE_FINISH_REASONS = new Set(["length", "max_tokens", "content_filter", "truncated", "incomplete"]);

export function createPageValidator({ version = PIPELINE_VERSIONS.validator, minimumCharacters = 3 } = {}) {
  return Object.freeze({
    version,
    validate(providerResult = {}) {
      const text = String(providerResult.text || "");
      const reasons = [];
      if (text.trim().length < minimumCharacters) reasons.push("empty_or_too_short");
      if (INCOMPLETE_FINISH_REASONS.has(String(providerResult.finishReason || "").toLowerCase())) reasons.push("provider_output_incomplete");
      if (/\u0000/.test(text)) reasons.push("invalid_nul_character");
      if (hasPathologicalRepetition(text)) reasons.push("pathological_repetition");
      return {
        validatorVersion: version,
        outcome: reasons.length ? "review_required" : "accepted",
        reasons,
      };
    },
  });
}

function hasPathologicalRepetition(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 80) return false;
  const words = normalized.toLowerCase().split(" ").filter(Boolean);
  for (let size = 3; size <= 8; size += 1) {
    if (words.length < size * 4) continue;
    const tail = words.slice(0, size).join(" ");
    let repeated = true;
    for (let offset = size; offset < size * 4; offset += size) {
      if (words.slice(offset, offset + size).join(" ") !== tail) {
        repeated = false;
        break;
      }
    }
    if (repeated) return true;
  }
  return /(.)\1{39,}/u.test(normalized);
}

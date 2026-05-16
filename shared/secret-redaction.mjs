export const REDACTED_SECRET = "[redacted-secret]";

export function redactSensitiveText(value = "") {
  return String(value)
    .replace(/\b(OPENAI_API_KEY|OPENROUTER_API_KEY|MISTRAL_API_KEY)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi, `$1=${REDACTED_SECRET}`)
    .replace(/\bBearer\s+sk-[A-Za-z0-9_-]+/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(/\bsk-[A-Za-z0-9_-]+/g, REDACTED_SECRET);
}

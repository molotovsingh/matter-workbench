export const REDACTED_SECRET = "[redacted-secret]";

// Single home for common secret redaction. Keep the React twin in
// react-ui/src/lib/secretRedaction.ts aligned; the parity test enforces it.
export function redactSensitiveText(value = "") {
  return String(value)
    .replace(
      /(^|[{\s,])(["']?)(apiKey|api_key|x-api-key)\2\s*([:=])\s*("[^"]*"|'[^']*'|[^\s,}]+)/gi,
      (_match, prefix, quote, key, separator) => `${prefix}${quote}${key}${quote}${separator}${REDACTED_SECRET}`,
    )
    .replace(/\b(OPENAI_API_KEY|OPENROUTER_API_KEY|MISTRAL_API_KEY)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi, `$1=${REDACTED_SECRET}`)
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi, `$1=${REDACTED_SECRET}`)
    .replace(/\b(postgres(?:ql)?):\/\/([^:@/\s]+):([^@/\s]+)@/gi, "$1://$2:***@")
    .replace(/\bBearer\s+["']?[^"'\s]+["']?/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(/\b(mwb_ing_)[A-Za-z0-9_-]+/gi, `$1${REDACTED_SECRET}`)
    .replace(/\b(password|token|secret)\s*[:=]\s*([^\s"'`]+)/gi, `$1=${REDACTED_SECRET}`)
    .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, REDACTED_SECRET)
    .replace(/\bsk-[A-Za-z0-9_-]+/g, REDACTED_SECRET);
}

export function redactSensitiveValues(value) {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactSensitiveValues(entry)]),
    );
  }
  return value;
}

export const REDACTED_SECRET = '[redacted-secret]';

export function redactSensitiveText(value = ''): string {
  return String(value)
    .replace(
      /(^|[{\s,])(["']?)(apiKey|api_key|x-api-key)\2\s*([:=])\s*("[^"]*"|'[^']*'|[^\s,}]+)/gi,
      (_match, prefix: string, quote: string, key: string, separator: string) => (
        `${prefix}${quote}${key}${quote}${separator}${REDACTED_SECRET}`
      ),
    )
    .replace(/\b(OPENAI_API_KEY|OPENROUTER_API_KEY|MISTRAL_API_KEY)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi, `$1=${REDACTED_SECRET}`)
    .replace(/\bBearer\s+["']?[^"'\s]+["']?/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(/\bsk-[A-Za-z0-9_-]+/g, REDACTED_SECRET);
}

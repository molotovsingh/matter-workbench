export interface PreparationErrorContext {
  id?: string;
  slash?: string;
}

export function formatVisiblePreparationError(error: unknown, context: PreparationErrorContext = {}): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const title = raw.match(/<title>([^<]+)<\/title>/i)?.[1];
  const withoutTags = title || raw.replace(/<[^>]+>/g, ' ');
  const normalized = withoutTags.replace(/\s+/g, ' ').trim();

  if (isGatewayTimeout(normalized)) {
    return preparationTimeoutMessage(context);
  }

  const redacted = normalized
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/gi, '$1=[redacted-secret]')
    .replace(/\b(password|token|secret)\s*[:=]\s*([^\s"'`]+)/gi, '$1=[redacted-secret]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[redacted-secret]')
    .slice(0, 500)
    .trim();

  return redacted || 'Preparation failed.';
}

function isGatewayTimeout(text: string): boolean {
  return /\b504\b/.test(text) && /gateway|time-?out|timed?\s*out/i.test(text);
}

function preparationTimeoutMessage(context: PreparationErrorContext): string {
  if (context.id === 'extract' || context.slash === '/extract') {
    return 'Reading documents took too long. The app may still be finishing in the background; refresh the matter in a minute, then run preparation again if needed.';
  }
  return 'This preparation step took too long. Refresh the matter in a minute, then run preparation again if needed.';
}

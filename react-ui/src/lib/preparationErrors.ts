import { redactSensitiveText } from './secretRedaction';

export interface PreparationErrorContext {
  id?: string;
  slash?: string;
}

export const PREPARATION_STATUS_RECONNECT_MESSAGE = 'Connection briefly interrupted. The server job continues; reconnecting to status…';

export function isTransientPreparationStatusError(error: unknown): boolean {
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return true;
  if (!error || typeof error !== 'object') return /failed to fetch|could not reach the server/i.test(String(error || ''));
  const candidate = error as { code?: unknown; statusCode?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const statusCode = Number(candidate.statusCode);
  return code === 'api.network_failed'
    || code === 'http.server_error'
    || code === 'http.gateway_timeout'
    || statusCode === 0
    || statusCode === 502
    || statusCode === 503
    || statusCode === 504
    || /failed to fetch|could not reach the server/i.test(String(candidate.message || ''));
}

export function formatPreparationStatusError(error: unknown): string {
  if (isTransientPreparationStatusError(error)) return PREPARATION_STATUS_RECONNECT_MESSAGE;
  return `Preparation status is temporarily unavailable: ${formatVisiblePreparationError(error)}`;
}

export function formatVisiblePreparationError(error: unknown, context: PreparationErrorContext = {}): string {
  const raw = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? String((error as { message: string }).message)
      : String(error ?? '');
  const title = raw.match(/<title>([^<]+)<\/title>/i)?.[1];
  const withoutTags = title || raw.replace(/<[^>]+>/g, ' ');
  const normalized = withoutTags.replace(/\s+/g, ' ').trim();

  if (isGatewayTimeout(normalized)) {
    return preparationTimeoutMessage(context);
  }

  const redacted = redactSensitiveText(normalized).slice(0, 500).trim();

  return redacted || 'Preparation failed.';
}

function isGatewayTimeout(text: string): boolean {
  return /\b504\b/.test(text) && /gateway|time-?out|timed?\s*out/i.test(text);
}

function preparationTimeoutMessage(context: PreparationErrorContext): string {
  if (context.id === 'extract' || context.slash === '/extract') {
    return 'Reading documents took too long. The app may still be finishing in the background; refresh the matter in a minute, then run needed preparation if needed.';
  }
  return 'This preparation step took too long. Refresh the matter in a minute, then run needed preparation if needed.';
}

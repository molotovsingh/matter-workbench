interface ErrorMessageOptions {
  includeCode?: boolean;
}

export function getErrorMessage(error: unknown, options: ErrorMessageOptions = {}): string {
  const message = baseErrorMessage(error);
  if (!options.includeCode) return message;
  const code = diagnosticErrorCode(error);
  if (!code || message.includes(code)) return message;
  return `${message} (code: ${code})`;
}

function baseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;

  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized;
  } catch {
    // Fall back to String below.
  }

  const fallback = String(error ?? '').trim();
  return fallback || 'Unknown error';
}

function diagnosticErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  if (typeof record.code === 'string' && isSafeDiagnosticCode(record.code)) return record.code.trim();
  const diagnostic = record.diagnostic;
  if (diagnostic && typeof diagnostic === 'object') {
    const diagnosticCode = (diagnostic as Record<string, unknown>).code;
    if (typeof diagnosticCode === 'string' && isSafeDiagnosticCode(diagnosticCode)) return diagnosticCode.trim();
  }
  return '';
}

function isSafeDiagnosticCode(value: string): boolean {
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(value.trim());
}

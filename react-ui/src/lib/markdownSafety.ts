const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function safeMarkdownUrl(value = ''): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (raw.startsWith('#')) return raw;
  if (raw.startsWith('//')) return '';
  if (raw.startsWith('/')) return raw;

  try {
    const url = new URL(raw, 'https://matter-workbench.local');
    if (!SAFE_PROTOCOLS.has(url.protocol)) return '';
    return raw;
  } catch {
    return '';
  }
}

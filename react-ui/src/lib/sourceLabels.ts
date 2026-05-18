export function lawyerFacingSourceLabel({
  label = '',
  citation = '',
  fallback = 'Source label unavailable',
}: {
  label?: string;
  citation?: string;
  fallback?: string;
} = {}): string {
  const rawLabel = String(label || '');
  const rawCitation = String(citation || '');
  const cleanLabel = scrubTechnicalCitation(rawLabel) || fallback;
  const pageLabel = formatPageLabel(extractCitationPages(`${rawLabel} ${rawCitation}`));
  return pageLabel && !cleanLabel.includes(`(${pageLabel})`)
    ? `${cleanLabel} (${pageLabel})`
    : cleanLabel;
}

export function readableSourcePath(sourcePath = ''): string {
  const parts = String(sourcePath || '').split(/[\\/]+/).filter(Boolean);
  return String(parts[parts.length - 1] || '')
    .replace(/^FILE-\d{4,}__/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scrubTechnicalCitation(value = ''): string {
  return String(value || '')
    .replace(/\s*\([^)]*\bFILE-\d{4}\b[^)]*\)/gi, '')
    .replace(/\bFILE-\d{4}(?:\s+p\d+(?:\.b\d+)?)?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[\s,.;:()/-]+|[\s,.;:()/-]+$/g, '')
    .trim();
}

function extractCitationPages(value = ''): string[] {
  return uniqueValues(
    Array.from(String(value || '').matchAll(/\bFILE-\d{4}\s+p(\d+)(?:\.b\d+)?/gi))
      .map((match) => match[1])
      .filter(Boolean),
  );
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function formatPageLabel(pages: string[]): string {
  if (!pages.length) return '';
  if (pages.length === 1) return `page ${pages[0]}`;
  if (pages.length === 2) return `pages ${pages[0]} and ${pages[1]}`;
  return `pages ${pages.slice(0, -1).join(', ')}, and ${pages[pages.length - 1]}`;
}

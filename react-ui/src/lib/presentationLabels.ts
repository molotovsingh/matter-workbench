const LANE_LABELS: Record<string, string> = {
  '00_Inbox': 'Case Record',
  '10_Library': 'Source Record',
  '20_Workshop': 'Case Analysis',
  '30_Drafts': 'Drafts',
  '40_Dispatch': 'Ready to Send',
};

const KNOWN_ARTIFACT_LABELS: Array<[RegExp, string]> = [
  [/^matter\.json$/i, 'Matter details'],
  [/^00_Inbox\/Intake \d+ - [^/]+\/File Register\.csv$/i, 'File Register'],
  [/^10_Library\/Source Index\.json$/i, 'Source Labels'],
  [/^10_Library\/List of Dates\.(?:md|json|csv)$/i, 'List of Dates'],
  [/^20_Workshop\/Party and Officer Map\.md$/i, 'Party and Officer Map'],
  [/^20_Workshop\/Statute and Section Reading Guide\.md$/i, 'Statute and Section Reading Guide'],
  [/^30_Drafts\/Draft Legal Output\.md$/i, 'Draft Legal Output'],
];

export function humanizeArtifactPath(path = ''): string {
  const normalized = normalizePath(path);
  if (!normalized) return 'Output document';

  const known = KNOWN_ARTIFACT_LABELS.find(([pattern]) => pattern.test(normalized));
  if (known) return known[1];

  const parts = normalized.split('/').filter(Boolean);
  const lane = parts[0] ? LANE_LABELS[parts[0]] : '';
  const fileName = parts[parts.length - 1] || normalized;
  const readableName = humanizeFileName(fileName);

  return lane && readableName !== lane ? `${lane} / ${readableName}` : readableName;
}

export function humanizeFileName(name = ''): string {
  return String(name || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Output document';
}

export function technicalPathTitle(path = ''): string | undefined {
  const normalized = normalizePath(path);
  return normalized || undefined;
}

export function normalizePath(path = ''): string {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

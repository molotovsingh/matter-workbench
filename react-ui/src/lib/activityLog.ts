import { redactSensitiveText } from './secretRedaction';
import { cleanCommandLabel } from './nativeCommands';
import { humanizeArtifactPath } from './presentationLabels';

export interface CompactActivityRow {
  time: string;
  message: string;
}

const DEFAULT_ACTIVITY_LINE_CAP = 500;

export function normalizeActivityInput(input: string[] | string = []): string[] {
  const values = Array.isArray(input) ? input : String(input || '').split('\n');
  return values
    .map((line) => redactSensitiveText(String(line || '').trim()))
    .filter(Boolean);
}

export function stampActivityLines(
  input: string[] | string = [],
  timestamp = () => new Date().toLocaleTimeString([], { hour12: false }),
): string[] {
  const stamp = timestamp();
  return normalizeActivityInput(input).map((line) => `${stamp} ${line}`);
}

export function trimActivityLines(lines: string[] = [], lineCap = DEFAULT_ACTIVITY_LINE_CAP): string[] {
  if (!Number.isFinite(lineCap) || lineCap < 1 || lines.length <= lineCap) return lines.slice();
  return lines.slice(lines.length - lineCap);
}

export function formatCompactActivityLine(line: string): CompactActivityRow | null {
  const raw = String(line || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}:\d{2})(?::\d{2})?\s+(.+)$/);
  const time = match ? match[1].padStart(5, '0') : '';
  const body = match ? match[2] : raw;
  const message = body
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\b(?:10_Library|20_Workshop|30_Drafts|40_Dispatch)\/[^\s]+(?:\s+[^\s]+)*?\.(?:md|json|csv)\b/g, (path) => humanizeArtifactPath(path))
    .replace(/(^|\s)(\/[a-z][a-z0-9_-]*)(?=\s|$|[.,;:])/gi, (_match, prefix, command) => `${prefix}${cleanCommandLabel(command)}`)
    .replace(/\s+->\s+/g, ' → ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!message) return null;
  return { time, message: redactSensitiveText(message).replace(/\s+->\s+/g, ' → ') };
}

export function latestCompactActivityRows(lines: string[] = [], limit = 3): CompactActivityRow[] {
  return lines
    .slice(Math.max(0, lines.length - limit))
    .map(formatCompactActivityLine)
    .filter((row): row is CompactActivityRow => Boolean(row));
}

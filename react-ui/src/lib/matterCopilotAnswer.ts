import type { MatterCopilotAnswer } from '../types';

export function parseAskCommand(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const slash = text.match(/^\/ask\s+(.+)$/i);
  if (slash) return slash[1].trim() || null;
  const ask = text.match(/^ask\s+(.+)$/i);
  if (ask) return ask[1].trim() || null;
  return null;
}

export function formatMatterCopilotAnswer(answer: MatterCopilotAnswer): string {
  const status = answer.answer_status || 'not_found';
  const body = lawyerVisibleAnswerText(answer.answer_markdown) || fallbackForStatus(status);
  const parts = [body];

  const sourceLabels = visibleSourceLabels(answer);
  if (sourceLabels.length) {
    parts.push(`Sources: ${sourceLabels.join('; ')}`);
  }

  const warnings = visibleWarnings(answer.warnings || []).slice(0, 2);
  if (warnings.length) {
    parts.push(`Limits: ${warnings.join(' ')}`);
  }

  parts.push('Mode: chat-only answer from the current matter record.');

  if (status === 'not_found') {
    return `I could not answer that from the current matter record.\n\n${parts.join('\n\n')}`;
  }
  if (status === 'partial') {
    return `Partial answer from the current matter record.\n\n${parts.join('\n\n')}`;
  }
  if (status === 'blocked') {
    return `I cannot safely do that as a chat answer.\n\n${parts.join('\n\n')}`;
  }
  return parts.join('\n\n');
}

export function formatMatterCopilotError(message: string): string {
  const normalized = normalizeText(message);
  if (/unsupported citation/i.test(normalized)) {
    return [
      'I could not verify the sources for that answer.',
      'Run preparation again, then ask the question once more. If this keeps happening, send feedback so we can inspect the record.',
    ].join('\n\n');
  }
  if (/\b(openai|openrouter|gpt|llm|api key|provider|model|quota|billing|credit|insufficient funds)\b/i.test(normalized)) {
    return 'Assistant is temporarily unavailable. You can continue using the workspace.';
  }
  return `I could not answer from the current matter record: ${normalized || 'Unknown error'}`;
}

export function formatMatterCopilotTerminalError(message: string): string {
  return `[assistant] failed: ${formatMatterCopilotError(message).replace(/\s+/g, ' ').trim()}`;
}

function visibleSourceLabels(answer: MatterCopilotAnswer): string[] {
  const labels = [];
  const seen = new Set<string>();
  for (const source of answer.sources || []) {
    const label = normalizeText(source.source_label) || 'Source cited internally';
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= 4) break;
  }
  return labels;
}

function fallbackForStatus(status: string): string {
  if (status === 'blocked') return 'The request needs a more explicit workflow before the app should act on it.';
  return 'The current matter record does not contain enough support for a reliable answer.';
}

function lawyerVisibleAnswerText(value: unknown): string {
  return normalizeText(value)
    .replace(/\b[Tt]he packet supports that\b/g, 'The record indicates that')
    .replace(/\b[Tt]he packet supports\b/g, 'The record indicates')
    .replace(/\b[Tt]he supplied packet supports that\b/g, 'The record indicates that')
    .replace(/\b[Tt]he supplied packet supports\b/g, 'The record indicates')
    .replace(/\b[Tt]he bounded matter context supports that\b/g, 'The record indicates that')
    .replace(/\b[Tt]he bounded matter context supports\b/g, 'The record indicates')
    .replace(/\b[Tt]he context packet supports that\b/g, 'The record indicates that')
    .replace(/\b[Tt]he context packet supports\b/g, 'The record indicates')
    .replace(/\bfrom the packet\b/g, 'from the record')
    .replace(/\bin the packet\b/g, 'in the record')
    .replace(/\bsupplied packet\b/g, 'current record')
    .replace(/\bbounded matter context\b/g, 'current matter record')
    .replace(/\bcontext packet\b/g, 'matter record');
}

function visibleWarnings(values: unknown[]): string[] {
  const quality = [];
  const general = [];
  let omittedEvidence = false;
  for (const value of values) {
    const warning = lawyerVisibleWarning(value);
    if (!warning) continue;
    if (warning === OMITTED_EVIDENCE_WARNING) {
      if (omittedEvidence) continue;
      omittedEvidence = true;
    }
    if (/OCR|bad copy|poor quality|needs review|source documents are marked needs review/i.test(warning)) {
      quality.push(warning);
    } else if (warning !== OMITTED_EVIDENCE_WARNING) {
      general.push(warning);
    }
  }
  return [...quality, ...general, ...(omittedEvidence ? [OMITTED_EVIDENCE_WARNING] : [])];
}

const OMITTED_EVIDENCE_WARNING = 'Only part of the matter record was included in this quick answer; use the underlying sources for full review.';

function lawyerVisibleWarning(value: unknown): string {
  const warning = lawyerVisibleAnswerText(value);
  if (!warning) return '';
  if (/Omitted \d+ evidence block\(s\) due to maxBlocks=/i.test(warning)) return OMITTED_EVIDENCE_WARNING;
  if (/\b\d+\s+evidence blocks?\s+(were\s+)?omitted\b/i.test(warning)) return OMITTED_EVIDENCE_WARNING;
  if (/\bomitted\b.*\bevidence blocks?\b/i.test(warning)) return OMITTED_EVIDENCE_WARNING;
  if (/Truncated \d+ evidence block\(s\) due to maxCharsPerBlock=/i.test(warning)) return '';
  if (/Omitted \d+ source record\(s\) due to maxSources=/i.test(warning)) return OMITTED_EVIDENCE_WARNING;
  if (/maxBlocks|maxCharsPerBlock|maxSources|packet_schema|FILE-\d{4}/i.test(warning)) return '';
  return warning;
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

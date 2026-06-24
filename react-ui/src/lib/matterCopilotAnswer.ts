import { USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE, containsUserFacingRestrictedAiLanguage } from '../../../shared/user-facing-ai-language-policy.js';
import { redactSensitiveText } from './secretRedaction';
import type { MatterCopilotAnswer, MatterCopilotResearchAnswer } from '../types';

export function parseAskCommand(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const slash = text.match(/^\/ask\s+(.+)$/i);
  if (slash) return slash[1].trim() || null;
  const ask = text.match(/^ask\s+(.+)$/i);
  if (ask) return ask[1].trim() || null;
  return null;
}

export function parseResearchCommand(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const slash = text.match(/^\/research\s+(.+)$/i);
  if (slash) return slash[1].trim() || null;
  const research = text.match(/^research\s+(.+)$/i);
  if (research) return research[1].trim() || null;
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

export function formatMatterCopilotResearchAnswer(answer: MatterCopilotResearchAnswer): string {
  const status = answer.answer_status || 'not_found';
  const body = lawyerVisibleAnswerText(answer.answer_markdown) || fallbackForStatus(status);
  const parts = [`Research answer from public sources\n\n${body.replace(/^Research answer from public sources\s*/i, '').trim()}`.trim()];

  const matterLabels = visibleSourceLabels({ sources: answer.matter_sources || [] } as MatterCopilotAnswer);
  if (matterLabels.length) {
    parts.push(`Matter sources: ${matterLabels.join('; ')}`);
  }

  const publicLabels = visiblePublicSourceLabels(answer).slice(0, 6);
  if (publicLabels.length) {
    parts.push(`Public sources: ${publicLabels.join('; ')}`);
  }

  const warnings = visibleWarnings(answer.warnings || []).slice(0, 2);
  if (warnings.length) {
    parts.push(`Limits: ${warnings.join(' ')}`);
  }

  if (!/verify authorities before relying or filing/i.test(parts.join('\n'))) {
    parts.push('_Verify authorities before relying or filing._');
  }

  parts.push('Mode: research answer from public sources and the current matter record.');

  if (status === 'not_found') {
    return `I could not find useful public sources for that research question.\n\n${parts.join('\n\n')}`;
  }
  if (status === 'partial') {
    return `Partial research answer from public sources.\n\n${parts.join('\n\n')}`;
  }
  if (status === 'blocked') {
    return `I cannot safely do that as a research answer.\n\n${parts.join('\n\n')}`;
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
  if (containsUserFacingRestrictedAiLanguage(normalized)) {
    return USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE;
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

function visiblePublicSourceLabels(answer: MatterCopilotResearchAnswer): string[] {
  const labels = [];
  const seen = new Set<string>();
  for (const source of answer.public_sources || []) {
    const id = normalizeText(source.id);
    const title = normalizeText(source.title) || normalizeText(source.url) || id || 'Public source';
    const url = normalizeText(source.url);
    const labelText = url && !title.includes(url) ? `${title} (${url})` : title;
    const label = id && !labelText.startsWith(id) ? `${id} — ${labelText}` : labelText;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function fallbackForStatus(status: string): string {
  if (status === 'blocked') return 'The request needs a more explicit workflow before the app should act on it.';
  return 'The current matter record does not contain enough support for a reliable answer.';
}

const LAWYER_VISIBLE_ANSWER_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b[Tt]he packet supports that\b/g, 'The record indicates that'],
  [/\b[Tt]he packet supports\b/g, 'The record indicates'],
  [/\b[Tt]he supplied packet supports that\b/g, 'The record indicates that'],
  [/\b[Tt]he supplied packet supports\b/g, 'The record indicates'],
  [/\b[Tt]he bounded matter context supports that\b/g, 'The record indicates that'],
  [/\b[Tt]he bounded matter context supports\b/g, 'The record indicates'],
  [/\b[Tt]he context packet supports that\b/g, 'The record indicates that'],
  [/\b[Tt]he context packet supports\b/g, 'The record indicates'],
  [/\bfrom the packet\b/g, 'from the record'],
  [/\bin the packet\b/g, 'in the record'],
  [/\bsupplied packet\b/g, 'current record'],
  [/\bbounded matter context\b/g, 'current matter record'],
  [/\bcontext packet\b/g, 'matter record'],
];

function lawyerVisibleAnswerText(value: unknown): string {
  return LAWYER_VISIBLE_ANSWER_REPLACEMENTS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    normalizeText(value),
  );
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
  return redactSensitiveText(String(value || '')).replace(/\s+/g, ' ').trim();
}

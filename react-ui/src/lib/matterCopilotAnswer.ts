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
  const body = normalizeText(answer.answer_markdown) || fallbackForStatus(status);
  const parts = [body];

  const sourceLabels = visibleSourceLabels(answer);
  if (sourceLabels.length) {
    parts.push(`Sources: ${sourceLabels.join('; ')}`);
  }

  const warnings = (answer.warnings || []).map(normalizeText).filter(Boolean).slice(0, 2);
  if (warnings.length) {
    parts.push(`Limits: ${warnings.join(' ')}`);
  }

  if (answer.ai_run?.provider && answer.ai_run?.model) {
    parts.push(`Mode: chat-only answer from bounded matter context (${answer.ai_run.provider} / ${answer.ai_run.model}).`);
  } else {
    parts.push('Mode: chat-only answer from bounded matter context.');
  }

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
  return 'The current bounded matter context does not contain enough support for a reliable answer.';
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export interface CopilotModelPreset {
  label: string;
  shortLabel: string;
  provider: 'openai-direct' | 'openrouter';
  model: string;
}

export const COPILOT_MODEL_PRESETS: CopilotModelPreset[] = [
  { label: 'GPT-5.4', shortLabel: '5.4', provider: 'openai-direct', model: 'gpt-5.4' },
  { label: 'GPT-5.4 Mini', shortLabel: '5.4 Mini', provider: 'openai-direct', model: 'gpt-5.4-mini' },
  { label: 'GPT-4.1', shortLabel: '4.1', provider: 'openai-direct', model: 'gpt-4.1' },
  { label: 'Claude Sonnet 4.6', shortLabel: 'Sonnet 4.6', provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
  { label: 'Claude Sonnet 4.5', shortLabel: 'Sonnet 4.5', provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' },
];

export function copilotPresetValue(provider?: string, model?: string) {
  return `${provider || ''}|${model || ''}`;
}

export function findCopilotPreset(provider?: string, model?: string) {
  return COPILOT_MODEL_PRESETS.find((preset) => preset.provider === provider && preset.model === model) || null;
}

export function copilotShortLabel(provider?: string, model?: string) {
  return findCopilotPreset(provider, model)?.shortLabel || model || 'Copilot';
}

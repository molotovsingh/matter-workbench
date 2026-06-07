export interface CopilotModelPreset {
  label: string;
  shortLabel: string;
  provider: 'openai-direct' | 'openrouter';
  model: string;
}

export const COPILOT_MODEL_PRESETS: CopilotModelPreset[] = [
  { label: 'Low', shortLabel: 'Low', provider: 'openrouter', model: 'openai/gpt-4.1' },
  { label: 'Medium', shortLabel: 'Medium', provider: 'openai-direct', model: 'gpt-5.4-mini' },
  { label: 'High', shortLabel: 'High', provider: 'openai-direct', model: 'gpt-5.4' },
];

export function copilotPresetValue(provider?: string, model?: string) {
  return `${provider || ''}|${model || ''}`;
}

export function findCopilotPreset(provider?: string, model?: string) {
  return COPILOT_MODEL_PRESETS.find((preset) => preset.provider === provider && preset.model === model) || null;
}

export function copilotShortLabel(provider?: string, model?: string) {
  return findCopilotPreset(provider, model)?.shortLabel || 'Custom';
}

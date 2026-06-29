import type { CopilotModelPreset } from '../types';

export function copilotPresetValue(provider?: string, model?: string) {
  return `${provider || ''}|${model || ''}`;
}

export function findCopilotPreset(
  presets: CopilotModelPreset[] | undefined,
  provider?: string,
  model?: string,
) {
  return (presets || []).find((preset) => preset.provider === provider && preset.model === model) || null;
}

export function copilotShortLabel(
  presets: CopilotModelPreset[] | undefined,
  provider?: string,
  model?: string,
) {
  return findCopilotPreset(presets, provider, model)?.shortLabel || 'Custom';
}

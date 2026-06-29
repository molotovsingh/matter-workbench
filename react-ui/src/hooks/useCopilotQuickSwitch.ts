import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApp } from '../store/AppContext';
import { getErrorMessage } from '../lib/errors';
import {
  copilotPresetValue,
  copilotShortLabel,
  findCopilotPreset,
} from '../lib/copilotModels';
import type { CopilotModelPreset } from '../types';

export interface CopilotQuickSwitchState {
  provider: string;
  model: string;
  switching: boolean;
  status: string;
  selectValue: string;
  presetExists: boolean;
  currentLabel: string;
  presets: CopilotModelPreset[];
  handleModelChange: (value: string) => Promise<void>;
}

export function useCopilotQuickSwitch(canManageCopilotSettings: boolean): CopilotQuickSwitchState {
  const { appendTerminal } = useApp();
  const [provider, setProvider] = useState('openai-direct');
  const [model, setModel] = useState('gpt-5.4');
  const [presets, setPresets] = useState<CopilotModelPreset[]>([]);
  const [switching, setSwitching] = useState(false);
  const [status, setStatus] = useState('');
  const preset = findCopilotPreset(presets, provider, model);
  const selectValue = preset ? copilotPresetValue(provider, model) : '';

  useEffect(() => {
    if (!canManageCopilotSettings) return undefined;
    let cancelled = false;
    api.getAiSettings().then((settings) => {
      if (cancelled) return;
      setPresets(settings.copilotModelPresets || []);
      const task = settings.aiTasks?.find((row) => row.task === 'copilot_answer');
      if (task?.provider) setProvider(task.provider);
      if (task?.model) setModel(task.model);
    }).catch((error) => {
      if (cancelled) return;
      appendTerminal([`[assistant] settings unavailable: ${getErrorMessage(error)}`]);
    });
    return () => {
      cancelled = true;
    };
  }, [appendTerminal, canManageCopilotSettings]);

  const handleModelChange = useCallback(async (value: string) => {
    if (!canManageCopilotSettings) return;
    const nextPreset = presets.find((candidate) => copilotPresetValue(candidate.provider, candidate.model) === value);
    if (!nextPreset || switching) return;
    if (nextPreset.provider === provider && nextPreset.model === model) return;

    const previousProvider = provider;
    const previousModel = model;
    setProvider(nextPreset.provider);
    setModel(nextPreset.model);
    setSwitching(true);
    setStatus(`Testing ${nextPreset.shortLabel}…`);
    appendTerminal([`[assistant] testing ${nextPreset.shortLabel}`]);

    try {
      const settings = await api.saveAiSettings({
        copilotProvider: nextPreset.provider,
        copilotModel: nextPreset.model,
      });
      const task = settings.aiTasks?.find((row) => row.task === 'copilot_answer');
      setProvider(task?.provider || nextPreset.provider);
      setModel(task?.model || nextPreset.model);
      const nextPresets = settings.copilotModelPresets || presets;
      setPresets(nextPresets);
      setStatus(`Using ${copilotShortLabel(nextPresets, task?.provider || nextPreset.provider, task?.model || nextPreset.model)}`);
      appendTerminal([`[assistant] setting saved: ${nextPreset.shortLabel}`]);
    } catch (error) {
      setProvider(previousProvider);
      setModel(previousModel);
      setStatus(`Switch failed. Still using ${copilotShortLabel(presets, previousProvider, previousModel)}.`);
      appendTerminal([`[assistant] setting change failed: ${getErrorMessage(error)}`]);
    } finally {
      setSwitching(false);
    }
  }, [appendTerminal, canManageCopilotSettings, model, presets, provider, switching]);

  return {
    provider,
    model,
    switching,
    status,
    selectValue,
    presetExists: Boolean(preset),
    currentLabel: copilotShortLabel(presets, provider, model),
    presets,
    handleModelChange,
  };
}

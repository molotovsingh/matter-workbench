import { copilotPresetValue } from '../../lib/copilotModels';
import type { CopilotQuickSwitchState } from '../../hooks/useCopilotQuickSwitch';

interface Props {
  switcher: CopilotQuickSwitchState;
}

export default function CopilotQuickSwitch({ switcher }: Props) {
  return (
    <label className="copilot-model-switch">
      <span>Copilot</span>
      <select
        aria-label="Copilot strength"
        value={switcher.selectValue}
        onChange={(event) => { void switcher.handleModelChange(event.target.value); }}
        disabled={switcher.switching}
      >
        {!switcher.presetExists && (
          <option value="">{switcher.currentLabel}</option>
        )}
        {switcher.presets.map((preset) => (
          <option key={copilotPresetValue(preset.provider, preset.model)} value={copilotPresetValue(preset.provider, preset.model)}>
            {preset.shortLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

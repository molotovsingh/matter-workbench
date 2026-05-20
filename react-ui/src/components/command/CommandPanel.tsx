import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import SkillIdeaSession from './SkillIdeaSession';
import { latestCompactActivityRows } from '../../lib/activityLog';
import { parseSkillIdeaText } from '../../lib/skillIdeaInput';
import { formatIntentDiscoveryGuidance, shouldStartSkillIdeaSessionFromIntent } from '../../lib/skillIntentRouting';
import { COMMAND_PANEL_NATIVE_SUGGESTIONS } from '../../lib/nativeCommands';
import { getErrorMessage } from '../../lib/errors';
import {
  COPILOT_MODEL_PRESETS,
  copilotPresetValue,
  copilotShortLabel,
  findCopilotPreset,
} from '../../lib/copilotModels';

interface CommandSuggestion {
  label: string;
  description: string;
  command: string;
}

const STATIC_SUGGESTIONS: CommandSuggestion[] = [
  { label: 'New skill', description: 'Design a reusable matter skill', command: 'new skill' },
  { label: 'Find a matter', description: 'Open matter picker', command: 'find a matter' },
  ...COMMAND_PANEL_NATIVE_SUGGESTIONS,
];

interface Props {
  onCommand: (command: string) => void;
  onTransientCopilotQuestion?: (question: string) => Promise<void> | void;
  reportText?: string | null;
  onCopyReport?: () => void;
}

export default function CommandPanel({ onCommand, onTransientCopilotQuestion, reportText, onCopyReport }: Props) {
  const { state, dispatch, appendTerminal, commandPanelRef } = useApp();
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [skillIdeaInput, setSkillIdeaInput] = useState<string | null>(null);
  const [copilotProvider, setCopilotProvider] = useState('openai-direct');
  const [copilotModel, setCopilotModel] = useState('gpt-5.4-mini');
  const [copilotSwitching, setCopilotSwitching] = useState(false);
  const [copilotSwitchStatus, setCopilotSwitchStatus] = useState('');
  const inputOverrideRef = useRef<((input: string) => boolean) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityRows = latestCompactActivityRows(state.activityLines);
  const copilotPreset = findCopilotPreset(copilotProvider, copilotModel);
  const copilotSelectValue = copilotPreset
    ? copilotPresetValue(copilotProvider, copilotModel)
    : '';

  useEffect(() => {
    let cancelled = false;
    api.getAiSettings().then((settings) => {
      if (cancelled) return;
      const task = settings.aiTasks?.find((row) => row.task === 'copilot_answer');
      if (task?.provider) setCopilotProvider(task.provider);
      if (task?.model) setCopilotModel(task.model);
    }).catch((error) => {
      if (cancelled) return;
      appendTerminal([`[copilot] model switch unavailable: ${getErrorMessage(error)}`]);
    });
    return () => {
      cancelled = true;
    };
  }, [appendTerminal]);

  function handleInputChange(value: string) {
    setInput(value);
    setActiveSuggestion(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const q = value.toLowerCase();
    const matched = STATIC_SUGGESTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.command.toLowerCase().includes(q),
    );
    setSuggestions(matched.slice(0, 5));
    setShowSuggestions(matched.length > 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeSuggestion].command);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }

  function pickSuggestion(command: string) {
    setInput(command);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
  }

  async function handleCopilotModelChange(value: string) {
    const preset = COPILOT_MODEL_PRESETS.find((candidate) => copilotPresetValue(candidate.provider, candidate.model) === value);
    if (!preset || copilotSwitching) return;
    if (preset.provider === copilotProvider && preset.model === copilotModel) return;

    const previousProvider = copilotProvider;
    const previousModel = copilotModel;
    setCopilotProvider(preset.provider);
    setCopilotModel(preset.model);
    setCopilotSwitching(true);
    setCopilotSwitchStatus(`Testing ${preset.shortLabel}…`);
    appendTerminal([`[copilot] testing ${preset.provider} / ${preset.model}`]);

    try {
      const settings = await api.saveAiSettings({
        copilotProvider: preset.provider,
        copilotModel: preset.model,
      });
      const task = settings.aiTasks?.find((row) => row.task === 'copilot_answer');
      setCopilotProvider(task?.provider || preset.provider);
      setCopilotModel(task?.model || preset.model);
      setCopilotSwitchStatus(`Using ${copilotShortLabel(task?.provider || preset.provider, task?.model || preset.model)}`);
      appendTerminal([`[copilot] model saved: ${preset.shortLabel}`]);
    } catch (error) {
      setCopilotProvider(previousProvider);
      setCopilotModel(previousModel);
      setCopilotSwitchStatus(`Switch failed. Still using ${copilotShortLabel(previousProvider, previousModel)}.`);
      appendTerminal([`[copilot] model switch failed: ${getErrorMessage(error)}`]);
    } finally {
      setCopilotSwitching(false);
    }
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd || state.isCommandRunning) return;
    setInput('');
    setShowSuggestions(false);

    if (inputOverrideRef.current?.(cmd)) {
      return;
    }

    const ideaParsed = parseSkillIdeaText(cmd);
    if (ideaParsed !== null) {
      if (ideaParsed === '') {
        setSkillIdeaInput(cmd);
        return;
      }
      const matterName = state.activeMatter?.name ?? null;
      dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
      appendTerminal([`[skill-idea] checking whether this is one-time or reusable…`]);
      try {
        const decision = await api.checkIntent({ userRequest: cmd, matterName: matterName ?? undefined });
        if (shouldStartSkillIdeaSessionFromIntent(decision)) {
          setSkillIdeaInput(cmd);
        } else if (decision.decision === 'transient_copilot' && onTransientCopilotQuestion) {
          appendTerminal(['[skill-idea] routed to copilot answer']);
          await onTransientCopilotQuestion(cmd);
        } else {
          dispatch({ type: 'SET_COMMAND_COPY', payload: formatIntentDiscoveryGuidance(decision) });
          appendTerminal([`[skill-idea] routed away from new skill: ${decision.decision}`]);
        }
        await api.logCommandInteraction({ command: cmd, matterName: matterName ?? undefined });
      } catch (error) {
        const message = getErrorMessage(error);
        setSkillIdeaInput(cmd);
        appendTerminal([`[skill-idea] intent check unavailable; starting interview: ${message}`]);
      } finally {
        dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
      }
      return;
    }

    onCommand(cmd);
    try {
      await api.logCommandInteraction({ command: cmd, matterName: state.activeMatter?.name });
    } catch { /* fire-and-forget */ }
  }, [input, state.isCommandRunning, state.activeMatter?.name, onCommand, onTransientCopilotQuestion]);

  return (
    <aside className="command-panel" aria-label="Command box">
      <div className="command-panel-header" style={{ order: 0 }}>
        <div>
          <div className="command-panel-kicker">Matter Assistant</div>
          <h2>What do you need?</h2>
        </div>
        <label className="copilot-model-switch">
          <span>Copilot</span>
          <select
            aria-label="Copilot model"
            value={copilotSelectValue}
            onChange={(event) => { void handleCopilotModelChange(event.target.value); }}
            disabled={copilotSwitching}
          >
            {!copilotPreset && (
              <option value="">{copilotShortLabel(copilotProvider, copilotModel)}</option>
            )}
            {COPILOT_MODEL_PRESETS.map((preset) => (
              <option key={copilotPresetValue(preset.provider, preset.model)} value={copilotPresetValue(preset.provider, preset.model)}>
                {preset.shortLabel}
              </option>
            ))}
          </select>
        </label>
      </div>

      {copilotSwitchStatus && (
        <div className="copilot-model-status" style={{ order: 1 }}>
          {copilotSwitchStatus}
        </div>
      )}

      <p className="command-panel-copy" style={{ order: 2 }}>
        {state.commandCopyText}
      </p>

      <div className="command-panel-examples" style={{ order: 3 }} aria-label="Command examples">
        <code>new skill</code>
        <code>find a matter</code>
        <code>prepare matter</code>
      </div>

      {/* Skill idea interview session */}
      {skillIdeaInput !== null && (
        <div className="command-panel-session" style={{ order: 4 }}>
          <SkillIdeaSession
            initialInput={skillIdeaInput}
            onClose={() => setSkillIdeaInput(null)}
            onInputOverride={(handler) => { inputOverrideRef.current = handler; }}
          />
        </div>
      )}

      <form className="ai-command-form" style={{ order: 5 }} autoComplete="off" onSubmit={handleSubmit}>
        <label className="command-panel-label" htmlFor="aiCommandInput">Ask or run</label>
        <div className="command-panel-input-row">
          <input
            id="aiCommandInput"
            ref={commandPanelRef as React.RefObject<HTMLInputElement>}
            type="text"
            placeholder={state.activeMatter ? `Ask about ${state.activeMatter.name}…` : 'Ask a question or pick a matter first'}
            spellCheck
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={state.isCommandRunning}
          />
          <button
            id="aiCommandSubmit"
            type="submit"
            aria-label="Run"
            title="Run"
            disabled={state.isCommandRunning || !input.trim()}
          >
            →
          </button>
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div className="command-suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <button
                key={s.command}
                type="button"
                className={`command-suggestion${i === activeSuggestion ? ' active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s.command); }}
              >
                <strong>{s.label}</strong>
                <span>{s.description}</span>
              </button>
            ))}
          </div>
        )}
      </form>

      {activityRows.length > 0 && (
        <div className="command-activity-strip" style={{ order: 6 }}>
          <div className="command-activity-title">Recent activity</div>
          {activityRows.map((entry, i) => (
            <div key={i} className="command-activity-row">
              <time>{entry.time}</time>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="command-panel-actions" style={{ order: 7 }}>
        {reportText && (
          <button
            type="button"
            className="secondary"
            onClick={onCopyReport}
          >
            Copy Report
          </button>
        )}
      </div>

      <p className="command-panel-note" style={{ order: 8 }}>
        Source-backed answers are one question at a time and do not remember earlier chat. Skill work may use paid AI.
      </p>
    </aside>
  );
}

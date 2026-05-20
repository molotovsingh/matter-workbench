import { useState, useRef, useCallback } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import SkillIdeaSession from './SkillIdeaSession';
import { latestCompactActivityRows } from '../../lib/activityLog';
import { parseSkillIdeaText } from '../../lib/skillIdeaInput';
import { formatIntentDiscoveryGuidance, shouldStartSkillIdeaSessionFromIntent } from '../../lib/skillIntentRouting';
import { COMMAND_PANEL_NATIVE_SUGGESTIONS } from '../../lib/nativeCommands';
import { getErrorMessage } from '../../lib/errors';

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
  const inputOverrideRef = useRef<((input: string) => boolean) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityRows = latestCompactActivityRows(state.activityLines);

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
      </div>

      <p className="command-panel-copy" style={{ order: 1 }}>
        {state.commandCopyText}
      </p>

      <div className="command-panel-examples" style={{ order: 2 }} aria-label="Command examples">
        <code>new skill</code>
        <code>find a matter</code>
        <code>prepare matter</code>
      </div>

      {/* Skill idea interview session */}
      {skillIdeaInput !== null && (
        <div className="command-panel-session" style={{ order: 3 }}>
          <SkillIdeaSession
            initialInput={skillIdeaInput}
            onClose={() => setSkillIdeaInput(null)}
            onInputOverride={(handler) => { inputOverrideRef.current = handler; }}
          />
        </div>
      )}

      <form className="ai-command-form" style={{ order: 4 }} autoComplete="off" onSubmit={handleSubmit}>
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
        <div className="command-activity-strip" style={{ order: 5 }}>
          <div className="command-activity-title">Recent activity</div>
          {activityRows.map((entry, i) => (
            <div key={i} className="command-activity-row">
              <time>{entry.time}</time>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="command-panel-actions" style={{ order: 6 }}>
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

      <p className="command-panel-note" style={{ order: 7 }}>
        Source-backed answers are one question at a time and do not remember earlier chat. Skill work may use paid AI.
      </p>
    </aside>
  );
}

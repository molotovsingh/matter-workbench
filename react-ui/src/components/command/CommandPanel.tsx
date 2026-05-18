import { useState, useRef, useCallback } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import SkillIdeaSession, { parseSkillIdeaText } from './SkillIdeaSession';
import { COMMAND_PANEL_NATIVE_SUGGESTIONS } from '../../lib/nativeCommands';

interface CommandSuggestion {
  label: string;
  description: string;
  command: string;
}

const STATIC_SUGGESTIONS: CommandSuggestion[] = [
  { label: 'New skill', description: 'Create a custom AI skill', command: 'new skill' },
  { label: 'Find a matter', description: 'Open matter picker', command: 'find a matter' },
  ...COMMAND_PANEL_NATIVE_SUGGESTIONS,
];

interface Props {
  onCommand: (command: string) => void;
  reportText?: string | null;
  onCopyReport?: () => void;
}

export default function CommandPanel({ onCommand, reportText, onCopyReport }: Props) {
  const { state, commandPanelRef } = useApp();
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [activityLog, setActivityLog] = useState<Array<{ time: string; text: string }>>([]);
  const [skillIdeaInput, setSkillIdeaInput] = useState<string | null>(null);
  const inputOverrideRef = useRef<((input: string) => boolean) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function addActivity(text: string) {
    const now = new Date();
    const time = now.toTimeString().slice(0, 5);
    setActivityLog((prev) => [...prev.slice(-4), { time, text }]);
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd || state.isCommandRunning) return;
    setInput('');
    setShowSuggestions(false);

    if (inputOverrideRef.current?.(cmd)) {
      addActivity(cmd);
      return;
    }

    const ideaParsed = parseSkillIdeaText(cmd);
    if (ideaParsed !== null) {
      setSkillIdeaInput(cmd);
      addActivity(cmd);
      return;
    }

    addActivity(cmd);
    onCommand(cmd);
    try {
      await api.logCommandInteraction({ command: cmd, matterName: state.activeMatter?.name });
    } catch { /* fire-and-forget */ }
  }, [input, state.isCommandRunning, state.activeMatter?.name, onCommand]);

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

      {activityLog.length > 0 && (
        <div className="command-activity-strip" style={{ order: 5 }}>
          <div className="command-activity-title">Recent</div>
          {activityLog.map((entry, i) => (
            <div key={i} className="command-activity-row">
              <time>{entry.time}</time>
              <span>{entry.text}</span>
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
        Paid AI actions ask before running. New skills are tested with a sample before they become runnable.
      </p>
    </aside>
  );
}

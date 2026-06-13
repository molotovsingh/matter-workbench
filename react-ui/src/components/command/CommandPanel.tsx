import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import SkillIdeaSession from './SkillIdeaSession';
import { latestCompactActivityRows } from '../../lib/activityLog';
import { parseSkillIdeaText } from '../../lib/skillIdeaInput';
import {
  formatIntentDiscoveryGuidance,
  intentChoiceLabels,
  isConfigurableExistingSkillChoice,
  isExistingSkillChoice,
  shouldAutoStartConfigurableSkillImprovement,
  shouldStartSkillIdeaSessionFromIntent,
} from '../../lib/skillIntentRouting';
import { COMMAND_PANEL_NATIVE_SUGGESTIONS } from '../../lib/nativeCommands';
import { getErrorMessage } from '../../lib/errors';
import { DEFAULT_COMMAND_COPY_TEXT } from '../../lib/commandPanelCopy';
import {
  COPILOT_MODEL_PRESETS,
  copilotPresetValue,
  copilotShortLabel,
  findCopilotPreset,
} from '../../lib/copilotModels';
import { humanizeArtifactPath } from '../../lib/presentationLabels';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';
import { buildPrivateBetaFeedbackDraft } from '../../lib/privateBetaFeedback';
import type { ConfigurableSkill, PrivateBetaFeedbackChoice } from '../../types';
import type { SkillRouterDecision } from '../../types';

interface CommandSuggestion {
  label: string;
  description: string;
  command: string;
  customSkill?: boolean;
}

const CUSTOM_SKILL_MODIFICATION_RE = /\b(improve|change|update|modify|revise|refine|adjust|tweak|rewrite|rework)\b/i;

function looksLikeCustomSkillModification(input: string, suggestions: CommandSuggestion[]): boolean {
  if (!CUSTOM_SKILL_MODIFICATION_RE.test(input)) return false;
  const lowerInput = input.toLowerCase();
  return suggestions.some((suggestion) => {
    if (!suggestion.customSkill) return false;
    const slash = suggestion.command.toLowerCase();
    const label = suggestion.label.toLowerCase();
    return Boolean(slash && lowerInput.includes(slash))
      || Boolean(label && lowerInput.includes(label));
  });
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
  pendingConfigurableOverwrite?: PendingConfigurableOverwrite | null;
  onConfirmConfigurableOverwrite?: () => void;
  onCancelConfigurableOverwrite?: () => void;
}

interface PendingIntentChoice {
  command: string;
  decision: SkillRouterDecision;
}

interface PendingConfigurableOverwrite {
  slash: string;
  skillLabel: string;
  matterName: string;
  artifactPath?: string | null;
}

export default function CommandPanel({
  onCommand,
  onTransientCopilotQuestion,
  reportText,
  onCopyReport,
  pendingConfigurableOverwrite = null,
  onConfirmConfigurableOverwrite,
  onCancelConfigurableOverwrite,
}: Props) {
  const { state, dispatch, appendTerminal, commandPanelRef } = useApp();
  const [input, setInput] = useState('');
  const [baseSuggestions, setBaseSuggestions] = useState<CommandSuggestion[]>(STATIC_SUGGESTIONS);
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [skillIdeaInput, setSkillIdeaInput] = useState<string | null>(null);
  const [pendingIntentChoice, setPendingIntentChoice] = useState<PendingIntentChoice | null>(null);
  const [copilotProvider, setCopilotProvider] = useState('openrouter');
  const [copilotModel, setCopilotModel] = useState('openai/gpt-4.1');
  const [copilotSwitching, setCopilotSwitching] = useState(false);
  const [copilotSwitchStatus, setCopilotSwitchStatus] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackChoice, setFeedbackChoice] = useState<PrivateBetaFeedbackChoice | ''>('');
  const [feedbackTryingToDo, setFeedbackTryingToDo] = useState('');
  const [feedbackHappenedInstead, setFeedbackHappenedInstead] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const inputOverrideRef = useRef<((input: string) => boolean) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsLoadSeqRef = useRef(0);
  const lastActiveMatterNameRef = useRef(state.activeMatter?.name ?? null);
  const activityRows = latestCompactActivityRows(state.activityLines);
  const canManageCopilotSettings = canSeeOperatorSurface(state.authEnabled, state.authUser);
  const copilotPreset = findCopilotPreset(copilotProvider, copilotModel);
  const copilotSelectValue = copilotPreset
    ? copilotPresetValue(copilotProvider, copilotModel)
    : '';
  const choiceLabels = pendingIntentChoice ? intentChoiceLabels(pendingIntentChoice.decision) : null;
  const primaryChoiceNeedsCopilot = pendingIntentChoice
    ? !isExistingSkillChoice(pendingIntentChoice.decision)
    : false;
  const feedbackDraft = buildPrivateBetaFeedbackDraft({
    choice: feedbackChoice,
    tryingToDo: feedbackTryingToDo,
    happenedInstead: feedbackHappenedInstead,
  });
  const canSubmitFeedback = Boolean(feedbackDraft) && !feedbackSubmitting;

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

  const loadCommandSuggestions = useCallback(async () => {
    const seq = suggestionsLoadSeqRef.current + 1;
    suggestionsLoadSeqRef.current = seq;
    try {
      const result = await api.getConfigurableSkills();
      if (suggestionsLoadSeqRef.current !== seq) return;
      const customSuggestions = (result.skills || [])
        .filter((skill: ConfigurableSkill) => {
          if (skill.status !== 'active') return false;
          return Boolean(skill.slash);
        })
        .map((skill) => ({
          label: skill.title || skill.slash,
          description: skill.description || 'Run this custom skill',
          command: skill.slash,
          customSkill: true,
        }));
      setBaseSuggestions([...STATIC_SUGGESTIONS, ...customSuggestions]);
    } catch (error) {
      if (suggestionsLoadSeqRef.current !== seq) return;
      appendTerminal([`[skills] command suggestions unavailable: ${getErrorMessage(error)}`]);
      setBaseSuggestions(STATIC_SUGGESTIONS);
    }
  }, [appendTerminal]);

  useEffect(() => {
    void loadCommandSuggestions();
  }, [loadCommandSuggestions]);

  const resetCommandPanel = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    inputOverrideRef.current = null;
    setInput('');
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    setSkillIdeaInput(null);
    setPendingIntentChoice(null);
    setCopilotSwitchStatus('');
    dispatch({ type: 'SET_COMMAND_COPY', payload: DEFAULT_COMMAND_COPY_TEXT });
    void loadCommandSuggestions();
  }, [dispatch, loadCommandSuggestions]);

  useEffect(() => {
    const activeMatterName = state.activeMatter?.name ?? null;
    if (lastActiveMatterNameRef.current === activeMatterName) return;
    lastActiveMatterNameRef.current = activeMatterName;
    resetCommandPanel();
  }, [resetCommandPanel, state.activeMatter?.name]);

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
    const matched = baseSuggestions.filter(
      (s) => s.label.toLowerCase().includes(q) || s.command.toLowerCase().includes(q),
    );
    setSuggestions(matched.slice(0, 12));
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
    setPendingIntentChoice(null);
  }

  function runExampleCommand(command: string) {
    if (state.isCommandRunning) return;
    setInput('');
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    setPendingIntentChoice(null);
    if (command === 'new skill') {
      setSkillIdeaInput(command);
      return;
    }
    setSkillIdeaInput(null);
    onCommand(command);
    void api.logCommandInteraction({ command, matterName: state.activeMatter?.name });
  }

  async function handleCopilotModelChange(value: string) {
    if (!canManageCopilotSettings) return;
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

  async function handleSubmitFeedback(e: React.FormEvent) {
    e.preventDefault();
    const draft = buildPrivateBetaFeedbackDraft({
      choice: feedbackChoice,
      tryingToDo: feedbackTryingToDo,
      happenedInstead: feedbackHappenedInstead,
    });
    if (!draft || feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    setFeedbackMessage('');
    try {
      await api.submitPrivateBetaFeedback({
        ...draft,
        matterName: state.activeMatter?.name,
        context: {
          screen: state.activeTab,
          currentView: state.activeView,
          route: typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '',
          activeMatterName: state.activeMatter?.name,
          activeMatterFolder: state.activeMatter?.folderName,
          runtimeMode: state.config?.runtimeStorageMode || 'filesystem',
          viewport: viewportLabel(),
          recentActivity: activityRows.map((row) => `${row.time} ${row.message}`),
          providerRoutes: [{ task: 'copilot_answer', provider: copilotProvider, model: copilotModel }],
          visibleError: feedbackHappenedInstead,
        },
      });
      setFeedbackChoice('');
      setFeedbackTryingToDo('');
      setFeedbackHappenedInstead('');
      setFeedbackMessage('');
      setFeedbackOpen(false);
      appendTerminal(['[feedback] saved private beta feedback']);
    } catch (error) {
      setFeedbackMessage(`Could not save feedback: ${getErrorMessage(error)}`);
      appendTerminal([`[feedback] save failed: ${getErrorMessage(error)}`]);
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  async function answerPendingIntentOnce() {
    if (!pendingIntentChoice || state.isCommandRunning) return;
    if (isConfigurableExistingSkillChoice(pendingIntentChoice.decision)) {
      buildPendingIntentSkill('Improve existing skill');
      return;
    }
    const matchedSkill = pendingIntentChoice.decision.matched_skill || '';
    if (isExistingSkillChoice(pendingIntentChoice.decision) && matchedSkill) {
      setPendingIntentChoice(null);
      appendTerminal([`[skill-idea] user chose existing skill ${matchedSkill}`]);
      onCommand(matchedSkill);
      await api.logCommandInteraction({ command: matchedSkill, matterName: state.activeMatter?.name });
      return;
    }
    if (!onTransientCopilotQuestion) return;
    const command = pendingIntentChoice.command;
    setPendingIntentChoice(null);
    dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    appendTerminal(['[skill-idea] user chose one-time answer']);
    try {
      await onTransientCopilotQuestion(command);
      await api.logCommandInteraction({ command, matterName: state.activeMatter?.name });
    } finally {
      dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }

  function buildPendingIntentSkill(actionLabel = 'Build reusable skill') {
    if (!pendingIntentChoice || state.isCommandRunning) return;
    const command = pendingIntentChoice.command;
    const matchedSkill = pendingIntentChoice.decision.matched_skill || '';
    const improveExisting = isConfigurableExistingSkillChoice(pendingIntentChoice.decision)
      && actionLabel === 'Improve existing skill'
      && matchedSkill;
    setPendingIntentChoice(null);
    appendTerminal([
      improveExisting
        ? `[skill-idea] user chose to improve ${matchedSkill}`
        : '[skill-idea] user chose reusable skill',
    ]);
    setSkillIdeaInput(improveExisting ? `Improve ${matchedSkill}: ${command}` : command);
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd || state.isCommandRunning) return;
    setInput('');
    setShowSuggestions(false);
    setPendingIntentChoice(null);

    if (inputOverrideRef.current?.(cmd)) {
      return;
    }

    const ideaParsed = parseSkillIdeaText(cmd);
    const shouldCheckIntent = ideaParsed !== null || looksLikeCustomSkillModification(cmd, baseSuggestions);
    if (shouldCheckIntent) {
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
        } else if (shouldAutoStartConfigurableSkillImprovement(decision, cmd)) {
          appendTerminal([`[skill-idea] routed to improve ${decision.matched_skill}`]);
          setSkillIdeaInput(`Improve ${decision.matched_skill}: ${cmd}`);
        } else if (decision.decision === 'transient_copilot' && onTransientCopilotQuestion) {
          appendTerminal(['[skill-idea] routed to copilot answer']);
          await onTransientCopilotQuestion(cmd);
        } else {
          const guidance = formatIntentDiscoveryGuidance(decision);
          dispatch({ type: 'SET_COMMAND_COPY', payload: guidance });
          if (decision.user_gate_required) {
            setPendingIntentChoice({ command: cmd, decision });
          }
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
  }, [input, baseSuggestions, state.isCommandRunning, state.activeMatter?.name, onCommand, onTransientCopilotQuestion]);

  return (
    <aside className="command-panel" aria-label="Command box">
      <div className="command-panel-header" style={{ order: 0 }}>
        <div>
          <div className="command-panel-kicker">Matter Assistant</div>
          <h2>What do you need?</h2>
        </div>
        <div className="command-panel-header-actions">
          <button
            type="button"
            className="command-panel-new-task"
            onClick={resetCommandPanel}
            disabled={state.isCommandRunning}
          >
            New task
          </button>
          <label className="copilot-model-switch">
            <span>Copilot</span>
            <select
              aria-label="Copilot strength"
              value={copilotSelectValue}
              onChange={(event) => { void handleCopilotModelChange(event.target.value); }}
              disabled={!canManageCopilotSettings || copilotSwitching}
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
      </div>

      {copilotSwitchStatus && (
        <div className="copilot-model-status" style={{ order: 1 }}>
          {copilotSwitchStatus}
        </div>
      )}

      <p className="command-panel-copy" style={{ order: 2 }}>
        {state.commandCopyText}
      </p>

      {pendingConfigurableOverwrite && (
        <div className="intent-choice-panel configurable-overwrite-panel" style={{ order: 3 }}>
          <div className="intent-choice-title">Existing output found</div>
          <p>
            {pendingConfigurableOverwrite.skillLabel} already has output
            {pendingConfigurableOverwrite.artifactPath
              ? ` at ${humanizeArtifactPath(pendingConfigurableOverwrite.artifactPath)}`
              : ''}.
          </p>
          <div className="intent-choice-actions">
            <button
              type="button"
              onClick={onConfirmConfigurableOverwrite}
              disabled={state.isCommandRunning || !onConfirmConfigurableOverwrite}
            >
              Run again
            </button>
            <button
              type="button"
              onClick={onCancelConfigurableOverwrite}
              disabled={state.isCommandRunning || !onCancelConfigurableOverwrite}
            >
              Keep existing output
            </button>
          </div>
        </div>
      )}

      {pendingIntentChoice && choiceLabels && (
        <div className="intent-choice-panel" style={{ order: 3 }}>
          <div className="intent-choice-title">Choose how to continue</div>
          <div className="intent-choice-actions">
            <button
              type="button"
              onClick={() => { void answerPendingIntentOnce(); }}
              disabled={state.isCommandRunning || (primaryChoiceNeedsCopilot && !onTransientCopilotQuestion)}
            >
              {choiceLabels.primary}
            </button>
            <button
              type="button"
              onClick={() => buildPendingIntentSkill(choiceLabels.secondary)}
              disabled={state.isCommandRunning}
            >
              {choiceLabels.secondary}
            </button>
          </div>
        </div>
      )}

      <div className="command-panel-examples" style={{ order: 4 }} aria-label="Command examples">
        {['new skill', 'find a matter', 'prepare matter'].map((command) => (
          <button
            key={command}
            type="button"
            onClick={() => runExampleCommand(command)}
            disabled={state.isCommandRunning}
          >
            {command}
          </button>
        ))}
      </div>

      {/* Skill idea interview session */}
      {skillIdeaInput !== null && (
        <div className="command-panel-session" style={{ order: 5 }}>
          <SkillIdeaSession
            initialInput={skillIdeaInput}
            onClose={resetCommandPanel}
            onInputOverride={(handler) => { inputOverrideRef.current = handler; }}
          />
        </div>
      )}

      <form className="ai-command-form" style={{ order: 6 }} autoComplete="off" onSubmit={handleSubmit}>
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
            onFocus={() => { void loadCommandSuggestions(); }}
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
                <span className="command-suggestion-command">{s.command}</span>
                <span className="command-suggestion-description">{s.description}</span>
              </button>
            ))}
          </div>
        )}
      </form>

      {activityRows.length > 0 && (
        <div className="command-activity-strip" style={{ order: 7 }}>
          <div className="command-activity-title">Recent activity</div>
          {activityRows.map((entry, i) => (
            <div key={i} className="command-activity-row">
              <time>{entry.time}</time>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="command-panel-actions" style={{ order: 8 }}>
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

      <p className="command-panel-note" style={{ order: 9 }}>
        Source-backed answers are one question at a time and do not remember earlier chat. Skill work may use paid AI.
      </p>

      <div className="beta-feedback-entry" style={{ order: 10 }}>
        {!feedbackOpen ? (
          <button
            type="button"
            className="secondary beta-feedback-open"
            onClick={() => {
              setFeedbackOpen(true);
              setFeedbackMessage('');
            }}
          >
            Have a problem? Tell us what happened
          </button>
        ) : (
          <form className="beta-feedback-form" onSubmit={handleSubmitFeedback}>
            <div className="beta-feedback-header">
              <strong>Tell us what happened</strong>
              <button
                type="button"
                className="skill-idea-close"
                aria-label="Close feedback"
                onClick={() => {
                  setFeedbackOpen(false);
                  setFeedbackMessage('');
                }}
              >
                ×
              </button>
            </div>
            <div className="beta-feedback-choice-grid" role="group" aria-label="What happened">
              <span>Optional: pick the closest type.</span>
              {[
                ['did_not_work', 'Something did not work'],
                ['confused', 'I got confused'],
                ['want_something', 'I want a new feature'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={feedbackChoice === value ? 'active' : ''}
                  onClick={() => setFeedbackChoice(value as PrivateBetaFeedbackChoice)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="beta-feedback-label">
              <span>What happened? One sentence is enough.</span>
              <textarea
                value={feedbackHappenedInstead}
                onChange={(event) => setFeedbackHappenedInstead(event.target.value)}
                rows={3}
              />
            </label>
            <label className="beta-feedback-label">
              <span>What were you trying to do? Optional.</span>
              <textarea
                value={feedbackTryingToDo}
                onChange={(event) => setFeedbackTryingToDo(event.target.value)}
                rows={3}
              />
            </label>
            <div className="beta-feedback-actions">
              <button type="submit" disabled={!canSubmitFeedback}>
                {feedbackSubmitting ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setFeedbackOpen(false);
                  setFeedbackMessage('');
                }}
              >
                Cancel
              </button>
            </div>
            {feedbackMessage && <p className="beta-feedback-message">{feedbackMessage}</p>}
          </form>
        )}
      </div>
    </aside>
  );
}

function viewportLabel() {
  if (typeof window === 'undefined') return '';
  const width = window.innerWidth || 0;
  if (width <= 700) return 'narrow';
  if (width <= 1100) return 'medium';
  return 'desktop';
}

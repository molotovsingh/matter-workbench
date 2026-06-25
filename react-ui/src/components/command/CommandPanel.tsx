import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import CopilotQuickSwitch from './CopilotQuickSwitch';
import PrivateBetaFeedbackPanel from './PrivateBetaFeedbackPanel';
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
import { getErrorMessage } from '../../lib/errors';
import { DEFAULT_COMMAND_COPY_TEXT } from '../../lib/commandPanelCopy';
import { shouldSuggestResearchForAsk } from '../../lib/copilotResearchIntent';
import { humanizeArtifactPath } from '../../lib/presentationLabels';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';
import { useCommandSuggestions, looksLikeCustomSkillModification } from '../../hooks/useCommandSuggestions';
import { useCopilotQuickSwitch } from '../../hooks/useCopilotQuickSwitch';
import type { CopilotThreadTurn } from '../../lib/copilotThread';
import type { SkillRouterDecision } from '../../types';

interface Props {
  onCommand: (command: string) => void;
  onTransientCopilotQuestion?: (question: string) => Promise<void> | void;
  copilotThread?: CopilotThreadTurn[];
  onClearCopilotThread?: () => void;
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

type CommandMode = 'skill' | 'ask' | 'research';

export default function CommandPanel({
  onCommand,
  onTransientCopilotQuestion,
  copilotThread = [],
  onClearCopilotThread,
  reportText,
  onCopyReport,
  pendingConfigurableOverwrite = null,
  onConfirmConfigurableOverwrite,
  onCancelConfigurableOverwrite,
}: Props) {
  const { state, dispatch, appendTerminal, commandPanelRef } = useApp();
  const [input, setInput] = useState('');
  const [skillIdeaInput, setSkillIdeaInput] = useState<string | null>(null);
  const [resumedSkillIdea, setResumedSkillIdea] = useState(state.pendingSkillIdeaResume);
  const [pendingIntentChoice, setPendingIntentChoice] = useState<PendingIntentChoice | null>(null);
  const [pendingResearchChoice, setPendingResearchChoice] = useState<string | null>(null);
  const [commandMode, setCommandMode] = useState<CommandMode>('ask');
  const inputOverrideRef = useRef<((input: string) => boolean) | null>(null);
  const lastActiveMatterNameRef = useRef(state.activeMatter?.name ?? null);
  const activityRows = latestCompactActivityRows(state.activityLines);
  const {
    activeSuggestion,
    baseSuggestions,
    handleInputChange: updateCommandSuggestions,
    handleKeyDown: handleSuggestionKeyDown,
    loadCommandSuggestions,
    pickSuggestion: closeSuggestionPicker,
    resetSuggestions,
    showSuggestions,
    suggestions,
  } = useCommandSuggestions({ appendTerminal });
  const canManageCopilotSettings = canSeeOperatorSurface(state.authEnabled, state.authUser);
  const canUseResearch = Boolean(state.config?.copilotWebResearchEnabled);
  const copilotQuickSwitch = useCopilotQuickSwitch(canManageCopilotSettings);
  const choiceLabels = pendingIntentChoice ? intentChoiceLabels(pendingIntentChoice.decision) : null;
  const primaryChoiceNeedsCopilot = pendingIntentChoice
    ? !isExistingSkillChoice(pendingIntentChoice.decision)
    : false;
  const resetCommandPanel = useCallback(() => {
    inputOverrideRef.current = null;
    setInput('');
    resetSuggestions();
    setCommandMode('ask');
    setSkillIdeaInput(null);
    setResumedSkillIdea(null);
    setPendingIntentChoice(null);
    setPendingResearchChoice(null);
    onClearCopilotThread?.();
    dispatch({ type: 'SET_COMMAND_COPY', payload: DEFAULT_COMMAND_COPY_TEXT });
    void loadCommandSuggestions();
  }, [dispatch, loadCommandSuggestions, onClearCopilotThread, resetSuggestions]);

  useEffect(() => {
    void loadCommandSuggestions();
  }, [loadCommandSuggestions, state.skillsDataRefreshSeq]);

  useEffect(() => {
    const idea = state.pendingSkillIdeaResume;
    if (!idea) return;
    inputOverrideRef.current = null;
    setInput('');
    resetSuggestions();
    setPendingIntentChoice(null);
    setPendingResearchChoice(null);
    setResumedSkillIdea(idea);
    setSkillIdeaInput(idea.text || 'new skill');
    dispatch({ type: 'SET_PENDING_SKILL_IDEA_RESUME', payload: null });
  }, [dispatch, resetSuggestions, state.pendingSkillIdeaResume]);

  useEffect(() => {
    const activeMatterName = state.activeMatter?.name ?? null;
    if (lastActiveMatterNameRef.current === activeMatterName) return;
    lastActiveMatterNameRef.current = activeMatterName;
    resetCommandPanel();
  }, [resetCommandPanel, state.activeMatter?.name]);

  useEffect(() => {
    if (!canUseResearch && commandMode === 'research') setCommandMode('ask');
  }, [canUseResearch, commandMode]);

  function growTextarea() {
    const el = commandPanelRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  useEffect(() => {
    growTextarea();
  }, [input]);

  function handleInputChange(value: string) {
    setInput(value);
    updateCommandSuggestions(value);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    handleSuggestionKeyDown(e, pickSuggestion);
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (!showSuggestions || activeSuggestion < 0) {
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }
    }
  }

  function pickSuggestion(command: string) {
    setInput(command);
    closeSuggestionPicker();
    setPendingIntentChoice(null);
    setPendingResearchChoice(null);
  }

  function runExampleCommand(command: string) {
    if (state.isCommandRunning) return;
    setInput('');
    resetSuggestions();
    setPendingIntentChoice(null);
    setPendingResearchChoice(null);
    if (command === 'new skill') {
      setResumedSkillIdea(null);
      setSkillIdeaInput(command);
      return;
    }
    setSkillIdeaInput(null);
    onCommand(command);
    void api.logCommandInteraction({ command, matterName: state.activeMatter?.name });
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
    setResumedSkillIdea(null);
    setSkillIdeaInput(improveExisting ? `Improve ${matchedSkill}: ${command}` : command);
  }

  async function answerPendingResearchFromRecord() {
    if (!pendingResearchChoice || state.isCommandRunning) return;
    const command = `/ask ${pendingResearchChoice}`;
    setCommandMode('ask');
    setPendingResearchChoice(null);
    appendTerminal(['[assistant] user chose matter-record answer']);
    onCommand(command);
    await api.logCommandInteraction({ command, matterName: state.activeMatter?.name });
  }

  async function answerPendingResearchWithPublicSources() {
    if (!pendingResearchChoice || state.isCommandRunning) return;
    const command = `/research ${pendingResearchChoice}`;
    setCommandMode('research');
    setPendingResearchChoice(null);
    appendTerminal(['[research] user chose public sources']);
    onCommand(command);
    await api.logCommandInteraction({ command, matterName: state.activeMatter?.name });
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd || state.isCommandRunning) return;
    setInput('');
    resetSuggestions();
    setPendingIntentChoice(null);
    setPendingResearchChoice(null);

    if (inputOverrideRef.current?.(cmd)) {
      return;
    }

    if (commandMode === 'ask' && canUseResearch && shouldSuggestResearchForAsk(cmd)) {
      setPendingResearchChoice(cmd);
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'This may need public legal research. Choose whether to answer from the matter record or search public sources.' });
      appendTerminal(['[assistant] research may help; waiting for user choice']);
      return;
    }

    const routedCommand = commandForMode(commandMode, cmd);
    if (commandMode !== 'skill' || routedCommand !== cmd) {
      onCommand(routedCommand);
      try {
        await api.logCommandInteraction({ command: routedCommand, matterName: state.activeMatter?.name });
      } catch { /* fire-and-forget */ }
      return;
    }

    const ideaParsed = parseSkillIdeaText(cmd);
    const shouldCheckIntent = ideaParsed !== null || looksLikeCustomSkillModification(cmd, baseSuggestions);
    if (shouldCheckIntent) {
      if (ideaParsed === '') {
        setResumedSkillIdea(null);
        setSkillIdeaInput(cmd);
        return;
      }
      const matterName = state.activeMatter?.name ?? null;
      dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
      appendTerminal([`[skill-idea] checking whether this is one-time or reusable…`]);
      try {
        const decision = await api.checkIntent({ userRequest: cmd, matterName: matterName ?? undefined });
        if (shouldStartSkillIdeaSessionFromIntent(decision)) {
          setResumedSkillIdea(null);
          setSkillIdeaInput(cmd);
        } else if (shouldAutoStartConfigurableSkillImprovement(decision, cmd)) {
          appendTerminal([`[skill-idea] routed to improve ${decision.matched_skill}`]);
          setResumedSkillIdea(null);
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
        setResumedSkillIdea(null);
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
  }, [input, commandMode, canUseResearch, appendTerminal, baseSuggestions, resetSuggestions, state.isCommandRunning, state.activeMatter?.name, dispatch, onCommand, onTransientCopilotQuestion]);

  return (
    <aside className="command-panel" aria-label="Command box">
      <div className="command-panel-header" style={{ order: 0 }}>
        <div className="command-panel-heading">
          <div className="command-panel-title">Matter Assistant</div>
          <p className="command-panel-subtitle">Ask, Research, or Skill.</p>
        </div>
        <div className="command-panel-header-actions">
          <button
            type="button"
            className="command-panel-new-task"
            onClick={resetCommandPanel}
            disabled={state.isCommandRunning}
          >
            New
          </button>
          {canManageCopilotSettings && <CopilotQuickSwitch switcher={copilotQuickSwitch} />}
        </div>
      </div>

      {canManageCopilotSettings && copilotQuickSwitch.status && (
        <div className="copilot-model-status" style={{ order: 1 }}>
          {copilotQuickSwitch.status}
        </div>
      )}

      <p className="command-panel-copy" style={{ order: 2 }}>
        {state.commandCopyText}
      </p>

      {copilotThread.length > 0 && (
        <div className="copilot-thread" style={{ order: 3 }} aria-label="Copilot conversation">
          {copilotThread.slice(-6).map((turn, index) => (
            <div key={`${turn.role}-${turn.mode}-${index}`} className={`copilot-thread-turn ${turn.role}`}>
              <div className="copilot-thread-meta">
                {turn.role === 'user' ? 'You' : turn.mode === 'research' ? 'Research' : 'Assistant'}
              </div>
              <div className="copilot-thread-text">{turn.text}</div>
            </div>
          ))}
        </div>
      )}

      {pendingResearchChoice && (
        <div className="intent-choice-panel research-choice-panel" style={{ order: 3 }}>
          <div className="intent-choice-title">This may need public legal research</div>
          <p>
            Answer from the current matter record, or search public legal sources.
          </p>
          <div className="intent-choice-actions">
            <button
              type="button"
              onClick={() => { void answerPendingResearchFromRecord(); }}
              disabled={state.isCommandRunning}
            >
              Answer from matter record
            </button>
            <button
              type="button"
              onClick={() => { void answerPendingResearchWithPublicSources(); }}
              disabled={state.isCommandRunning || !canUseResearch}
            >
              Research public sources
            </button>
          </div>
        </div>
      )}

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

      {copilotThread.length === 0 && skillIdeaInput === null && (
        <div className="command-panel-spacer" style={{ order: 4 }} aria-hidden="true" />
      )}

      {/* Skill idea interview session */}
      {skillIdeaInput !== null && (
        <div className="command-panel-session" style={{ order: 5 }}>
          <SkillIdeaSession
            initialInput={skillIdeaInput}
            initialIdea={resumedSkillIdea}
            onClose={resetCommandPanel}
            onInputOverride={(handler) => { inputOverrideRef.current = handler; }}
          />
        </div>
      )}

      <div className="command-composer" style={{ order: 6 }}>
        <div className="command-mode-tabs" aria-label="Command mode">
          {(['skill', 'ask', 'research'] as CommandMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={commandMode === mode ? 'active' : ''}
              onClick={() => setCommandMode(mode)}
              disabled={state.isCommandRunning || (mode === 'research' && !canUseResearch)}
              aria-pressed={commandMode === mode}
            >
              {mode === 'skill' ? 'Skill' : mode === 'ask' ? 'Ask' : 'Research'}
            </button>
          ))}
        </div>

        <div className="command-panel-examples" aria-label="Command examples">
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

        <form className="ai-command-form" autoComplete="off" onSubmit={handleSubmit}>
          <label className="command-panel-label" htmlFor="aiCommandInput">Ask or run</label>
          <div className="command-panel-input-row">
            <textarea
              id="aiCommandInput"
              ref={commandPanelRef as React.RefObject<HTMLTextAreaElement>}
              rows={1}
              placeholder={commandPlaceholder(commandMode, state.activeMatter?.name, canUseResearch)}
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
          <details className="command-activity-strip">
            <summary className="command-activity-title">Recent activity</summary>
            {activityRows.map((entry, i) => (
              <div key={i} className="command-activity-row">
                <time>{entry.time}</time>
                <span>{entry.message}</span>
              </div>
            ))}
          </details>
        )}

        <div className="command-panel-actions">
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
      </div>

      <PrivateBetaFeedbackPanel
        order={10}
        providerRoutes={canManageCopilotSettings
          ? [{ task: 'copilot_answer', provider: copilotQuickSwitch.provider, model: copilotQuickSwitch.model }]
          : []}
      />
    </aside>
  );
}

function commandForMode(mode: CommandMode, command: string): string {
  if (/^(?:\/ask|ask|\/research|research)\b/i.test(command)) return command;
  if (mode === 'ask') return `/ask ${command}`;
  if (mode === 'research') return `/research ${command}`;
  return command;
}

function commandPlaceholder(mode: CommandMode, matterName?: string, canUseResearch = false): string {
  if (!matterName) return 'Ask a question or pick a matter first';
  if (mode === 'skill') return 'Run a skill or describe a reusable workflow…';
  if (mode === 'research' && canUseResearch) return `Research public sources for ${matterName}…`;
  return `Ask about ${matterName}…`;
}

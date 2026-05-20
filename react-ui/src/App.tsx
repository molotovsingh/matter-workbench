import { useState, useEffect, useCallback, useRef } from 'react';
import { AppProvider, useApp } from './store/AppContext';
import ActivityBar from './components/layout/ActivityBar';
import Sidebar from './components/layout/Sidebar';
import MainContent from './components/layout/MainContent';
import CommandPanel from './components/command/CommandPanel';
import { api } from './api/client';
import { writeClipboardText } from './lib/clipboard';
import { getErrorMessage } from './lib/errors';
import { formatMatterCopilotAnswer, parseAskCommand } from './lib/matterCopilotAnswer';
import { cleanCommandLabel, resolveNativeCommand } from './lib/nativeCommands';
import { parseSkillIdeaText } from './lib/skillIdeaInput';
import { localAssistantReply } from './lib/assistantSmallTalk';
import { createInitialPreparationRun, runAutomaticPreparation } from './lib/autoPreparationRunner';
import { useLatestValue } from './hooks/useLatestValue';
import type { ActiveView } from './types';

function AppShell() {
  const { state, dispatch, setTheme, appendTerminal, refreshActiveMatterWorkspace, clearActiveMatter } = useApp();
  const [reportText, setReportText] = useState<string | null>(null);
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);
  const preparationRunSeqRef = useRef(0);
  const setActiveView = useCallback((view: ActiveView) => {
    dispatch({ type: 'SET_VIEW', payload: view });
  }, [dispatch]);

  const runPreparationForMatter = useCallback(async (
    matterName: string,
    {
      reason = '[prepare] automatic preparation started',
      mode = 'needed',
      initialMessage = 'Preparing matter…',
    }: {
      reason?: string;
      mode?: 'needed' | 'full';
      initialMessage?: string;
    } = {},
  ) => {
    const cleanMatterName = matterName.trim();
    if (!cleanMatterName) return;
    const runSeq = preparationRunSeqRef.current + 1;
    preparationRunSeqRef.current = runSeq;
    let latestRun = createInitialPreparationRun(cleanMatterName, initialMessage);
    dispatch({ type: 'SET_PREPARATION_RUN', payload: latestRun });
    dispatch({ type: 'SET_STATUS_BAR', payload: initialMessage });
    appendTerminal([reason]);

    let sawTargetMatter = activeMatterNameRef.current === cleanMatterName;
    const isStale = () => {
      if (preparationRunSeqRef.current !== runSeq) return true;
      const activeName = activeMatterNameRef.current;
      if (activeName === cleanMatterName) {
        sawTargetMatter = true;
        return false;
      }
      return sawTargetMatter || Boolean(activeName);
    };
    try {
      const result = await runAutomaticPreparation({
        matterName: cleanMatterName,
        appendTerminal,
        isStale,
        mode,
        initialMessage,
        onProgress: (status) => {
          latestRun = status;
          if (!isStale()) dispatch({ type: 'SET_PREPARATION_RUN', payload: status });
        },
      });
      if (isStale()) return;
      const refreshed = await refreshActiveMatterWorkspace({
        expectedMatterName: cleanMatterName,
        failurePrefix: '[workspace] refresh failed after automatic preparation',
      });
      if (isStale()) return;
      const finalState = refreshed ? result.state : 'needs_review';
      const finalMessage = refreshed
        ? result.message
        : `${result.message} Refresh the matter view to see the latest files.`;
      const completed = {
        ...latestRun,
        state: finalState,
        message: finalMessage,
        finishedAt: new Date().toISOString(),
      };
      dispatch({ type: 'SET_PREPARATION_RUN', payload: completed });
      dispatch({ type: 'SET_STATUS_BAR', payload: finalState === 'prepared' ? 'Matter prepared' : 'Matter needs review' });
      dispatch({ type: 'SET_COMMAND_COPY', payload: finalMessage });
    } catch (error) {
      if (isStale()) return;
      const message = getErrorMessage(error);
      dispatch({
        type: 'SET_PREPARATION_RUN',
        payload: {
          ...latestRun,
          state: 'blocked',
          message: 'Automatic preparation stopped.',
          error: message,
          finishedAt: new Date().toISOString(),
        },
      });
      dispatch({ type: 'SET_STATUS_BAR', payload: 'Matter preparation blocked' });
      dispatch({ type: 'SET_COMMAND_COPY', payload: `Matter preparation stopped: ${message}` });
      appendTerminal([`[prepare] preparation failed: ${message}`]);
    }
  }, [activeMatterNameRef, appendTerminal, dispatch, refreshActiveMatterWorkspace]);

  const startAutoPreparation = useCallback((matterName: string, reason = '[prepare] automatic preparation started') => {
    void runPreparationForMatter(matterName, { reason, mode: 'needed' });
  }, [runPreparationForMatter]);

  const handleRunPreparationAgain = useCallback((matterName: string) => {
    const cleanMatterName = matterName.trim();
    if (!cleanMatterName) return;
    if (state.preparationRun?.matterName === cleanMatterName && state.preparationRun.state === 'running') return;
    void runPreparationForMatter(cleanMatterName, {
      reason: `[prepare] rerunning full preparation for "${cleanMatterName}"`,
      mode: 'full',
      initialMessage: 'Running preparation again…',
    });
  }, [runPreparationForMatter, state.preparationRun]);

  const answerMatterQuestion = useCallback(async (
    question: string,
    {
      matterName = state.activeMatter?.name ?? null,
      manageRunning = true,
    }: { matterName?: string | null; manageRunning?: boolean } = {},
  ) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;
    if (!matterName) {
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Pick a matter before asking a matter question.' });
      appendTerminal(['[copilot] no active matter']);
      return;
    }
    if (manageRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    dispatch({ type: 'SET_COMMAND_COPY', payload: 'Reading the current matter record…' });
    appendTerminal(['[copilot] answering from current matter record']);
    try {
      const answer = await api.answerMatterQuestion({ question: cleanQuestion, matterName });
      if (activeMatterNameRef.current !== matterName) return;
      dispatch({ type: 'SET_COMMAND_COPY', payload: formatMatterCopilotAnswer(answer) });
      appendTerminal([
        `[copilot] ${answer.answer_status} — ${(answer.sources || []).length} validated source(s)`,
        answer.ai_run?.provider && answer.ai_run?.model
          ? `[copilot] ${answer.ai_run.provider} / ${answer.ai_run.model}`
          : '[copilot] provider metadata unavailable',
      ]);
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      const message = getErrorMessage(e);
      appendTerminal([`[copilot] failed: ${message}`]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: `I could not answer from the current matter record: ${message}` });
    } finally {
      if (manageRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [state.activeMatter?.name, activeMatterNameRef, dispatch, appendTerminal]);

  const openMatterFinder = useCallback(async () => {
    if (state.activeMatter) {
      try {
        await api.clearActiveMatter();
      } catch (e) {
        appendTerminal([`[workspace] could not clear active matter on server: ${getErrorMessage(e)}`]);
      }
      clearActiveMatter();
    }
    dispatch({ type: 'SET_TAB', payload: 'home' });
    dispatch({ type: 'SET_BREADCRUMBS', payload: 'Home' });
    setActiveView('find-matter');
  }, [appendTerminal, clearActiveMatter, dispatch, setActiveView, state.activeMatter]);

  useEffect(() => {
    setTheme(state.theme);
  }, [setTheme, state.theme]);

  // Bootstrap: load config and matter list once on app start.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const [config, mattersResult] = await Promise.all([
          api.getConfig(),
          api.getMatters(),
        ]);
        if (cancelled) return;
        dispatch({ type: 'SET_CONFIG', payload: { config } });
        dispatch({ type: 'SET_MATTERS', payload: mattersResult.matters ?? [] });
        if (config.activeMatterName) {
          dispatch({ type: 'SET_RESUME_MATTER', payload: config.activeMatterName });
          appendTerminal([`[boot] last matter: ${config.activeMatterName}`]);
        }
        appendTerminal([`[boot] ${mattersResult.matters?.length ?? 0} matter(s) loaded`]);
      } catch (e) {
        if (cancelled) return;
        appendTerminal([`[boot] server not reachable — ${getErrorMessage(e)}`]);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [appendTerminal, dispatch]);

  const handleCommand = useCallback(async (cmd: string) => {
    const lower = cmd.toLowerCase().trim();
    const localReply = localAssistantReply(cmd, Boolean(state.activeMatter));
    if (localReply) {
      dispatch({ type: 'SET_COMMAND_COPY', payload: localReply });
      appendTerminal(['[assistant] local reply']);
      return;
    }

    const askQuestion = parseAskCommand(cmd);
    if (askQuestion) {
      await answerMatterQuestion(askQuestion);
      return;
    }

    // Native skills open their workflow views directly; each view owns its
    // own API calls, rerun guards, and overwrite confirmation.
    const nativeResolution = resolveNativeCommand(lower);

    if (nativeResolution) {
      const commandLabel = cleanCommandLabel(nativeResolution.command);
      const terminalLine = nativeResolution.command === lower
        ? `[cmd] ${commandLabel}`
        : `[cmd] ${lower} → ${commandLabel}`;
      appendTerminal([terminalLine]);
      setActiveView(nativeResolution.view);
      dispatch({ type: 'SET_BREADCRUMBS', payload: commandLabel });
      return;
    }

    if (parseSkillIdeaText(cmd) !== null) {
      dispatch({ type: 'SET_TAB', payload: 'skills' });
      dispatch({ type: 'SET_BREADCRUMBS', payload: 'Skills' });
      return;
    }

    if (lower.includes('find a matter') || lower.includes('search matter')) {
      await openMatterFinder();
      return;
    }

    // Fall back to intent check
    const matterName = state.activeMatter?.name ?? null;
    dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    appendTerminal([`[cmd] "${cmd}"`]);
    try {
      const result = await api.checkIntent({ userRequest: cmd, matterName: matterName ?? undefined });
      if (activeMatterNameRef.current !== matterName) return;
      if (result.decision === 'run_existing_skill' && result.matched_skill) {
        const matchedResolution = resolveNativeCommand(result.matched_skill);
        if (matchedResolution) {
          setActiveView(matchedResolution.view);
          dispatch({ type: 'SET_BREADCRUMBS', payload: cleanCommandLabel(matchedResolution.command) });
        } else {
          dispatch({ type: 'SET_COMMAND_COPY', payload: result.suggested_next_action || `Run ${result.matched_skill}` });
        }
      } else if (result.decision === 'transient_copilot') {
        appendTerminal(['[cmd] routed to copilot answer']);
        await answerMatterQuestion(cmd, { matterName, manageRunning: false });
      } else if (result.suggested_next_action) {
        dispatch({ type: 'SET_COMMAND_COPY', payload: result.suggested_next_action });
      }
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      const message = getErrorMessage(e);
      appendTerminal([`[cmd] check failed for "${cmd}": ${message}`]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Could not check that command. Try again, or use a listed action.' });
    } finally {
      dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [state.activeMatter?.name, activeMatterNameRef, dispatch, appendTerminal, setActiveView, answerMatterQuestion, openMatterFinder]);

  function handleSlashSkill(command: string) {
    handleCommand(command);
  }

  function handleMatterCreated(name: string, opts: { autoPrepare?: boolean } = {}) {
    activeMatterNameRef.current = name;
    dispatch({ type: 'SET_RESUME_MATTER', payload: name });
    setActiveView('home');
    api.getMatters()
      .then((r) => dispatch({ type: 'SET_MATTERS', payload: r.matters ?? [] }))
      .catch((e) => {
        const message = getErrorMessage(e);
        appendTerminal([`[matter] list refresh failed after creating "${name}": ${message}`]);
        dispatch({ type: 'SET_COMMAND_COPY', payload: 'Matter was created, but the matter list could not refresh. Use Refresh or reload if it is missing.' });
      });
    if (opts.autoPrepare) {
      void startAutoPreparation(name, `[prepare] automatic preparation queued after first upload for "${name}"`);
    }
  }

  async function handleAddFilesDone(opts: { autoPrepare?: boolean } = {}) {
    const matterName = state.activeMatter?.name ?? activeMatterNameRef.current;
    setActiveView('home');
    await refreshActiveMatterWorkspace({ reason: '[add-files] files added — refreshing workspace' });
    if (opts.autoPrepare && matterName) {
      void startAutoPreparation(matterName, `[prepare] automatic preparation queued after added files for "${matterName}"`);
    }
  }

  function handleOpenMatter(name: string) {
    setActiveView('home');
    dispatch({ type: 'SET_BREADCRUMBS', payload: name });
  }

  async function handleCopyReport() {
    if (!reportText) return;
    try {
      await writeClipboardText(reportText);
      appendTerminal(['[report] copied']);
      setReportText(null);
    } catch (e) {
      const message = getErrorMessage(e);
      appendTerminal([`[report] copy failed: ${message}`]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: `Could not copy report: ${message}` });
    }
  }

  const isHomeModeClass = !state.activeMatter ? 'home-mode' : '';

  return (
    <div className={`app-shell ${isHomeModeClass}`}>
      <ActivityBar />
      <Sidebar
        onNewMatter={() => setActiveView('new-matter')}
        onAddFiles={() => setActiveView('add-files')}
        onSlashSkill={handleSlashSkill}
      />
      <MainContent
        onNewMatter={() => setActiveView('new-matter')}
        onMatterCreated={handleMatterCreated}
        onViewAllMatters={() => { void openMatterFinder(); }}
        onOpenMatter={handleOpenMatter}
        onAddFilesDone={handleAddFilesDone}
        onCommand={handleCommand}
        onRunPreparationAgain={handleRunPreparationAgain}
        commandPanel={
          <CommandPanel
            onCommand={handleCommand}
            onTransientCopilotQuestion={(question) => answerMatterQuestion(question, { manageRunning: false })}
            reportText={reportText}
            onCopyReport={handleCopyReport}
          />
        }
      />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

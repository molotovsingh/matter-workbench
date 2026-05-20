import { useState, useEffect, useCallback } from 'react';
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
import { useLatestValue } from './hooks/useLatestValue';
import type { ActiveView } from './types';

function AppShell() {
  const { state, dispatch, setTheme, appendTerminal, refreshActiveMatterWorkspace } = useApp();
  const [reportText, setReportText] = useState<string | null>(null);
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);
  const setActiveView = useCallback((view: ActiveView) => {
    dispatch({ type: 'SET_VIEW', payload: view });
  }, [dispatch]);

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
    dispatch({ type: 'SET_COMMAND_COPY', payload: 'Reading the bounded matter context…' });
    appendTerminal(['[copilot] answering from bounded matter context']);
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
      dispatch({ type: 'SET_COMMAND_COPY', payload: `I could not answer from the matter context: ${message}` });
    } finally {
      if (manageRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [state.activeMatter?.name, activeMatterNameRef, dispatch, appendTerminal]);

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
      dispatch({ type: 'SET_TAB', payload: 'home' });
      dispatch({ type: 'SET_BREADCRUMBS', payload: 'Home' });
      setActiveView('home');
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
  }, [state.activeMatter?.name, activeMatterNameRef, dispatch, appendTerminal, setActiveView, answerMatterQuestion]);

  function handleSlashSkill(command: string) {
    handleCommand(command);
  }

  function handleMatterCreated(name: string) {
    dispatch({ type: 'SET_RESUME_MATTER', payload: name });
    setActiveView('home');
    api.getMatters()
      .then((r) => dispatch({ type: 'SET_MATTERS', payload: r.matters ?? [] }))
      .catch((e) => {
        const message = getErrorMessage(e);
        appendTerminal([`[matter] list refresh failed after creating "${name}": ${message}`]);
        dispatch({ type: 'SET_COMMAND_COPY', payload: 'Matter was created, but the matter list could not refresh. Use Refresh or reload if it is missing.' });
      });
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
        onViewAllMatters={() => { setActiveView('home'); dispatch({ type: 'SET_TAB', payload: 'home' }); }}
        onOpenMatter={handleOpenMatter}
        onAddFilesDone={() => {
          setActiveView('home');
          void refreshActiveMatterWorkspace({ reason: '[add-files] files added — refreshing workspace' });
        }}
        onCommand={handleCommand}
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

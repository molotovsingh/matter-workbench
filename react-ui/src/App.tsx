import { useState, useEffect, useCallback } from 'react';
import { AppProvider, useApp } from './store/AppContext';
import ActivityBar from './components/layout/ActivityBar';
import Sidebar from './components/layout/Sidebar';
import MainContent from './components/layout/MainContent';
import CommandPanel from './components/command/CommandPanel';
import { api } from './api/client';
import { writeClipboardText } from './lib/clipboard';
import { getErrorMessage } from './lib/errors';
import { resolveNativeCommand } from './lib/nativeCommands';
import { activeMatterFromWorkspace } from './lib/activeMatter';
import type { ActiveView } from './types';

function AppShell() {
  const { state, dispatch, setTheme, appendTerminal, setActiveMatter } = useApp();
  const [reportText, setReportText] = useState<string | null>(null);
  const setActiveView = useCallback((view: ActiveView) => {
    dispatch({ type: 'SET_VIEW', payload: view });
  }, [dispatch]);

  // Bootstrap: load theme, config, matters
  useEffect(() => {
    setTheme(state.theme);

    async function bootstrap() {
      try {
        const [config, mattersResult] = await Promise.all([
          api.getConfig(),
          api.getMatters(),
        ]);
        dispatch({ type: 'SET_CONFIG', payload: { config } });
        dispatch({ type: 'SET_MATTERS', payload: mattersResult.matters ?? [] });
        if (config.activeMatterName) {
          dispatch({ type: 'SET_RESUME_MATTER', payload: config.activeMatterName });
          appendTerminal([`[boot] last matter: ${config.activeMatterName}`]);
        }
        appendTerminal([`[boot] ${mattersResult.matters?.length ?? 0} matter(s) loaded`]);
      } catch (e) {
        appendTerminal([`[boot] server not reachable — ${getErrorMessage(e)}`]);
      }
    }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCommand = useCallback(async (cmd: string) => {
    const lower = cmd.toLowerCase().trim();

    // Native skills open their workflow views directly; each view owns its
    // own API calls, rerun guards, and overwrite confirmation.
    const nativeResolution = resolveNativeCommand(lower);

    if (nativeResolution) {
      const terminalLine = nativeResolution.command === lower
        ? `[cmd] ${lower}`
        : `[cmd] ${lower} → ${nativeResolution.command}`;
      appendTerminal([terminalLine]);
      setActiveView(nativeResolution.view);
      dispatch({ type: 'SET_BREADCRUMBS', payload: nativeResolution.command });
      return;
    }

    if (lower === 'new skill' || lower.includes('create a skill') || lower.includes('new skill')) {
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
    dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    appendTerminal([`[cmd] "${cmd}"`]);
    try {
      const result = await api.checkIntent({ userRequest: cmd, matterName: state.activeMatter?.name });
      if (result.decision === 'run_existing_skill' && result.matched_skill) {
        const matchedResolution = resolveNativeCommand(result.matched_skill);
        if (matchedResolution) {
          setActiveView(matchedResolution.view);
          dispatch({ type: 'SET_BREADCRUMBS', payload: matchedResolution.command });
        } else {
          dispatch({ type: 'SET_COMMAND_COPY', payload: result.suggested_next_action || `Run ${result.matched_skill}` });
        }
      } else if (result.suggested_next_action) {
        dispatch({ type: 'SET_COMMAND_COPY', payload: result.suggested_next_action });
      }
    } catch (e) {
      const message = getErrorMessage(e);
      appendTerminal([`[cmd] check failed for "${cmd}": ${message}`]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Could not check that command. Try again, or use a listed action.' });
    } finally {
      dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [state.activeMatter?.name, dispatch, appendTerminal, setActiveView]);

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

  async function refreshActiveMatterWorkspace(reason: string) {
    if (!state.activeMatter) return;
    appendTerminal([reason]);
    try {
      const workspace = await api.getWorkspace();
      setActiveMatter(activeMatterFromWorkspace(workspace, state.activeMatter.name));
      appendTerminal([`[workspace] refreshed — ${workspace.fileCount} files, ${workspace.directoryCount} folders`]);
    } catch (e) {
      appendTerminal([`[workspace] refresh failed: ${getErrorMessage(e)}`]);
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
          void refreshActiveMatterWorkspace('[add-files] files added — refreshing workspace');
        }}
        onCommand={handleCommand}
        commandPanel={
          <CommandPanel
            onCommand={handleCommand}
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

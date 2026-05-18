import { useState, useEffect, useCallback } from 'react';
import { AppProvider, useApp } from './store/AppContext';
import ActivityBar from './components/layout/ActivityBar';
import Sidebar from './components/layout/Sidebar';
import MainContent from './components/layout/MainContent';
import CommandPanel from './components/command/CommandPanel';
import { api } from './api/client';
import { writeClipboardText } from './lib/clipboard';

function AppShell() {
  const { state, dispatch, setTheme, appendTerminal } = useApp();
  const [reportText, setReportText] = useState<string | null>(null);
  const setActiveView = useCallback((view: string) => {
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
        appendTerminal([`[boot] server not reachable — ${(e as Error).message}`]);
      }
    }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCommand = useCallback(async (cmd: string) => {
    const lower = cmd.toLowerCase().trim();

    // Native skills open their workflow views directly — each view handles
    // its own API calls, rerun guards, and overwrite confirmation.
    const viewMap: Record<string, string> = {
      '/doctor': 'doctor',
      '/context_search': 'context-search',
      '/context_preview': 'context-preview',
      '/prepare_matter': 'prepare-matter',
      '/extract': 'extract',
      '/matter-init': 'matter-init',
      '/describe_sources': 'describe-sources',
      '/create_listofdates': 'list-of-dates',
    };

    if (viewMap[lower]) {
      appendTerminal([`[cmd] ${lower}`]);
      setActiveView(viewMap[lower]);
      dispatch({ type: 'SET_BREADCRUMBS', payload: lower });
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
        const view = viewMap[result.matched_skill] ?? result.matched_skill;
        setActiveView(view);
        dispatch({ type: 'SET_BREADCRUMBS', payload: result.matched_skill });
      } else if (result.suggested_next_action) {
        dispatch({ type: 'SET_COMMAND_COPY', payload: result.suggested_next_action });
      }
    } catch {
      appendTerminal([`[cmd] no match for "${cmd}"`]);
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
    api.getMatters().then((r) => dispatch({ type: 'SET_MATTERS', payload: r.matters ?? [] })).catch(() => null);
  }

  function handleOpenMatter(name: string) {
    setActiveView('home');
    dispatch({ type: 'SET_BREADCRUMBS', payload: name });
  }

  function handleCopyReport() {
    if (reportText) writeClipboardText(reportText).catch(() => null);
    setReportText(null);
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
        onAddFilesDone={() => { setActiveView('home'); appendTerminal(['[add-files] files added — refreshing workspace']); }}
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

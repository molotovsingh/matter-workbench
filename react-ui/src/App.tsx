import { useState, useEffect, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';
import { AppProvider, useApp } from './store/AppContext';
import Sidebar from './components/layout/Sidebar';
import MainContent from './components/layout/MainContent';
import CommandPanel from './components/command/CommandPanel';
import PrivateBetaReadinessGate from './components/auth/PrivateBetaReadinessGate';
import { api, setAuthRequiredHandler } from './api/client';
import { writeClipboardText } from './lib/clipboard';
import { getErrorMessage, getUserFacingErrorMessage } from './lib/errors';
import {
  appendCopilotThreadTurn as appendThreadTurn,
  boundedConversationForRequest,
  type CopilotThreadTurn,
} from './lib/copilotThread';
import {
  formatMatterCopilotAnswer,
  formatMatterCopilotError,
  formatMatterCopilotResearchAnswer,
  formatMatterCopilotResearchError,
  formatMatterCopilotTerminalError,
  parseAskCommand,
  parseResearchCommand,
} from './lib/matterCopilotAnswer';
import { cleanCommandLabel, resolveNativeCommand } from './lib/nativeCommands';
import { parseSkillIdeaText } from './lib/skillIdeaInput';
import { reportResearchAnswer, reportResearchFailure } from './lib/copilotResearchTelemetry';
import { formatIntentDiscoveryGuidance } from './lib/skillIntentRouting';
import { localAssistantReply } from './lib/assistantSmallTalk';
import { createInitialPreparationRun, runAutomaticPreparation } from './lib/autoPreparationRunner';
import { useLatestValue } from './hooks/useLatestValue';
import { filePreviewTitle, loadTextFilePreview } from './lib/filePreview';
import { humanizeArtifactPath } from './lib/presentationLabels';
import { canSeeOperatorSurface } from './lib/lawyerMode';
import { useUserReadinessGate } from './hooks/useUserReadinessGate';
import type { ActiveView, AppConfig, AuthUser } from './types';

interface PendingConfigurableOverwrite {
  slash: string;
  skillLabel: string;
  matterName: string;
  artifactPath?: string | null;
}

interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  user: AuthUser | null;
}

function AppShell() {
  const { state, dispatch, setTheme, appendTerminal, refreshActiveMatterWorkspace, clearActiveMatter } = useApp();
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState('');
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);
  const [copilotThread, setCopilotThread] = useState<CopilotThreadTurn[]>([]);
  const [pendingConfigurableOverwrite, setPendingConfigurableOverwrite] = useState<PendingConfigurableOverwrite | null>(null);
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);
  const selectedMatterNameRef = useLatestValue(state.activeMatter?.name ?? state.resumeMatterName ?? null);
  const preparationRunSeqRef = useRef(0);
  const { readinessGate, resetReadinessGate } = useUserReadinessGate({
    authenticated: Boolean(authStatus?.authenticated),
    appendTerminal,
  });
  const setActiveView = useCallback((view: ActiveView) => {
    dispatch({ type: 'SET_VIEW', payload: view });
  }, [dispatch]);
  const handleAuthRequired = useCallback(() => {
    setAuthError('Please sign in again.');
    setShowWhatsNew(false);
    setAuthStatus({ enabled: true, authenticated: false, user: null });
    resetReadinessGate();
    dispatch({ type: 'SET_CONFIG', payload: { authUser: null, authEnabled: true } });
  }, [dispatch, resetReadinessGate]);
  const canSeeOperatorDetails = canSeeOperatorSurface(state.authEnabled, state.authUser);
  const appendCopilotThreadTurn = useCallback((turn: CopilotThreadTurn) => {
    setCopilotThread((current) => appendThreadTurn(current, turn));
  }, []);

  useEffect(() => {
    setCopilotThread([]);
  }, [state.activeMatter?.name]);

  useEffect(() => {
    setAuthRequiredHandler(handleAuthRequired);
    return () => {
      setAuthRequiredHandler(null);
    };
  }, [handleAuthRequired]);

  const runPreparationForMatter = useCallback(async (
    matterName: string,
    {
      reason = '[prepare] automatic preparation started',
      mode = 'needed',
      startStage = '',
      initialMessage = 'Preparing matter…',
    }: {
      reason?: string;
      mode?: 'needed' | 'full';
      startStage?: string;
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
        startStage,
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

  const handleRunNeededPreparation = useCallback((matterName: string, startStage = '') => {
    const cleanMatterName = matterName.trim();
    if (!cleanMatterName) return;
    if (state.preparationRun?.matterName === cleanMatterName && state.preparationRun.state === 'running') return;
    const fromLabel = preparationStartStageLabel(startStage);
    void runPreparationForMatter(cleanMatterName, {
      reason: startStage
        ? `[prepare] running needed preparation for "${cleanMatterName}" from ${fromLabel}`
        : `[prepare] running needed preparation for "${cleanMatterName}"`,
      mode: 'needed',
      startStage,
      initialMessage: startStage ? `Running preparation from ${fromLabel}…` : 'Running needed preparation…',
    });
  }, [runPreparationForMatter, state.preparationRun]);

  const handleForceFullPreparation = useCallback((matterName: string, reason: string) => {
    const cleanMatterName = matterName.trim();
    const cleanReason = reason.trim();
    if (!cleanMatterName || !cleanReason) return;
    if (state.preparationRun?.matterName === cleanMatterName && state.preparationRun.state === 'running') return;
    void runPreparationForMatter(cleanMatterName, {
      reason: `[prepare] force full rebuild for "${cleanMatterName}": ${cleanReason}`,
      mode: 'full',
      initialMessage: 'Force rebuilding preparation…',
    });
  }, [runPreparationForMatter, state.preparationRun]);

  const answerMatterQuestion = useCallback(async (
    question: string,
    {
      matterName = state.activeMatter?.name ?? state.resumeMatterName ?? null,
      manageRunning = true,
    }: { matterName?: string | null; manageRunning?: boolean } = {},
  ) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;
    if (!matterName) {
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Pick a matter before asking a matter question.' });
      appendTerminal(['[assistant] no active matter']);
      return;
    }
    const conversation = boundedConversationForRequest(copilotThread);
    if (manageRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    dispatch({ type: 'SET_COMMAND_COPY', payload: 'Reading the current matter record…' });
    appendCopilotThreadTurn({ role: 'user', mode: 'ask', text: cleanQuestion });
    appendTerminal(['[assistant] answering from current matter record']);
    try {
      const answer = await api.answerMatterQuestion({ question: cleanQuestion, matterName, conversation });
      if (selectedMatterNameRef.current !== matterName) return;
      const formattedAnswer = formatMatterCopilotAnswer(answer);
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Answered from the current matter record. See the conversation below.' });
      appendCopilotThreadTurn({ role: 'assistant', mode: 'ask', text: formattedAnswer });
      appendTerminal([
        `[assistant] ${answer.answer_status} — ${(answer.sources || []).length} validated source(s)`,
        ...(canSeeOperatorDetails
          ? [answer.ai_run?.provider && answer.ai_run?.model
            ? `[assistant] route: ${answer.ai_run.provider} / ${answer.ai_run.model}`
            : '[assistant] route metadata unavailable']
          : []),
      ]);
    } catch (e) {
      if (selectedMatterNameRef.current !== matterName) return;
      const message = getErrorMessage(e);
      const formattedError = formatMatterCopilotError(message);
      appendTerminal([formatMatterCopilotTerminalError(message)]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Ask could not complete. See the conversation below.' });
      appendCopilotThreadTurn({ role: 'assistant', mode: 'ask', text: formattedError });
    } finally {
      if (manageRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [state.activeMatter?.name, state.resumeMatterName, copilotThread, selectedMatterNameRef, dispatch, appendTerminal, appendCopilotThreadTurn, canSeeOperatorDetails]);

  const researchMatterQuestion = useCallback(async (
    question: string,
    {
      matterName = state.activeMatter?.name ?? state.resumeMatterName ?? null,
      manageRunning = true,
    }: { matterName?: string | null; manageRunning?: boolean } = {},
  ) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;
    if (!matterName) {
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Pick a matter before using Research.' });
      appendTerminal(['[research] no active matter']);
      return;
    }
    if (manageRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    dispatch({ type: 'SET_COMMAND_COPY', payload: 'Searching public legal sources…' });
    appendCopilotThreadTurn({ role: 'user', mode: 'research', text: cleanQuestion });
    appendTerminal(['[research] searching public legal sources', '[research] preparing answer']);
    try {
      const answer = await api.researchMatterQuestion({ question: cleanQuestion, matterName });
      if (selectedMatterNameRef.current !== matterName) return;
      const formattedAnswer = formatMatterCopilotResearchAnswer(answer);
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Research answer ready. See the conversation below.' });
      appendCopilotThreadTurn({ role: 'assistant', mode: 'research', text: formattedAnswer });
      reportResearchAnswer({
        matterName,
        answerStatus: answer.answer_status,
        publicSourceCount: (answer.public_sources || []).length,
      });
      appendTerminal([
        `[research] ${answer.answer_status} — ${(answer.public_sources || []).length} public source(s)`,
        ...(canSeeOperatorDetails
          ? [answer.ai_run?.provider && answer.ai_run?.model
            ? `[research] route: ${answer.ai_run.provider} / ${answer.ai_run.model}`
            : '[research] route metadata unavailable']
          : []),
      ]);
    } catch (e) {
      if (selectedMatterNameRef.current !== matterName) return;
      const message = getErrorMessage(e);
      const formattedError = formatMatterCopilotResearchError(message);
      reportResearchFailure({ matterName, error: e });
      appendTerminal([`[research] failed: ${formattedError.replace(/\s+/g, ' ').trim()}`]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Research could not complete. See the conversation below.' });
      appendCopilotThreadTurn({ role: 'assistant', mode: 'research', text: formattedError });
    } finally {
      if (manageRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [state.activeMatter?.name, state.resumeMatterName, selectedMatterNameRef, dispatch, appendTerminal, appendCopilotThreadTurn, canSeeOperatorDetails]);

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

  useEffect(() => {
    let cancelled = false;
    async function loadAuthStatus() {
      try {
        const status = await api.getAuthStatus();
        if (!cancelled) {
          setAuthStatus(status);
          setShowWhatsNew(Boolean(status.authenticated));
          dispatch({ type: 'SET_CONFIG', payload: { authUser: status.user, authEnabled: status.enabled } });
        }
      } catch (e) {
        if (!cancelled) {
          setAuthError(getErrorMessage(e));
          setAuthStatus({ enabled: true, authenticated: false, user: null });
          dispatch({ type: 'SET_CONFIG', payload: { authUser: null, authEnabled: true } });
        }
      }
    }
    void loadAuthStatus();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  useEffect(() => {
    setPendingConfigurableOverwrite(null);
  }, [state.activeMatter?.name]);


  // Bootstrap: load config and matter list once on app start.
  useEffect(() => {
    if (!authStatus?.authenticated) return undefined;
    let cancelled = false;
    async function bootstrap() {
      try {
        const [config, mattersResult] = await Promise.all([
          api.getConfig(),
          api.getMatters({ includeArchived: true }),
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
  }, [appendTerminal, authStatus?.authenticated, dispatch]);

  const handleLogin = useCallback(async ({ username, password }: { username: string; password: string }) => {
    setAuthError('');
    try {
      const status = await api.login({ username, password });
      resetReadinessGate();
      setAuthStatus(status);
      setShowWhatsNew(Boolean(status.authenticated));
      dispatch({ type: 'SET_CONFIG', payload: { authUser: status.user, authEnabled: status.enabled } });
      appendTerminal(['[auth] signed in']);
    } catch (e) {
      setAuthError(getErrorMessage(e));
    }
  }, [appendTerminal, dispatch, resetReadinessGate]);

  const handleLogout = useCallback(async () => {
    try {
      const status = await api.logout();
      resetReadinessGate();
      setAuthStatus(status);
      setShowWhatsNew(false);
      dispatch({ type: 'SET_CONFIG', payload: { authUser: status.user, authEnabled: status.enabled } });
      appendTerminal(['[auth] signed out']);
    } catch (e) {
      setAuthError(getErrorMessage(e));
    }
  }, [appendTerminal, dispatch, resetReadinessGate]);

  const runConfigurableSkillFromCommand = useCallback(async ({
    slash,
    skillLabel,
    matterName,
    overwrite = false,
  }: {
    slash: string;
    skillLabel: string;
    matterName: string;
    overwrite?: boolean;
  }) => {
    appendTerminal([`[skill] ${overwrite ? 'overwriting' : 'running'} ${skillLabel} on ${matterName}…`]);
    const run = await api.runConfigurableSkill({ slash, overwrite, matterName });
    if (activeMatterNameRef.current !== matterName) return;
    if (run.state === 'requires_overwrite') {
      const artifact = run.artifactPath || run.outputPaths?.markdown || null;
      setPendingConfigurableOverwrite({ slash, skillLabel, matterName, artifactPath: artifact });
      const artifactLabel = artifact ? ` at ${humanizeArtifactPath(artifact)}` : '';
      dispatch({
        type: 'SET_COMMAND_COPY',
        payload: `${skillLabel} already has output${artifactLabel}. Run again to replace it, or keep the existing output.`,
      });
      appendTerminal([`[skill] ${skillLabel} output exists — overwrite confirmation shown`]);
      return;
    }
    setPendingConfigurableOverwrite((current) => (
      current?.slash === slash && current?.matterName === matterName ? null : current
    ));
    await refreshActiveMatterWorkspace({
      expectedMatterName: matterName,
      failurePrefix: '[workspace] refresh failed after custom skill output',
    });
    if (activeMatterNameRef.current !== matterName) return;
    dispatch({ type: 'SET_COMMAND_COPY', payload: `${skillLabel} complete.` });
    appendTerminal([`[skill] ${skillLabel} completed`]);
  }, [activeMatterNameRef, appendTerminal, dispatch, refreshActiveMatterWorkspace]);

  const confirmConfigurableOverwrite = useCallback(async () => {
    if (!pendingConfigurableOverwrite || state.isCommandRunning) return;
    dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    try {
      await runConfigurableSkillFromCommand({
        slash: pendingConfigurableOverwrite.slash,
        skillLabel: pendingConfigurableOverwrite.skillLabel,
        matterName: pendingConfigurableOverwrite.matterName,
        overwrite: true,
      });
    } catch (e) {
      if (activeMatterNameRef.current !== pendingConfigurableOverwrite.matterName) return;
      const message = getErrorMessage(e);
      appendTerminal([`[skill] overwrite failed: ${message}`]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: `Could not rerun ${pendingConfigurableOverwrite.skillLabel}: ${message}` });
    } finally {
      dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [activeMatterNameRef, appendTerminal, dispatch, pendingConfigurableOverwrite, runConfigurableSkillFromCommand, state.isCommandRunning]);

  const cancelConfigurableOverwrite = useCallback(async () => {
    if (!pendingConfigurableOverwrite || state.isCommandRunning) return;
    dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    try {
      await api.cancelSkillRun({
        slash: pendingConfigurableOverwrite.slash,
        artifactPath: pendingConfigurableOverwrite.artifactPath || undefined,
        matterName: pendingConfigurableOverwrite.matterName,
        reason: 'User kept existing output from the command rail.',
      });
      if (activeMatterNameRef.current !== pendingConfigurableOverwrite.matterName) return;
      setPendingConfigurableOverwrite(null);
      dispatch({ type: 'SET_COMMAND_COPY', payload: `${pendingConfigurableOverwrite.skillLabel} was not rerun. Existing output kept.` });
      appendTerminal([`[skill] ${pendingConfigurableOverwrite.skillLabel} overwrite cancelled`]);
    } catch (e) {
      if (activeMatterNameRef.current !== pendingConfigurableOverwrite.matterName) return;
      const message = getErrorMessage(e);
      appendTerminal([`[skill] cancel failed: ${message}`]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: `Could not record the cancellation: ${message}` });
    } finally {
      dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [activeMatterNameRef, appendTerminal, dispatch, pendingConfigurableOverwrite, state.isCommandRunning]);

  const runMatterStoryFromCommand = useCallback(async (
    matterNameInput?: string | null,
    { manageCommandRunning = true }: { manageCommandRunning?: boolean } = {},
  ) => {
    const matterName = String(matterNameInput || state.activeMatter?.name || '').trim();
    if (!matterName) {
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Pick a matter before writing the Matter Story.' });
      return;
    }

    if (manageCommandRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    dispatch({ type: 'SET_COMMAND_COPY', payload: 'Writing Matter Story…' });
    appendTerminal([`[story] writing Matter Story for "${matterName}"`]);

    try {
      const result = await api.runMatterStory({ matterName, overwrite: true });
      if (activeMatterNameRef.current !== matterName) return;
      await refreshActiveMatterWorkspace({
        expectedMatterName: matterName,
        failurePrefix: '[workspace] refresh failed after Matter Story',
      });
      if (activeMatterNameRef.current !== matterName) return;

      const storyPath = result.artifactPath || '20_Workshop/The Story.md';
      try {
        const preview = await loadTextFilePreview(storyPath, (filePath) => api.getFile(filePath, matterName));
        if (activeMatterNameRef.current !== matterName) return;
        dispatch({ type: 'SET_ACTIVE_FILE', payload: storyPath });
        dispatch({ type: 'SET_BREADCRUMBS', payload: filePreviewTitle(storyPath) });
        dispatch({ type: 'SET_FILE_PREVIEW', payload: preview });
        dispatch({ type: 'SET_VIEW', payload: 'file-preview' });
      } catch {
        if (activeMatterNameRef.current !== matterName) return;
      }

      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Matter Story is ready.' });
      appendTerminal([`[story] ready: ${storyPath}`]);
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      const message = getErrorMessage(e);
      dispatch({ type: 'SET_COMMAND_COPY', payload: `Matter Story could not be written: ${message}` });
      appendTerminal([`[story] failed: ${message}`]);
    } finally {
      if (manageCommandRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [activeMatterNameRef, appendTerminal, dispatch, refreshActiveMatterWorkspace, state.activeMatter?.name]);

  const runProceduralPostureDiagnosisFromCommand = useCallback(async (
    matterNameInput?: string | null,
    { manageCommandRunning = true }: { manageCommandRunning?: boolean } = {},
  ) => {
    const matterName = String(matterNameInput || state.activeMatter?.name || '').trim();
    if (!matterName) {
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Pick a matter before diagnosing procedural posture.' });
      return;
    }

    if (manageCommandRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    dispatch({ type: 'SET_COMMAND_COPY', payload: 'Diagnosing filing and procedural posture…' });
    appendTerminal([`[posture] diagnosing filing and procedural posture for "${matterName}"`]);

    try {
      const current = await api.getProceduralPostureDiagnosis(matterName);
      if (activeMatterNameRef.current !== matterName) return;

      const hasExistingDiagnosis = Boolean(current.markdownPresent || current.jsonPresent);
      let overwrite = false;
      if (hasExistingDiagnosis) {
        const ok = typeof window !== 'undefined' && window.confirm(
          'Replace the existing provisional procedural posture diagnosis? This may use paid Assistant capacity and the new output still requires lawyer review.',
        );
        if (!ok) {
          dispatch({ type: 'SET_COMMAND_COPY', payload: 'Existing procedural posture diagnosis kept. No rerun started.' });
          appendTerminal([`[posture] skipped: existing diagnosis kept for "${matterName}"`]);
          return;
        }
        overwrite = true;
        dispatch({ type: 'SET_COMMAND_COPY', payload: 'Replacing filing and procedural posture diagnosis…' });
      }

      const result = await api.runProceduralPostureDiagnosis({ matterName, overwrite });
      if (activeMatterNameRef.current !== matterName) return;
      if (result.state === 'requires_overwrite') {
        dispatch({ type: 'SET_COMMAND_COPY', payload: 'Existing procedural posture diagnosis kept. Confirm replacement before rerunning this guarded analysis.' });
        appendTerminal([`[posture] skipped: existing diagnosis requires confirmation for "${matterName}"`]);
        return;
      }

      await refreshActiveMatterWorkspace({
        expectedMatterName: matterName,
        failurePrefix: '[workspace] refresh failed after procedural posture diagnosis',
      });
      if (activeMatterNameRef.current !== matterName) return;

      const diagnosisPath = result.artifactPath || '20_Workshop/Case Analysis/Filing and Procedural Posture Diagnosis.md';
      try {
        const preview = await loadTextFilePreview(diagnosisPath, (filePath) => api.getFile(filePath, matterName));
        if (activeMatterNameRef.current !== matterName) return;
        dispatch({ type: 'SET_ACTIVE_FILE', payload: diagnosisPath });
        dispatch({ type: 'SET_BREADCRUMBS', payload: filePreviewTitle(diagnosisPath) });
        dispatch({ type: 'SET_FILE_PREVIEW', payload: preview });
        dispatch({ type: 'SET_VIEW', payload: 'file-preview' });
      } catch {
        if (activeMatterNameRef.current !== matterName) return;
      }

      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Procedural posture diagnosis is ready for lawyer review.' });
      appendTerminal([`[posture] ready: ${diagnosisPath}`]);
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      const message = getErrorMessage(e);
      dispatch({ type: 'SET_COMMAND_COPY', payload: `Procedural posture diagnosis could not be created: ${message}` });
      appendTerminal([`[posture] failed: ${message}`]);
    } finally {
      if (manageCommandRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [activeMatterNameRef, appendTerminal, dispatch, refreshActiveMatterWorkspace, state.activeMatter?.name]);

  const runMwListOfDatesFromCommand = useCallback(async (
    matterNameInput?: string | null,
    { manageCommandRunning = true }: { manageCommandRunning?: boolean } = {},
  ) => {
    const matterName = String(matterNameInput || state.activeMatter?.name || '').trim();
    if (!matterName) {
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Pick a matter before creating the MW List of Dates.' });
      return;
    }

    if (manageCommandRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    dispatch({ type: 'SET_COMMAND_COPY', payload: 'Checking MW List of Dates inputs…' });
    appendTerminal([`[mw-list-of-dates] checking inputs for "${matterName}"`]);

    try {
      const current = await api.getMwListOfDatesStatus(matterName);
      if (activeMatterNameRef.current !== matterName) return;
      if (current.state?.startsWith('blocked_')) {
        const reason = current.blockedReasons?.[0] || 'Refresh the required upstream preparation first.';
        dispatch({ type: 'SET_COMMAND_COPY', payload: `MW List of Dates is blocked: ${reason}` });
        appendTerminal([`[mw-list-of-dates] blocked: ${reason}`]);
        return;
      }

      const hasExisting = Boolean(current.currentMarkdownPresent || current.currentJsonPresent);
      let overwrite = false;
      if (hasExisting) {
        const ok = typeof window !== 'undefined' && window.confirm(
          'Replace the existing MW List of Dates? The previous version will be archived. This may use paid Assistant capacity.',
        );
        if (!ok) {
          dispatch({ type: 'SET_COMMAND_COPY', payload: 'Existing MW List of Dates kept. No rerun started.' });
          appendTerminal([`[mw-list-of-dates] skipped: existing artifact kept for "${matterName}"`]);
          return;
        }
        overwrite = true;
      }

      let proceedUnconfirmed = false;
      let proceedUnconfirmedReason = '';
      if (current.confirmation?.state && current.confirmation.state !== 'confirmed' && current.confirmation.state !== 'corrected') {
        const reason = typeof window !== 'undefined'
          ? window.prompt('The procedural diagnosis is not confirmed. Add a reason to proceed with a provisional MW List of Dates, or cancel.')
          : '';
        if (!reason?.trim()) {
          dispatch({ type: 'SET_COMMAND_COPY', payload: 'MW List of Dates not created without a confirmed diagnosis or explicit reason.' });
          appendTerminal([`[mw-list-of-dates] skipped: diagnosis unconfirmed for "${matterName}"`]);
          return;
        }
        proceedUnconfirmed = true;
        proceedUnconfirmedReason = reason.trim();
      }

      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Creating MW List of Dates…' });
      const result = await api.runMwListOfDates({ matterName, overwrite, proceedUnconfirmed, proceedUnconfirmedReason });
      if (activeMatterNameRef.current !== matterName) return;
      if (result.state === 'requires_overwrite') {
        dispatch({ type: 'SET_COMMAND_COPY', payload: 'Existing MW List of Dates kept. Confirm replacement before rerunning.' });
        appendTerminal([`[mw-list-of-dates] skipped: overwrite confirmation required for "${matterName}"`]);
        return;
      }

      await refreshActiveMatterWorkspace({
        expectedMatterName: matterName,
        failurePrefix: '[workspace] refresh failed after MW List of Dates',
      });
      if (activeMatterNameRef.current !== matterName) return;

      const artifactPath = result.artifactPath || '20_Workshop/Case Analysis/MW List of Dates.md';
      try {
        const preview = await loadTextFilePreview(artifactPath, (filePath) => api.getFile(filePath, matterName));
        if (activeMatterNameRef.current !== matterName) return;
        dispatch({ type: 'SET_ACTIVE_FILE', payload: artifactPath });
        dispatch({ type: 'SET_BREADCRUMBS', payload: filePreviewTitle(artifactPath) });
        dispatch({ type: 'SET_FILE_PREVIEW', payload: preview });
        dispatch({ type: 'SET_VIEW', payload: 'file-preview' });
      } catch {
        if (activeMatterNameRef.current !== matterName) return;
      }

      dispatch({ type: 'SET_COMMAND_COPY', payload: 'MW List of Dates is ready for lawyer review.' });
      appendTerminal([`[mw-list-of-dates] ready: ${artifactPath}`]);
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      const message = getErrorMessage(e);
      dispatch({ type: 'SET_COMMAND_COPY', payload: `MW List of Dates could not be created: ${message}` });
      appendTerminal([`[mw-list-of-dates] failed: ${message}`]);
    } finally {
      if (manageCommandRunning) dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [activeMatterNameRef, appendTerminal, dispatch, refreshActiveMatterWorkspace, state.activeMatter?.name]);

  const handleCommand = useCallback(async (cmd: string) => {
    const lower = cmd.toLowerCase().trim();
    if (lower === '/whats_new' || lower === '/whatsnew' || lower === 'whats new' || lower === "what's new") {
      setShowWhatsNew(true);
      dispatch({ type: 'SET_COMMAND_COPY', payload: "Opened What's new for testers." });
      appendTerminal(["[release] what's new opened"]);
      return;
    }
    const localReply = localAssistantReply(cmd, Boolean(state.activeMatter));
    if (localReply) {
      dispatch({ type: 'SET_COMMAND_COPY', payload: localReply });
      appendTerminal(['[assistant] local reply']);
      return;
    }

    const researchQuestion = parseResearchCommand(cmd);
    if (researchQuestion) {
      await researchMatterQuestion(researchQuestion);
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
      if (nativeResolution.command === '/the_story') {
        await runMatterStoryFromCommand(state.activeMatter?.name ?? null);
        return;
      }
      if (nativeResolution.command === '/procedural_posture_diagnosis') {
        await runProceduralPostureDiagnosisFromCommand(state.activeMatter?.name ?? null);
        return;
      }
      if (nativeResolution.command === '/create_mw_listofdates') {
        await runMwListOfDatesFromCommand(state.activeMatter?.name ?? null);
        return;
      }
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
    const matterName = state.activeMatter?.name ?? state.resumeMatterName ?? null;
    dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
    appendTerminal([`[cmd] "${cmd}"`]);
    try {
      const result = await api.checkIntent({ userRequest: cmd, matterName: matterName ?? undefined });
      if (activeMatterNameRef.current !== matterName) return;
      if (result.decision === 'run_existing_skill' && result.matched_skill) {
        const matchedResolution = resolveNativeCommand(result.matched_skill);
        if (matchedResolution) {
          if (matchedResolution.command === '/the_story') {
            await runMatterStoryFromCommand(matterName, { manageCommandRunning: false });
            return;
          }
          if (matchedResolution.command === '/procedural_posture_diagnosis') {
            await runProceduralPostureDiagnosisFromCommand(matterName, { manageCommandRunning: false });
            return;
          }
          if (matchedResolution.command === '/create_mw_listofdates') {
            await runMwListOfDatesFromCommand(matterName, { manageCommandRunning: false });
            return;
          }
          setActiveView(matchedResolution.view);
          dispatch({ type: 'SET_BREADCRUMBS', payload: cleanCommandLabel(matchedResolution.command) });
        } else if (result.matched_skill_card?.configurable) {
          if (!matterName) {
            dispatch({ type: 'SET_COMMAND_COPY', payload: 'Pick a matter before running this skill.' });
            return;
          }
          const skillLabel = result.matched_skill_card.display?.action || result.matched_skill_card.title || cleanCommandLabel(result.matched_skill);
          await runConfigurableSkillFromCommand({
            slash: result.matched_skill,
            skillLabel,
            matterName,
            overwrite: false,
          });
        } else {
          dispatch({ type: 'SET_COMMAND_COPY', payload: formatIntentDiscoveryGuidance(result) || `Run ${result.matched_skill}` });
        }
      } else if (result.decision === 'transient_copilot') {
        appendTerminal(['[cmd] routed to assistant answer']);
        await answerMatterQuestion(cmd, { matterName, manageRunning: false });
      } else if (result.suggested_next_action) {
        dispatch({ type: 'SET_COMMAND_COPY', payload: formatIntentDiscoveryGuidance(result) });
      }
    } catch (e) {
      if (activeMatterNameRef.current !== matterName) return;
      const message = getUserFacingErrorMessage(e);
      appendTerminal([`[cmd] check failed for "${cmd}": ${message}`]);
      dispatch({ type: 'SET_COMMAND_COPY', payload: 'Could not check that command. Try again, or use a listed action.' });
    } finally {
      dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
    }
  }, [state.activeMatter, state.activeMatter?.name, state.resumeMatterName, activeMatterNameRef, dispatch, appendTerminal, setActiveView, answerMatterQuestion, researchMatterQuestion, openMatterFinder, runConfigurableSkillFromCommand, runMatterStoryFromCommand, runProceduralPostureDiagnosisFromCommand, runMwListOfDatesFromCommand]);

  function handleMatterCreated(name: string, opts: { autoPrepare?: boolean } = {}) {
    activeMatterNameRef.current = name;
    dispatch({ type: 'SET_RESUME_MATTER', payload: name });
    setActiveView('home');
    api.getMatters({ includeArchived: true })
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
    const pendingSkillsAction = state.pendingSkillsMatterAction;
    if (pendingSkillsAction) {
      dispatch({ type: 'SET_PENDING_SKILLS_MATTER_ACTION', payload: null });
      if (pendingSkillsAction.kind === 'native-workflow' && pendingSkillsAction.command) {
        const nativeResolution = resolveNativeCommand(pendingSkillsAction.command);
        appendTerminal([`[skills] continuing ${pendingSkillsAction.label} for "${name}"`]);
        if (nativeResolution?.command === '/the_story') {
          void runMatterStoryFromCommand(name);
          return;
        }
        if (nativeResolution?.command === '/procedural_posture_diagnosis') {
          void runProceduralPostureDiagnosisFromCommand(name);
          return;
        }
        if (nativeResolution?.command === '/create_mw_listofdates') {
          void runMwListOfDatesFromCommand(name);
          return;
        }
        if (nativeResolution) {
          dispatch({ type: 'SET_TAB', payload: 'home' });
          setActiveView(nativeResolution.view);
          dispatch({ type: 'SET_BREADCRUMBS', payload: cleanCommandLabel(nativeResolution.command) });
          return;
        }
      }
      if (pendingSkillsAction.kind === 'custom-skill' && pendingSkillsAction.slash) {
        dispatch({ type: 'SET_TAB', payload: 'skills' });
        dispatch({ type: 'SET_BREADCRUMBS', payload: 'Skills' });
        dispatch({ type: 'SET_COMMAND_RUNNING', payload: true });
        void runConfigurableSkillFromCommand({
          slash: pendingSkillsAction.slash,
          skillLabel: pendingSkillsAction.label,
          matterName: name,
          overwrite: false,
        }).catch((error) => {
          appendTerminal([`[skill] ${pendingSkillsAction.label} failed: ${getErrorMessage(error)}`]);
          dispatch({ type: 'SET_COMMAND_COPY', payload: `${pendingSkillsAction.label} could not run: ${getErrorMessage(error)}` });
        }).finally(() => {
          dispatch({ type: 'SET_COMMAND_RUNNING', payload: false });
        });
        return;
      }
      if (pendingSkillsAction.kind === 'skill-idea' && pendingSkillsAction.idea) {
        dispatch({ type: 'SET_TAB', payload: 'skills' });
        setActiveView('home');
        dispatch({ type: 'SET_BREADCRUMBS', payload: 'Skills' });
        dispatch({ type: 'SET_PENDING_SKILL_IDEA_RESUME', payload: pendingSkillsAction.idea });
        appendTerminal([`[skill-idea] continuing ${pendingSkillsAction.label} for "${name}"`]);
        return;
      }
    }

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

  if (!authStatus) {
    return <PrivateBetaAuthLoading error={authError} />;
  }

  if (authStatus.enabled && !authStatus.authenticated) {
    return <PrivateBetaLogin error={authError} onLogin={handleLogin} />;
  }

  if (authStatus.authenticated && !readinessGate.dismissed) {
    return <PrivateBetaReadinessGate gate={readinessGate} />;
  }

  const isHomeModeClass = !state.activeMatter ? 'home-mode' : '';
  const readinessAttentionMessage = readinessGate.checks.find((check) => check.status === 'attention')?.message || readinessGate.message;
  const readinessBanner = readinessGate.dismissed && ['degraded', 'error', 'timeout'].includes(readinessGate.phase)
    ? readinessAttentionMessage
    : '';

  return (
    <div className={`app-shell ${isHomeModeClass}`}>
      {readinessBanner && (
        <div className="readiness-session-banner" role="status">
          {readinessBanner}
        </div>
      )}
      {showWhatsNew && (
        <BetaWhatsNewBanner
          release={state.config?.release ?? null}
          onDismiss={() => setShowWhatsNew(false)}
        />
      )}
      <Sidebar
        onNewMatter={() => setActiveView('new-matter')}
        onAddFiles={() => setActiveView('add-files')}
        onViewAllMatters={() => { void openMatterFinder(); }}
        onLogout={authStatus.enabled && authStatus.user ? () => { void handleLogout(); } : undefined}
      />
      <MainContent
        onNewMatter={() => setActiveView('new-matter')}
        onMatterCreated={handleMatterCreated}
        onViewAllMatters={() => { void openMatterFinder(); }}
        onOpenMatter={handleOpenMatter}
        onAddFilesDone={handleAddFilesDone}
        onCommand={handleCommand}
        onRunNeededPreparation={handleRunNeededPreparation}
        onForceFullPreparation={handleForceFullPreparation}
        commandPanel={
          <CommandPanel
            onCommand={handleCommand}
            onTransientCopilotQuestion={(question) => answerMatterQuestion(question, { manageRunning: false })}
            copilotThread={copilotThread}
            onClearCopilotThread={() => setCopilotThread([])}
            reportText={reportText}
            onCopyReport={handleCopyReport}
            pendingConfigurableOverwrite={pendingConfigurableOverwrite}
            onConfirmConfigurableOverwrite={confirmConfigurableOverwrite}
            onCancelConfigurableOverwrite={cancelConfigurableOverwrite}
          />
        }
      />
    </div>
  );
}

const TESTER_WHATS_NEW_ITEMS = [
  'Larger beta upload batches are supported, including files up to 256 MB and large folders.',
  'Long uploads and document reading now show clearer progress and keep-page-open guidance.',
  'Matters can be archived and reopened without deleting source records or history.',
  'Source files can be removed from the active record without deleting the original evidence.',
];

function BetaWhatsNewBanner({
  release,
  onDismiss,
}: {
  release: AppConfig['release'];
  onDismiss: () => void;
}) {
  const codename = release?.codename?.trim() || '';
  const version = release?.version?.trim() || '';
  const label = codename || release?.label?.trim() || 'Latest beta update';
  const note = release?.note?.trim() || '';
  const date = release?.date?.trim() || '';
  const releaseLine = [label, version, date].filter(Boolean).join(' · ');
  return (
    <section className="beta-whats-new-card" role="status" aria-live="polite" aria-label="What's new in this beta">
      <div className="beta-whats-new-header">
        <div>
          <div className="section-kicker">What's new</div>
          <h2>Welcome back — here is what to test</h2>
          <p>{releaseLine}</p>
        </div>
        <button type="button" className="beta-whats-new-dismiss" onClick={onDismiss} aria-label="Dismiss what's new">
          ×
        </button>
      </div>
      <ul>
        {TESTER_WHATS_NEW_ITEMS.map((item) => <li key={item}>{item}</li>)}
      </ul>
      {note && <p className="beta-whats-new-note">Build note: {note}</p>}
      <p className="beta-whats-new-tip">Tip: type <code>/whats_new</code> anytime to reopen this note.</p>
    </section>
  );
}

function PrivateBetaAuthLoading({ error }: { error: string }) {
  return (
    <div className="private-beta-auth-screen">
      <div className="private-beta-auth-card">
        <div className="section-kicker">Matter Workbench</div>
        <h1>Checking access</h1>
        <p>Opening the private beta workspace…</p>
        {error && <div className="form-error">{error}</div>}
      </div>
    </div>
  );
}

function preparationStartStageLabel(startStage = ''): string {
  if (startStage === '/describe_sources' || startStage === 'source_labels' || startStage === 'describe-sources') return 'Source Labels';
  if (startStage === '/create_case_timeline' || startStage === '/create_listofdates' || startStage === 'case_timeline' || startStage === 'case-timeline' || startStage === 'create-listofdates') return 'Case Timeline';
  if (startStage === '/the_story' || startStage === 'matter_story' || startStage === 'dispute-story') return 'Matter Story';
  if (startStage === '/procedural_posture_diagnosis' || startStage === 'posture_diagnosis' || startStage === 'procedural-posture-diagnosis') return 'Procedural Diagnosis';
  if (startStage === '/extract' || startStage === 'extract') return 'document reading';
  if (startStage === '/matter-init' || startStage === 'matter_init' || startStage === 'matter-init') return 'matter setup';
  return 'selected stage';
}

function PrivateBetaLogin({
  error,
  onLogin,
}: {
  error: string;
  onLogin: (credentials: { username: string; password: string }) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await onLogin({ username, password });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="private-beta-auth-screen">
      <form className="private-beta-auth-card" onSubmit={(event) => { void handleSubmit(event); }}>
        <div className="section-kicker">Private Beta</div>
        <h1>Sign in to Matter Workbench</h1>
        <p>This private VM is access-controlled. Use the operator credentials from the protected runtime env.</p>
        <label htmlFor="private-beta-username">
          <span>Username</span>
          <input
            id="private-beta-username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label htmlFor="private-beta-password">
          <span>Password</span>
          <input
            id="private-beta-password"
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" disabled={submitting || !username.trim() || !password}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
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

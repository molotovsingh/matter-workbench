import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type {
  AppState,
  ActiveMatter,
  Matter,
  ActiveTab,
  ActiveView,
  FilePreview,
  PreparationRunStatus,
  WorkspaceApiResponse,
} from '../types';
import { api } from '../api/client';
import { activeMatterFromWorkspace } from '../lib/activeMatter';
import { stampActivityLines, trimActivityLines } from '../lib/activityLog';
import { DEFAULT_COMMAND_COPY_TEXT } from '../lib/commandPanelCopy';
import { getErrorMessage } from '../lib/errors';

type Action =
  | { type: 'SET_CONFIG'; payload: Partial<AppState> }
  | { type: 'SET_MATTERS'; payload: Matter[] }
  | { type: 'SET_ACTIVE_MATTER'; payload: ActiveMatter | null }
  | { type: 'SET_RESUME_MATTER'; payload: string | null }
  | { type: 'SET_TAB'; payload: ActiveTab }
  | { type: 'SET_VIEW'; payload: ActiveView }
  | { type: 'SET_FILE_PREVIEW'; payload: FilePreview | null }
  | { type: 'SET_THEME'; payload: 'light' | 'dark' }
  | { type: 'SET_MATTER_SEARCH'; payload: string }
  | { type: 'SET_SHOW_TECHNICAL'; payload: boolean }
  | { type: 'SET_ACTIVE_FILE'; payload: string | null }
  | { type: 'RESET_MATTER_TRANSIENT_VIEW' }
  | { type: 'SET_BREADCRUMBS'; payload: string }
  | { type: 'SET_TITLE'; payload: string }
  | { type: 'SET_STATUS_BAR'; payload: string }
  | { type: 'APPEND_TERMINAL'; payload: { terminalLines: string[]; activityLines: string[] } }
  | { type: 'CLEAR_TERMINAL' }
  | { type: 'SET_COMMAND_COPY'; payload: string }
  | { type: 'SET_COMMAND_RUNNING'; payload: boolean }
  | { type: 'SET_PREPARATION_RUN'; payload: PreparationRunStatus | null };

function readStoredTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem('matter-workbench-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

const initialState: AppState = {
  config: null,
  activeMatter: null,
  matters: [],
  resumeMatterName: null,
  activeTab: 'home',
  activeView: 'home',
  filePreview: null,
  theme: readStoredTheme(),
  matterSearchQuery: '',
  showTechnicalFiles: false,
  activeFilePath: null,
  breadcrumbs: 'Home',
  titleText: 'No matter selected',
  statusBar: 'Pick a matter to begin',
  terminalLines: ['[workbench] ready'],
  activityLines: [],
  commandCopyText: DEFAULT_COMMAND_COPY_TEXT,
  isCommandRunning: false,
  preparationRun: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CONFIG':
      return { ...state, ...action.payload };
    case 'SET_MATTERS':
      return { ...state, matters: action.payload };
    case 'SET_ACTIVE_MATTER':
      return { ...state, activeMatter: action.payload };
    case 'SET_RESUME_MATTER':
      return { ...state, resumeMatterName: action.payload };
    case 'SET_TAB':
      return { ...state, activeTab: action.payload, activeView: 'home' };
    case 'SET_VIEW':
      return { ...state, activeView: action.payload };
    case 'SET_FILE_PREVIEW':
      return { ...state, filePreview: action.payload };
    case 'SET_THEME':
      return { ...state, theme: action.payload };
    case 'SET_MATTER_SEARCH':
      return { ...state, matterSearchQuery: action.payload };
    case 'SET_SHOW_TECHNICAL':
      return { ...state, showTechnicalFiles: action.payload };
    case 'SET_ACTIVE_FILE':
      return { ...state, activeFilePath: action.payload };
    case 'RESET_MATTER_TRANSIENT_VIEW':
      return { ...state, activeView: 'home', filePreview: null, activeFilePath: null };
    case 'SET_BREADCRUMBS':
      return { ...state, breadcrumbs: action.payload };
    case 'SET_TITLE':
      return { ...state, titleText: action.payload };
    case 'SET_STATUS_BAR':
      return { ...state, statusBar: action.payload };
    case 'APPEND_TERMINAL':
      return {
        ...state,
        terminalLines: [...state.terminalLines, ...action.payload.terminalLines].slice(-50),
        activityLines: trimActivityLines([...state.activityLines, ...action.payload.activityLines]),
      };
    case 'CLEAR_TERMINAL':
      return { ...state, terminalLines: [], activityLines: [] };
    case 'SET_COMMAND_COPY':
      return { ...state, commandCopyText: action.payload };
    case 'SET_COMMAND_RUNNING':
      return { ...state, isCommandRunning: action.payload };
    case 'SET_PREPARATION_RUN':
      return { ...state, preparationRun: action.payload };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setActiveMatter: (matter: ActiveMatter | null) => void;
  clearActiveMatter: () => void;
  switchActiveMatter: (name: string, opts?: SwitchActiveMatterOptions) => Promise<ActiveMatter>;
  refreshActiveMatterWorkspace: (opts?: {
    reason?: string;
    successMessage?: string;
    failurePrefix?: string;
    expectedMatterName?: string;
  }) => Promise<ActiveMatter | null>;
  appendTerminal: (lines: string[]) => void;
  setStatus: (opts: { bar?: string; terminal?: string[] }) => void;
  commandPanelRef: React.RefObject<HTMLInputElement | null>;
}

const AppContext = createContext<AppContextValue | null>(null);

type SwitchActiveMatterSummary = {
  name: string;
  activeMatter: ActiveMatter;
  workspace: WorkspaceApiResponse;
};

type SwitchActiveMatterOptions = {
  startMessage?: string | false;
  successMessage?: string | false | ((summary: SwitchActiveMatterSummary) => string);
  failureMessage?: false | ((error: unknown) => string);
};

class MatterSwitchSupersededError extends Error {
  constructor(name: string) {
    super(`Matter switch superseded: ${name}`);
    this.name = 'MatterSwitchSupersededError';
  }
}

export function isMatterSwitchSupersededError(error: unknown): boolean {
  return error instanceof MatterSwitchSupersededError;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const commandPanelRef = useRef<HTMLInputElement | null>(null);
  const matterSwitchSeqRef = useRef(0);
  const matterSwitchChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const activeMatterNameRef = useRef<string | null>(null);

  const setTheme = useCallback((theme: 'light' | 'dark') => {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : '');
    try {
      localStorage.setItem('matter-workbench-theme', theme);
    } catch {
      // Browser storage can be unavailable in restricted contexts; theme still applies in-memory.
    }
    dispatch({ type: 'SET_THEME', payload: theme });
  }, []);

  const toggleTheme = useCallback(() => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }, [state.theme, setTheme]);

  const setActiveMatter = useCallback((matter: ActiveMatter | null) => {
    activeMatterNameRef.current = matter?.name ?? null;
    dispatch({ type: 'SET_ACTIVE_MATTER', payload: matter });
    if (matter) {
      dispatch({ type: 'SET_TITLE', payload: matter.name });
      dispatch({ type: 'SET_BREADCRUMBS', payload: matter.name });
      dispatch({ type: 'SET_STATUS_BAR', payload: matter.name });
    }
  }, []);

  const clearActiveMatter = useCallback(() => {
    activeMatterNameRef.current = null;
    dispatch({ type: 'SET_ACTIVE_MATTER', payload: null });
    dispatch({ type: 'SET_PREPARATION_RUN', payload: null });
    dispatch({ type: 'SET_TITLE', payload: 'No matter selected' });
    dispatch({ type: 'SET_BREADCRUMBS', payload: 'Home' });
    dispatch({ type: 'SET_STATUS_BAR', payload: 'Pick a matter to begin' });
    dispatch({ type: 'RESET_MATTER_TRANSIENT_VIEW' });
  }, []);

  const appendTerminal = useCallback((lines: string[]) => {
    dispatch({
      type: 'APPEND_TERMINAL',
      payload: {
        terminalLines: lines,
        activityLines: stampActivityLines(lines),
      },
    });
  }, []);

  const switchActiveMatter = useCallback(async (
    name: string,
    {
      startMessage = `[matter] switching to "${name}"…`,
      successMessage,
      failureMessage,
    }: SwitchActiveMatterOptions = {},
  ) => {
    const switchSeq = matterSwitchSeqRef.current + 1;
    matterSwitchSeqRef.current = switchSeq;

    const task = matterSwitchChainRef.current.catch(() => undefined).then(async () => {
      if (matterSwitchSeqRef.current !== switchSeq) {
        throw new MatterSwitchSupersededError(name);
      }
      if (startMessage !== false) appendTerminal([startMessage]);
      try {
        const workspace = await api.switchMatter(name);
        if (matterSwitchSeqRef.current !== switchSeq) {
          throw new MatterSwitchSupersededError(name);
        }
        const activeMatter = activeMatterFromWorkspace(workspace, name);
        setActiveMatter(activeMatter);
        dispatch({ type: 'RESET_MATTER_TRANSIENT_VIEW' });
        const summary = { name, activeMatter, workspace };
        const resolvedSuccessMessage = typeof successMessage === 'function'
          ? successMessage(summary)
          : successMessage;
        if (resolvedSuccessMessage !== false) {
          appendTerminal([
            resolvedSuccessMessage
              || `[matter] loaded "${name}" — ${workspace.fileCount} files, ${workspace.directoryCount} folders`,
          ]);
        }
        return activeMatter;
      } catch (error) {
        if (isMatterSwitchSupersededError(error)) {
          throw error;
        }
        const resolvedFailureMessage = typeof failureMessage === 'function'
          ? failureMessage(error)
          : failureMessage;
        if (resolvedFailureMessage !== false) {
          appendTerminal([resolvedFailureMessage || `[matter] error: ${getErrorMessage(error)}`]);
        }
        throw error;
      }
    });

    matterSwitchChainRef.current = task.catch(() => undefined);
    return task;
  }, [appendTerminal, setActiveMatter]);

  const refreshActiveMatterWorkspace = useCallback(async ({
    reason = '',
    successMessage = '',
    failurePrefix = '[workspace] refresh failed',
    expectedMatterName = state.activeMatter?.name,
  }: { reason?: string; successMessage?: string; failurePrefix?: string; expectedMatterName?: string } = {}) => {
    const targetMatterName = expectedMatterName || activeMatterNameRef.current || state.activeMatter?.name;
    if (!targetMatterName) return null;
    if (reason) appendTerminal([reason]);
    try {
      const workspace = await api.getWorkspace(targetMatterName);
      if (activeMatterNameRef.current !== targetMatterName) {
        appendTerminal(['[workspace] refresh skipped - active matter changed']);
        return null;
      }
      if (!workspaceMatchesMatter(workspace, targetMatterName)) {
        appendTerminal(['[workspace] refresh skipped - active matter changed']);
        return null;
      }
      const refreshed = activeMatterFromWorkspace(workspace, targetMatterName);
      setActiveMatter(refreshed);
      appendTerminal([successMessage || `[workspace] refreshed — ${workspace.fileCount} files, ${workspace.directoryCount} folders`]);
      return refreshed;
    } catch (e) {
      appendTerminal([`${failurePrefix}: ${getErrorMessage(e)}`]);
      return null;
    }
  }, [appendTerminal, setActiveMatter, state.activeMatter]);

  const setStatus = useCallback((opts: { bar?: string; terminal?: string[] }) => {
    if (opts.bar) dispatch({ type: 'SET_STATUS_BAR', payload: opts.bar });
    if (opts.terminal) appendTerminal(opts.terminal);
  }, [appendTerminal]);

  const value: AppContextValue = {
    state,
    dispatch,
    setTheme,
    toggleTheme,
    setActiveMatter,
    clearActiveMatter,
    switchActiveMatter,
    refreshActiveMatterWorkspace,
    appendTerminal,
    setStatus,
    commandPanelRef,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

function workspaceMatchesMatter(workspace: WorkspaceApiResponse, expectedMatterName?: string): boolean {
  const expected = expectedMatterName?.trim();
  if (!expected) return true;
  return [workspace.folderName, workspace.metadata?.matterName]
    .filter(Boolean)
    .some((name) => name === expected);
}

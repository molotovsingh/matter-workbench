import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { AppState, ActiveMatter, Matter, ActiveTab, FilePreview } from '../types';

type Action =
  | { type: 'SET_CONFIG'; payload: Partial<AppState> }
  | { type: 'SET_MATTERS'; payload: Matter[] }
  | { type: 'SET_ACTIVE_MATTER'; payload: ActiveMatter | null }
  | { type: 'SET_RESUME_MATTER'; payload: string | null }
  | { type: 'SET_TAB'; payload: ActiveTab }
  | { type: 'SET_VIEW'; payload: string }
  | { type: 'SET_FILE_PREVIEW'; payload: FilePreview | null }
  | { type: 'SET_THEME'; payload: 'light' | 'dark' }
  | { type: 'SET_MATTER_SEARCH'; payload: string }
  | { type: 'SET_SHOW_TECHNICAL'; payload: boolean }
  | { type: 'SET_ACTIVE_FILE'; payload: string | null }
  | { type: 'SET_BREADCRUMBS'; payload: string }
  | { type: 'SET_TITLE'; payload: string }
  | { type: 'SET_STATUS_BAR'; payload: string }
  | { type: 'APPEND_TERMINAL'; payload: string[] }
  | { type: 'CLEAR_TERMINAL' }
  | { type: 'SET_COMMAND_COPY'; payload: string }
  | { type: 'SET_COMMAND_RUNNING'; payload: boolean };

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
  commandCopyText: 'Ask a general question, create a skill, or pick a matter first.',
  isCommandRunning: false,
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
    case 'SET_BREADCRUMBS':
      return { ...state, breadcrumbs: action.payload };
    case 'SET_TITLE':
      return { ...state, titleText: action.payload };
    case 'SET_STATUS_BAR':
      return { ...state, statusBar: action.payload };
    case 'APPEND_TERMINAL':
      return { ...state, terminalLines: [...state.terminalLines.slice(-50), ...action.payload] };
    case 'CLEAR_TERMINAL':
      return { ...state, terminalLines: [] };
    case 'SET_COMMAND_COPY':
      return { ...state, commandCopyText: action.payload };
    case 'SET_COMMAND_RUNNING':
      return { ...state, isCommandRunning: action.payload };
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
  appendTerminal: (lines: string[]) => void;
  setStatus: (opts: { bar?: string; terminal?: string[] }) => void;
  commandPanelRef: React.RefObject<HTMLInputElement | null>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const commandPanelRef = useRef<HTMLInputElement | null>(null);

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
    dispatch({ type: 'SET_ACTIVE_MATTER', payload: matter });
    if (matter) {
      dispatch({ type: 'SET_TITLE', payload: matter.name });
      dispatch({ type: 'SET_BREADCRUMBS', payload: matter.name });
      dispatch({ type: 'SET_STATUS_BAR', payload: matter.name });
    }
  }, []);

  const clearActiveMatter = useCallback(() => {
    dispatch({ type: 'SET_ACTIVE_MATTER', payload: null });
    dispatch({ type: 'SET_TITLE', payload: 'No matter selected' });
    dispatch({ type: 'SET_BREADCRUMBS', payload: 'Home' });
    dispatch({ type: 'SET_STATUS_BAR', payload: 'Pick a matter to begin' });
    dispatch({ type: 'SET_ACTIVE_FILE', payload: null });
  }, []);

  const appendTerminal = useCallback((lines: string[]) => {
    dispatch({ type: 'APPEND_TERMINAL', payload: lines });
  }, []);

  const setStatus = useCallback((opts: { bar?: string; terminal?: string[] }) => {
    if (opts.bar) dispatch({ type: 'SET_STATUS_BAR', payload: opts.bar });
    if (opts.terminal) dispatch({ type: 'APPEND_TERMINAL', payload: opts.terminal });
  }, []);

  const value: AppContextValue = {
    state,
    dispatch,
    setTheme,
    toggleTheme,
    setActiveMatter,
    clearActiveMatter,
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

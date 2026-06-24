import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../../store/AppContext';
import HomeLanding from '../../views/HomeLanding';
import SkillsPage from '../../views/SkillsPage';
import ActivityPage from '../../views/ActivityPage';
import SettingsPage from '../../views/SettingsPage';
import NewMatterForm from '../../views/NewMatterForm';
import AddFilesForm from '../../views/AddFilesForm';
import ExtractResult from '../../views/workflows/ExtractResult';
import DoctorResult from '../../views/workflows/DoctorResult';
import ContextSearch from '../../views/workflows/ContextSearch';
import ListOfDatesResult from '../../views/workflows/ListOfDatesResult';
import PrepareMatterResult from '../../views/workflows/PrepareMatterResult';
import DescribeSourcesResult from '../../views/workflows/DescribeSourcesResult';
import ContextPreview from '../../views/workflows/ContextPreview';
import TitleBar from './TitleBar';
import StatusBar from './StatusBar';
import {
  isListOfDatesMarkdownPath,
  lawyerFacingListOfDatesSourceFragment,
  listOfDatesRelevanceTone,
  parseListOfDatesMarkdown,
  sourceFragmentsForListOfDates,
} from '../../lib/filePreview';
import { writeClipboardText } from '../../lib/clipboard';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';

const ASSISTANT_WIDTH_STORAGE_KEY = 'mwb.matterAssistant.width';
const DEFAULT_ASSISTANT_WIDTH = 380;
const MIN_ASSISTANT_WIDTH = 320;
const MAX_ASSISTANT_WIDTH = 720;

interface Props {
  onNewMatter: () => void;
  onMatterCreated: (name: string, opts?: { autoPrepare?: boolean }) => void;
  onViewAllMatters: () => void;
  onOpenMatter: (name: string) => void;
  onAddFilesDone: (opts?: { autoPrepare?: boolean }) => void;
  onCommand: (command: string) => void;
  onRunPreparationAgain: (matterName: string) => void;
  onLogout?: () => void;
  commandPanel: React.ReactNode;
}

function FilePreview({ preview }: { preview: { path: string; type: string; url?: string; content?: string; ext?: string } }) {
  const { state } = useApp();
  const filename = preview.path.split('/').pop() ?? preview.path;
  const isListOfDatesMarkdown = preview.type === 'text' && isListOfDatesMarkdownPath(preview.path);
  const listOfDates = isListOfDatesMarkdown ? parseListOfDatesMarkdown(preview.content || '') : null;
  const showOperatorChrome = canSeeOperatorSurface(state.authEnabled, state.authUser);

  async function copyMarkdown() {
    await writeClipboardText(preview.content || '');
  }

  return (
    <div className="document-preview">
      <div className="document-preview-header">
        <div>
          <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 28, fontWeight: 600, margin: '0 0 5px' }}>
            {listOfDates?.title || filename}
          </h1>
          {showOperatorChrome ? (
            <p className="document-path">{preview.path}</p>
          ) : (
            <p className="document-path">Matter document</p>
          )}
          {listOfDates && (
            <p className="document-note">
              {[listOfDates.matter ? `Matter: ${listOfDates.matter}` : '', listOfDates.generated].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {preview.url && !isListOfDatesMarkdown && (
          <div className="document-actions">
            <a href={preview.url} download={filename} className="run-skill-button secondary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Download
            </a>
          </div>
        )}
        {isListOfDatesMarkdown && (
          <div className="document-actions">
            <button type="button" className="run-skill-button secondary" onClick={() => { void copyMarkdown(); }}>
              Copy Markdown
            </button>
            {preview.url && (
              <a href={preview.url} download={filename} className="run-skill-button secondary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                Download
              </a>
            )}
          </div>
        )}
      </div>
      {preview.type === 'pdf' && preview.url && (
        <iframe className="file-pdf-frame" src={preview.url} title={filename} />
      )}
      {preview.type === 'image' && preview.url && (
        <img className="file-image" src={preview.url} alt={filename} />
      )}
      {listOfDates && listOfDates.entries.length > 0 && (
        <ListOfDatesMarkdownPreview parsed={listOfDates} />
      )}
      {preview.type === 'text' && (!listOfDates || listOfDates.entries.length === 0) && (
        <pre style={{
          margin: '12px 0', padding: '14px', border: '1px solid var(--border)',
          background: 'var(--code-bg)', color: 'var(--text)',
          overflow: 'auto', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          maxHeight: '70vh',
        }}>
          {preview.content}
        </pre>
      )}
    </div>
  );
}

function ListOfDatesMarkdownPreview({ parsed }: { parsed: NonNullable<ReturnType<typeof parseListOfDatesMarkdown>> }) {
  return (
    <>
      <section className="chronology-table" aria-label="List of Dates chronology">
        <div className="chronology-header">
          <span>Date</span><span>Event</span><span>Relevance</span><span>Source</span>
        </div>
        {parsed.entries.map((entry, index) => {
          const tone = listOfDatesRelevanceTone(entry.relevance);
          return (
            <article key={`${entry.date}-${index}`} className={`chronology-row ${tone === 'attention' ? 'important' : ''}`}>
              <time dateTime={entry.date}>{entry.date}</time>
              <p>{entry.event}</p>
              <span className={`chronology-relevance ${tone}`}>{entry.relevance}</span>
              <div className="chronology-source">
                {sourceFragmentsForListOfDates(entry.source).map((fragment) => (
                  <span key={fragment}>{lawyerFacingListOfDatesSourceFragment(fragment)}</span>
                ))}
              </div>
            </article>
          );
        })}
      </section>
      <div className="chronology-summary">
        <span>{parsed.entries.length} {parsed.entries.length === 1 ? 'entry' : 'entries'}</span>
        <span>{parsed.sourceCount} {parsed.sourceCount === 1 ? 'source' : 'sources'} cited</span>
        <span>{parsed.dateRange || 'No date range'}</span>
      </div>
    </>
  );
}

function readStoredAssistantWidth(): number {
  try {
    const raw = window.localStorage.getItem(ASSISTANT_WIDTH_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return clampAssistantWidth(parsed);
  } catch {
    // Browser-local preference only.
  }
  return clampAssistantWidth(DEFAULT_ASSISTANT_WIDTH);
}

function clampAssistantWidth(value: number): number {
  const viewportMax = typeof window === 'undefined'
    ? MAX_ASSISTANT_WIDTH
    : Math.max(MIN_ASSISTANT_WIDTH, Math.min(MAX_ASSISTANT_WIDTH, Math.floor(window.innerWidth * 0.48)));
  return Math.max(MIN_ASSISTANT_WIDTH, Math.min(viewportMax, Math.round(value || DEFAULT_ASSISTANT_WIDTH)));
}

export default function MainContent({
  onNewMatter,
  onMatterCreated,
  onViewAllMatters,
  onOpenMatter,
  onAddFilesDone,
  onCommand,
  onRunPreparationAgain,
  onLogout,
  commandPanel,
}: Props) {
  const { state } = useApp();
  const { activeView } = state;
  const showOperatorChrome = canSeeOperatorSurface(state.authEnabled, state.authUser);

  const filePreview = state.filePreview;
  const [assistantWidth, setAssistantWidth] = useState(readStoredAssistantWidth);

  useEffect(() => {
    setAssistantWidth((width) => clampAssistantWidth(width));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ASSISTANT_WIDTH_STORAGE_KEY, String(assistantWidth));
    } catch {
      // Browser-local preference only.
    }
  }, [assistantWidth]);

  useEffect(() => {
    function handleResize() {
      setAssistantWidth((width) => clampAssistantWidth(width));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const startAssistantResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = assistantWidth;
    function handlePointerMove(moveEvent: PointerEvent) {
      setAssistantWidth(clampAssistantWidth(startWidth + startX - moveEvent.clientX));
    }
    function stopResize() {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      document.body.classList.remove('assistant-resizing');
    }
    document.body.classList.add('assistant-resizing');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
  }, [assistantWidth]);

  const resetAssistantWidth = useCallback(() => {
    setAssistantWidth(clampAssistantWidth(DEFAULT_ASSISTANT_WIDTH));
  }, []);

  const editorLayoutStyle = {
    '--assistant-width': `${assistantWidth}px`,
  } as CSSProperties;

  function renderMainView() {
    if (activeView === 'new-matter') {
      return <NewMatterForm onCancel={onViewAllMatters} onCreated={onMatterCreated} />;
    }
    if (activeView === 'add-files') {
      return <AddFilesForm onCancel={onViewAllMatters} onDone={onAddFilesDone} />;
    }
    if (activeView === 'file-preview' && filePreview) {
      return <FilePreview preview={filePreview} />;
    }
    if (activeView === 'extract') return <ExtractResult />;
    if (activeView === 'doctor') return <DoctorResult />;
    if (activeView === 'context-search') return <ContextSearch />;
    if (activeView === 'list-of-dates') return <ListOfDatesResult />;
    if (activeView === 'prepare-matter') return <PrepareMatterResult />;
    if (activeView === 'describe-sources') return <DescribeSourcesResult />;
    if (activeView === 'context-preview') return <ContextPreview />;

    switch (state.activeTab) {
      case 'skills': return <SkillsPage onCommand={onCommand} />;
      case 'activity': return <ActivityPage />;
      case 'settings': return showOperatorChrome ? <SettingsPage /> : (
        <HomeLanding
          onNewMatter={onNewMatter}
          onOpenMatter={onOpenMatter}
          onViewAllMatters={onViewAllMatters}
          onCommand={onCommand}
          onRunPreparationAgain={onRunPreparationAgain}
          showMatterBrowser={activeView === 'find-matter'}
        />
      );
      default:
        return (
          <HomeLanding
            onNewMatter={onNewMatter}
            onOpenMatter={onOpenMatter}
            onViewAllMatters={onViewAllMatters}
            onCommand={onCommand}
            onRunPreparationAgain={onRunPreparationAgain}
            showMatterBrowser={activeView === 'find-matter'}
          />
        );
    }
  }

  return (
    <main className="main-panel">
      <section className="editor-layout" style={editorLayoutStyle}>
        <div className="editor-pane">
          <TitleBar onLogout={onLogout} />
          {activeView !== 'file-preview' && (
            <div className="editor-toolbar">
              <div className="breadcrumbs">{state.breadcrumbs}</div>
            </div>
          )}

          <article className="editor-content">
            {renderMainView()}
          </article>
        </div>

        <div className="assistant-rail">
          <div
            className="assistant-rail-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Matter Assistant"
            title="Drag to resize Matter Assistant. Double-click to reset."
            onPointerDown={startAssistantResize}
            onDoubleClick={resetAssistantWidth}
          />
          {commandPanel}
        </div>
      </section>

      <StatusBar />
    </main>
  );
}

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
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
import { getErrorMessage } from '../../lib/errors';
import { canSeeOperatorSurface } from '../../lib/lawyerMode';
import type { SourceRemovalImpactPreview } from '../../types';

const MarkdownViewer = lazy(() => import('../common/MarkdownViewer').then((module) => ({ default: module.MarkdownViewer })));

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
  onRunNeededPreparation: (matterName: string, startStage?: string) => void;
  onForceFullPreparation: (matterName: string, reason: string) => void;
  commandPanel: React.ReactNode;
}

function FilePreview({ preview }: { preview: { path: string; type: string; url?: string; content?: string; ext?: string } }) {
  const { state, dispatch, appendTerminal, refreshActiveMatterWorkspace } = useApp();
  const filename = preview.path.split('/').pop() ?? preview.path;
  const isListOfDatesMarkdown = preview.type === 'text' && isListOfDatesMarkdownPath(preview.path);
  const isGenericMarkdown = preview.type === 'text' && /\.md$/i.test(preview.path) && !isListOfDatesMarkdown;
  const listOfDates = isListOfDatesMarkdown ? parseListOfDatesMarkdown(preview.content || '') : null;
  const showOperatorChrome = canSeeOperatorSurface(state.authEnabled, state.authUser);
  const sourceFileId = sourceFileIdForPreviewPath(preview.path);
  const [removalOpen, setRemovalOpen] = useState(false);
  const [removalReason, setRemovalReason] = useState('');
  const [removalImpact, setRemovalImpact] = useState<SourceRemovalImpactPreview | null>(null);
  const [removalLoading, setRemovalLoading] = useState(false);
  const [removalError, setRemovalError] = useState('');

  async function copyMarkdown() {
    await writeClipboardText(preview.content || '');
  }

  async function openRemovalPanel() {
    if (!sourceFileId) return;
    setRemovalOpen(true);
    setRemovalError('');
    setRemovalLoading(true);
    try {
      const impact = await api.getSourceRemovalImpactPreview(sourceFileId, state.activeMatter?.name);
      setRemovalImpact(impact);
    } catch (error) {
      setRemovalError(getErrorMessage(error));
    } finally {
      setRemovalLoading(false);
    }
  }

  async function confirmSourceRemoval() {
    if (!sourceFileId || !removalReason.trim()) return;
    const matterName = state.activeMatter?.name;
    setRemovalLoading(true);
    setRemovalError('');
    try {
      const result = await api.removeSourceFromActiveRecord({
        matterName,
        fileId: sourceFileId,
        reason: removalReason.trim(),
        idempotencyKey: sourceRemovalIdempotencyKey(matterName || 'matter', sourceFileId),
      });
      appendTerminal([
        `[source-removal] ${sourceFileId} ${result.state || 'updated'} — source bytes and history were preserved`,
      ]);
      setRemovalOpen(false);
      setRemovalReason('');
      setRemovalImpact(null);
      dispatch({ type: 'SET_FILE_PREVIEW', payload: null });
      dispatch({ type: 'SET_ACTIVE_FILE', payload: null });
      dispatch({ type: 'SET_VIEW', payload: 'home' });
      await refreshActiveMatterWorkspace({
        reason: '[source-removal] refreshing active matter…',
        successMessage: '[source-removal] active source record updated',
        expectedMatterName: matterName,
      });
    } catch (error) {
      setRemovalError(getErrorMessage(error));
    } finally {
      setRemovalLoading(false);
    }
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
        {sourceFileId && (
          <div className="document-actions">
            <button type="button" className="run-skill-button secondary danger" onClick={() => { void openRemovalPanel(); }}>
              Remove from active record
            </button>
          </div>
        )}
      </div>
      {removalOpen && sourceFileId && (
        <section className="source-removal-panel" aria-label="Remove source from active record">
          <strong>Remove {sourceFileId} from the active record?</strong>
          <p>
            This is non-destructive. Source bytes, extracted text, file IDs, and history are preserved;
            future source-backed work will stop treating this file as active.
          </p>
          {removalLoading && <p className="source-removal-note">Checking impact…</p>}
          {removalImpact && (
            <div className="source-removal-impact">
              <span>{removalImpact.active_context?.evidence_blocks || 0} active evidence block{(removalImpact.active_context?.evidence_blocks || 0) === 1 ? '' : 's'} reference this source.</span>
              {(removalImpact.affected_artifacts || []).length > 0 && (
                <ul>
                  {(removalImpact.affected_artifacts || []).map((artifact, index) => (
                    <li key={`${artifact.family || 'artifact'}-${index}`}>
                      {humanizeSourceRemovalFamily(artifact.family)}: {humanizeSourceRemovalFamily(artifact.effect)}
                    </li>
                  ))}
                </ul>
              )}
              {(removalImpact.warnings || []).length > 0 && (
                <ul>
                  {(removalImpact.warnings || []).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <label className="source-removal-reason">
            <span>Reason required</span>
            <textarea
              value={removalReason}
              onChange={(event) => setRemovalReason(event.target.value.slice(0, 500))}
              placeholder="e.g. Wrong client file uploaded to this matter."
              maxLength={500}
            />
          </label>
          {removalError && <div className="form-error">{removalError}</div>}
          <div className="source-removal-actions">
            <button type="button" className="run-skill-button secondary" disabled={removalLoading} onClick={() => { setRemovalOpen(false); setRemovalError(''); }}>
              Cancel
            </button>
            <button type="button" className="run-skill-button danger" disabled={removalLoading || !removalReason.trim() || Boolean(removalError && !removalImpact)} onClick={() => { void confirmSourceRemoval(); }}>
              Confirm removal
            </button>
          </div>
        </section>
      )}
      {preview.type === 'pdf' && preview.url && (
        <iframe className="file-pdf-frame" src={preview.url} title={filename} />
      )}
      {preview.type === 'image' && preview.url && (
        <img className="file-image" src={preview.url} alt={filename} />
      )}
      {listOfDates && listOfDates.entries.length > 0 && (
        <ListOfDatesMarkdownPreview parsed={listOfDates} />
      )}
      {isGenericMarkdown && (
        <Suspense fallback={<p className="muted">Rendering Markdown preview…</p>}>
          <MarkdownViewer content={preview.content || ''} ariaLabel="Markdown preview" />
        </Suspense>
      )}
      {preview.type === 'text' && !isGenericMarkdown && (!listOfDates || listOfDates.entries.length === 0) && (
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
      <section className="chronology-table" aria-label="Case Timeline chronology">
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

function sourceFileIdForPreviewPath(path = ''): string {
  return path.match(/(?:^|[/_\s-])(FILE-\d{4,})(?:\b|__|\.)/i)?.[1]?.toUpperCase() || '';
}

function sourceRemovalIdempotencyKey(matterName: string, fileId: string): string {
  const safeMatter = String(matterName || 'matter').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'matter';
  return `source-removal:${safeMatter}:${fileId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function humanizeSourceRemovalFamily(value = ''): string {
  const text = String(value || '').replace(/_/g, ' ').trim();
  return text ? text.replace(/^./, (char) => char.toUpperCase()) : 'Artifact';
}

export default function MainContent({
  onNewMatter,
  onMatterCreated,
  onViewAllMatters,
  onOpenMatter,
  onAddFilesDone,
  onCommand,
  onRunNeededPreparation,
  onForceFullPreparation,
  commandPanel,
}: Props) {
  const { state, dispatch } = useApp();
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
    if (!state.toast) return undefined;
    const toastId = state.toast.id;
    const timeout = window.setTimeout(() => {
      dispatch({ type: 'DISMISS_TOAST', payload: toastId });
    }, 5200);
    return () => window.clearTimeout(timeout);
  }, [dispatch, state.toast]);

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
          onRunNeededPreparation={onRunNeededPreparation}
          onForceFullPreparation={onForceFullPreparation}
          showMatterBrowser={activeView === 'find-matter'}
        />
      );
      default:
        return (
          <HomeLanding
            onNewMatter={onNewMatter}
            onOpenMatter={onOpenMatter}
            onViewAllMatters={onViewAllMatters}
            onRunNeededPreparation={onRunNeededPreparation}
            onForceFullPreparation={onForceFullPreparation}
            showMatterBrowser={activeView === 'find-matter'}
          />
        );
    }
  }

  return (
    <main className="main-panel">
      <section className="editor-layout" style={editorLayoutStyle}>
        <div className="editor-pane">
          <TitleBar />
          {activeView !== 'file-preview' && (
            <div className="editor-toolbar">
              <div className="breadcrumbs">{state.breadcrumbs}</div>
            </div>
          )}

          <article className="editor-content">
            {renderMainView()}
          </article>
        </div>

        {state.toast && (
          <AppToast
            toast={state.toast}
            onDismiss={() => dispatch({ type: 'DISMISS_TOAST', payload: state.toast?.id })}
          />
        )}

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

function AppToast({
  toast,
  onDismiss,
}: {
  toast: NonNullable<ReturnType<typeof useApp>['state']['toast']>;
  onDismiss: () => void;
}) {
  return (
    <div className={`app-toast ${toast.tone}`} role="status" aria-live="polite">
      <div className="app-toast-copy">
        <strong>{toast.title}</strong>
        {toast.message && <p>{toast.message}</p>}
      </div>
      <button type="button" className="app-toast-close" aria-label="Dismiss" onClick={onDismiss}>×</button>
    </div>
  );
}

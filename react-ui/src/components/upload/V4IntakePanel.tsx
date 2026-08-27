import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { getErrorMessage } from '../../lib/errors';
import type { CollectedUploadFile } from '../../lib/uploadFileCollection';
import {
  commitV4BatchCustody,
  commitV4FileCustody,
  createV4Intake,
  getV4Intake,
  getV4Progress,
  newV4IdempotencyKey,
  probeV4IntakeStatus,
  putV4StagedFile,
  v4MatterIdFromName,
  type V4MountStatus,
  type V4Progress,
} from '../../api/v4Intake';

// Flag-gated V4 extraction panel. Renders nothing unless the server's V4
// intake mount answers the status probe, so default deployments and default
// local runs never show it. When live, it runs the selected PDFs through the
// V4 upload → OCR pipeline and shows what the legacy flow never could: real
// byte-level upload progress, then a live page-completion ratio with an ETA
// band while extraction runs.
//
// Slice boundary (deliberate): results stay in the V4 evidence store. Nothing
// here writes into the matter workspace — the cutover that feeds V4 results
// into legacy document records is a separate, gated step.

interface Props {
  matterName: string | null;
  files: CollectedUploadFile[];
  busy: boolean;
}

type Phase = 'idle' | 'starting' | 'uploading' | 'finalizing' | 'processing' | 'ready' | 'failed';

interface FileRunState {
  name: string;
  bytes: number;
  pct: number;
  phase: 'queued' | 'uploading' | 'committing' | 'done' | 'failed';
}

interface RunHandle {
  cancelled: boolean;
  abort: AbortController;
}

const UPLOAD_CONCURRENCY = 4;
const POLL_INTERVAL_MS = 1000;
const POLL_FAILURE_TOLERANCE = 5;
const POLL_DEADLINE_MS = 60 * 60 * 1000;

export function V4IntakePanel({ matterName, files, busy }: Props) {
  const { appendTerminal } = useApp();
  const [mountStatus, setMountStatus] = useState<V4MountStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [fileStates, setFileStates] = useState<FileRunState[]>([]);
  const [progress, setProgress] = useState<V4Progress | null>(null);
  const [pollWarning, setPollWarning] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const runRef = useRef<RunHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    probeV4IntakeStatus().then((status) => {
      if (!cancelled) setMountStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Abandon any in-flight run when the panel unmounts (view switch, matter
  // switch). The server side is unharmed: an uncommitted intake simply ages
  // out with its upload authorizations.
  useEffect(() => {
    return () => {
      if (runRef.current) {
        runRef.current.cancelled = true;
        runRef.current.abort.abort();
        runRef.current = null;
      }
    };
  }, []);

  if (!mountStatus) return null;
  // Narrowed alias: closures below (handleStart) cannot rely on the narrowing
  // of the state variable itself.
  const mount = mountStatus;

  const pdfFiles = files.filter(isPdfCandidate);
  const skippedCount = files.length - pdfFiles.length;
  const totalBytes = pdfFiles.reduce((sum, item) => sum + item.file.size, 0);
  const running = phase === 'starting' || phase === 'uploading' || phase === 'finalizing' || phase === 'processing';

  const preflightProblem = (() => {
    if (!matterName) return 'No active matter.';
    if (pdfFiles.length === 0) return 'Select at least one PDF — this pipeline extracts PDFs.';
    if (pdfFiles.length > mount.limits.maximumFiles) {
      return `Too many PDFs for one extraction (limit ${mount.limits.maximumFiles}).`;
    }
    if (pdfFiles.some((item) => item.file.size > mount.limits.maximumFileBytes)) {
      return `A selected PDF exceeds the per-file limit of ${formatSize(mount.limits.maximumFileBytes)}.`;
    }
    if (totalBytes > mount.limits.maximumIntakeBytes) {
      return `The selection exceeds the ${formatSize(mount.limits.maximumIntakeBytes)} batch limit.`;
    }
    if (!mount.started) return 'The V4 extraction engine is still starting — try again in a moment.';
    return '';
  })();

  async function handleStart() {
    if (running || busy || preflightProblem || !matterName) return;
    const run: RunHandle = { cancelled: false, abort: new AbortController() };
    runRef.current = run;
    const startedAtMs = Date.now();
    const selection = pdfFiles.slice();
    setError('');
    setSummary('');
    setPollWarning('');
    setProgress(null);
    setFileStates(selection.map((item) => ({
      name: item.relativePath,
      bytes: item.file.size,
      pct: 0,
      phase: 'queued',
    })));
    setPhase('starting');
    appendTerminal([`[v4-intake] starting fast extraction of ${selection.length} PDF(s) (${formatSize(selection.reduce((sum, item) => sum + item.file.size, 0))})…`]);

    try {
      const intake = await createV4Intake({
        matterId: v4MatterIdFromName(matterName),
        idempotencyKey: newV4IdempotencyKey(),
        files: selection.map((item, index) => ({
          clientFileId: `client-${index + 1}`,
          originalName: fileBaseName(item.relativePath),
          relativePath: item.relativePath,
          mimeType: item.file.type || 'application/pdf',
          expectedBytes: item.file.size,
          lastModifiedMs: item.file.lastModified,
        })),
      });
      if (run.cancelled) return;
      if (intake.files.length !== selection.length) {
        throw new Error('The V4 intake did not authorize every selected file.');
      }

      setPhase('uploading');
      await runWithConcurrency(selection, UPLOAD_CONCURRENCY, async (item, index) => {
        if (run.cancelled) return;
        const authorized = intake.files[index];
        const authorization = authorized.uploadAuthorization;
        if (!authorization) throw new Error(`No upload authorization for ${item.relativePath}.`);
        updateFileState(index, { phase: 'uploading', pct: 0 });
        await putV4StagedFile({
          authorization,
          uploadTokenHeader: mount.uploadTokenHeader,
          file: item.file,
          signal: run.abort.signal,
          onProgress: (loaded, total) => {
            updateFileState(index, { phase: 'uploading', pct: total > 0 ? Math.floor((loaded / total) * 100) : 0 });
          },
        });
        if (run.cancelled) return;
        // Commit custody the moment this file's bytes land: inspection and
        // page fan-out start server-side while later files are still uploading.
        updateFileState(index, { phase: 'committing', pct: 100 });
        await commitV4FileCustody({
          intakeId: intake.intakeId,
          fileId: authorized.fileId,
          uploadToken: authorization.token,
        });
        updateFileState(index, { phase: 'done', pct: 100 });
      });
      if (run.cancelled) return;

      setPhase('finalizing');
      await commitV4BatchCustody({ intakeId: intake.intakeId });
      if (run.cancelled) return;
      appendTerminal(['[v4-intake] all files in custody; extraction is running…']);

      setPhase('processing');
      const finalProgress = await pollUntilTerminal(intake.intakeId, run, setProgress, setPollWarning);
      if (run.cancelled) return;

      const finished = await getV4Intake({ intakeId: intake.intakeId }).catch(() => null);
      if (run.cancelled) return;
      const pages = finalProgress?.processing.observedLogicalPages ?? 0;
      const seconds = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000));
      const reviewNote = finalProgress?.status === 'ready_with_review' ? ' Some pages need review.' : '';
      setSummary(
        `Extracted ${pages} page(s) in ${formatDuration(seconds)}.${reviewNote}`
        + (finished?.resultId ? ` Result ${finished.resultId} is in the V4 evidence store (not yet wired into this matter's workspace).` : ''),
      );
      setPhase('ready');
      appendTerminal([`[v4-intake] extraction complete: ${pages} page(s) in ${formatDuration(seconds)}${reviewNote ? ' (review flagged)' : ''}`]);
    } catch (raised) {
      if (run.cancelled) return;
      run.abort.abort();
      const message = getErrorMessage(raised);
      setError(message);
      setPhase('failed');
      appendTerminal([`[v4-intake] error: ${message}`]);
    } finally {
      if (runRef.current === run) runRef.current = null;
    }
  }

  function handleCancel() {
    const run = runRef.current;
    if (run) {
      run.cancelled = true;
      run.abort.abort();
      runRef.current = null;
    }
    setPhase('idle');
    setProgress(null);
    setPollWarning('');
    appendTerminal(['[v4-intake] extraction cancelled']);
  }

  function handleReset() {
    setPhase('idle');
    setProgress(null);
    setSummary('');
    setError('');
    setPollWarning('');
    setFileStates([]);
  }

  function updateFileState(index: number, patch: Partial<FileRunState>) {
    setFileStates((prev) => {
      const current = prev[index];
      if (!current) return prev;
      if (patch.pct !== undefined && current.pct === patch.pct && current.phase === (patch.phase ?? current.phase)) {
        return prev;
      }
      const next = prev.slice();
      next[index] = { ...current, ...patch };
      return next;
    });
  }

  const uploadedBytes = fileStates.reduce((sum, item) => sum + (item.bytes * item.pct) / 100, 0);
  const uploadTotalBytes = fileStates.reduce((sum, item) => sum + item.bytes, 0);
  const doneFiles = fileStates.filter((item) => item.phase === 'done').length;
  const completionRatio = progress?.processing.completionRatio ?? 0;

  return (
    <div className="v4-intake-panel">
      <div className="v4-intake-head">
        <div>
          <h2>Fast extraction (V4)</h2>
          <p>
            New upload-to-OCR pipeline: page-level parallel extraction with live progress.
            Runs alongside the normal upload; extracted text stays in the V4 store for now.
          </p>
        </div>
        <span className="v4-intake-chip" title={`Provider ladder: ${mount.label}`}>{mount.label || 'v4'}</span>
      </div>

      {phase === 'idle' && (
        <div className="v4-intake-body">
          <div className="v4-intake-hint">
            {pdfFiles.length > 0
              ? `${pdfFiles.length} PDF(s) · ${formatSize(totalBytes)} ready for fast extraction.`
              : 'Drop PDFs above to try fast extraction.'}
            {skippedCount > 0 ? ` ${skippedCount} non-PDF file(s) will be skipped.` : ''}
          </div>
          {preflightProblem && pdfFiles.length > 0 && <div className="v4-intake-hint v4-intake-problem">{preflightProblem}</div>}
          <div className="form-actions" style={{ marginTop: 10 }}>
            <button type="button" disabled={busy || Boolean(preflightProblem)} onClick={() => void handleStart()}>
              Extract {pdfFiles.length > 0 ? `${pdfFiles.length} PDF${pdfFiles.length !== 1 ? 's' : ''}` : 'PDFs'} with V4
            </button>
          </div>
        </div>
      )}

      {(phase === 'starting' || phase === 'uploading' || phase === 'finalizing') && (
        <div className="v4-intake-body">
          <div className="v4-intake-stage">
            {phase === 'starting' && 'Requesting upload authorizations…'}
            {phase === 'uploading' && `Uploading ${doneFiles}/${fileStates.length} file(s) · ${formatSize(uploadedBytes)} of ${formatSize(uploadTotalBytes)}`}
            {phase === 'finalizing' && 'Sealing custody and queueing pages…'}
          </div>
          <ProgressBar ratio={uploadTotalBytes > 0 ? uploadedBytes / uploadTotalBytes : 0} />
          <div className="v4-intake-files">
            {fileStates.slice(0, 8).map((item, index) => (
              <div key={index} className="v4-intake-file">
                <span className="v4-intake-file-name">{item.name}</span>
                <span className="v4-intake-file-state">{describeFilePhase(item)}</span>
              </div>
            ))}
            {fileStates.length > 8 && (
              <div className="v4-intake-file" style={{ color: 'var(--muted)' }}>
                +{fileStates.length - 8} more
              </div>
            )}
          </div>
          <div className="form-actions" style={{ marginTop: 10 }}>
            <button type="button" className="secondary" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      )}

      {phase === 'processing' && (
        <div className="v4-intake-body">
          <div className="v4-intake-stage">
            Reading pages… {progress ? `${Math.round(completionRatio * 100)}%` : 'starting'}
            {progress && progress.processing.observedLogicalPages > 0
              ? ` · ${progress.processing.observedLogicalPages} page(s)`
              : ''}
            {formatEtaSuffix(progress)}
          </div>
          <ProgressBar ratio={completionRatio} />
          {progress?.exception.active && (
            <div className="v4-intake-hint v4-intake-problem">
              Taking longer than promised ({progress.exception.reasons.join(', ')}). Extraction continues.
            </div>
          )}
          {pollWarning && <div className="v4-intake-hint v4-intake-problem">{pollWarning}</div>}
          <div className="form-actions" style={{ marginTop: 10 }}>
            <button type="button" className="secondary" onClick={handleCancel}>Stop watching</button>
          </div>
        </div>
      )}

      {phase === 'ready' && (
        <div className="v4-intake-body">
          <div className="v4-intake-stage v4-intake-success">{summary}</div>
          <ProgressBar ratio={1} />
          <div className="form-actions" style={{ marginTop: 10 }}>
            <button type="button" className="secondary" onClick={handleReset}>Run again</button>
          </div>
        </div>
      )}

      {phase === 'failed' && (
        <div className="v4-intake-body">
          <div className="form-error" style={{ marginTop: 0 }}>{error}</div>
          <div className="form-actions" style={{ marginTop: 10 }}>
            <button type="button" className="secondary" onClick={handleReset}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ ratio }: { ratio: number }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return (
    <div className="v4-intake-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
      <div className="v4-intake-bar-fill" style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}

async function pollUntilTerminal(
  intakeId: string,
  run: RunHandle,
  onProgress: (progress: V4Progress) => void,
  onWarning: (message: string) => void,
): Promise<V4Progress | null> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  let consecutiveFailures = 0;
  let latest: V4Progress | null = null;
  while (!run.cancelled && Date.now() < deadline) {
    try {
      latest = await getV4Progress({ intakeId });
      consecutiveFailures = 0;
      onWarning('');
      if (run.cancelled) return latest;
      onProgress(latest);
      if (latest.status === 'ready' || latest.status === 'ready_with_review') return latest;
    } catch (raised) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= POLL_FAILURE_TOLERANCE) throw raised;
      onWarning('Progress updates are interrupted; retrying…');
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (!run.cancelled) {
    throw new Error('Extraction is still running after an hour; check the V4 dashboard for this intake.');
  }
  return latest;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let failure: unknown = null;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (failure === null) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
      } catch (raised) {
        failure = raised ?? new Error('upload failed');
        return;
      }
    }
  });
  await Promise.all(lanes);
  if (failure !== null) throw failure;
}

function isPdfCandidate(item: CollectedUploadFile): boolean {
  return item.file.type === 'application/pdf' || /\.pdf$/i.test(item.relativePath);
}

function describeFilePhase(item: FileRunState): string {
  if (item.phase === 'queued') return 'queued';
  if (item.phase === 'uploading') return `${item.pct}%`;
  if (item.phase === 'committing') return 'sealing…';
  if (item.phase === 'failed') return 'failed';
  return 'done';
}

function formatEtaSuffix(progress: V4Progress | null): string {
  if (!progress) return '';
  const { lowerSeconds, upperSeconds, sloState } = progress.processing.eta;
  if (sloState === 'complete') return '';
  if (typeof lowerSeconds !== 'number' || typeof upperSeconds !== 'number' || upperSeconds <= 0) return '';
  return ` · about ${formatDuration(Math.max(1, lowerSeconds))}–${formatDuration(Math.max(1, upperSeconds))} left`;
}

function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${minutes >= 10 ? Math.round(minutes) : Math.round(minutes * 10) / 10} min`;
  return `${Math.round(minutes / 6) / 10} h`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileBaseName(relativePath: string): string {
  const segments = relativePath.split('/');
  return segments[segments.length - 1] || relativePath;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

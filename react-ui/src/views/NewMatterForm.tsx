import { useEffect, useState, useRef } from 'react';
import { isMatterSwitchSupersededError, useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import {
  collectDroppedEntries,
  collectFilesFromFileList,
  findDuplicateRelativePath,
  getDroppedFileSystemEntries,
  type CollectedUploadFile,
} from '../lib/uploadFileCollection';
import { assessUploadBatchSize, describeUploadBatchLimit } from '../lib/uploadBatchPreflight';
import { browserFileHashSkipReason, hashFilesSha256IfAvailable } from '../lib/browserFileHash';
import { reportUploadPrecheckSkippedLargeBatch, reportUploadPrecheckUnavailable, reportUploadSubmitFailure } from '../lib/uploadClientTelemetry';
import { UploadSessionRecoveryCard } from '../components/upload/UploadSessionRecoveryCard';
import {
  cancelUploadSessionDraft,
  createMatterWithUploadSession,
  findLatestUploadSessionDraft,
  findMatchingUploadSessionDraft,
  type StoredUploadSessionDraft,
} from '../lib/uploadSessions';
import type { OverlapWarning } from '../types';

interface Props {
  onCancel: () => void;
  onCreated: (name: string, opts?: { autoPrepare?: boolean }) => void;
}

export default function NewMatterForm({ onCancel, onCreated }: Props) {
  const { state, switchActiveMatter, appendTerminal } = useApp();
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [matterType, setMatterType] = useState('');
  const [oppositeParty, setOppositeParty] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [briefDescription, setBriefDescription] = useState('');
  const [files, setFiles] = useState<CollectedUploadFile[]>([]);
  const [dragover, setDragover] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [recoverableUpload, setRecoverableUpload] = useState<StoredUploadSessionDraft | null>(null);
  const [overlapWarnings, setOverlapWarnings] = useState<OverlapWarning[]>([]);
  const [bypassOverlap, setBypassOverlap] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const runtimeUploadSessionsEnabled = state.config?.runtimeStorageMode === 'postgres';

  useEffect(() => {
    if (!runtimeUploadSessionsEnabled) {
      setRecoverableUpload(null);
      return;
    }
    setRecoverableUpload(findLatestUploadSessionDraft({ action: 'create_matter', matterName: name.trim() || undefined }));
  }, [runtimeUploadSessionsEnabled, name]);

  function addFiles(nextFiles: CollectedUploadFile[]) {
    if (nextFiles.length > 0) {
      setFiles((prev) => [...prev, ...nextFiles]);
    }
    setOverlapWarnings([]);
    setBypassOverlap(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragover(false);
    const entries = getDroppedFileSystemEntries(e.dataTransfer);
    if (entries.length > 0) {
      collectDroppedEntries(entries)
        .then(addFiles)
        .catch((err) => setError(getErrorMessage(err)));
    } else {
      addFiles(collectFilesFromFileList(e.dataTransfer.files));
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const selectedFiles = collectFilesFromFileList(Array.from(input.files ?? []));
    if (selectedFiles.length > 0) {
      addFiles(selectedFiles);
    }
    window.setTimeout(() => {
      input.value = '';
    }, 0);
  }

  function handleContinueWithOverlap() {
    setBypassOverlap(true);
    setOverlapWarnings([]);
  }

  function handleUseRecoverableUpload() {
    if (!recoverableUpload) return;
    setName(recoverableUpload.matterName || '');
    setClientName(recoverableUpload.metadata?.clientName || '');
    setMatterType(recoverableUpload.metadata?.matterType || '');
    setOppositeParty(recoverableUpload.metadata?.oppositeParty || '');
    setJurisdiction(recoverableUpload.metadata?.jurisdiction || '');
    setBriefDescription(recoverableUpload.metadata?.briefDescription || '');
    setError('Re-select the same files, then submit to resume the unfinished upload.');
  }

  async function handleForgetRecoverableUpload() {
    if (!recoverableUpload) return;
    await cancelUploadSessionDraft(recoverableUpload);
    setRecoverableUpload(null);
    setError('');
  }

  async function handleOpenExistingMatter(matterName: string) {
    setSubmitting(true);
    setError('');
    try {
      await switchActiveMatter(matterName);
      onCancel();
    } catch (err) {
      if (isMatterSwitchSupersededError(err)) return;
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) { setError('Matter name is required.'); return; }
    if (files.length === 0) { setError('Attach at least one source file.'); return; }
    const duplicatePath = findDuplicateRelativePath(files);
    if (duplicatePath) {
      setError(`Multiple selected files would upload as "${duplicatePath}". Use Browse folder to preserve folders, or rename/remove duplicates before uploading.`);
      return;
    }
    const sizeCheck = assessUploadBatchSize(files, state.config?.maxUploadBytes, state.config?.maxUploadFiles);
    if (!sizeCheck.ok) {
      setError(sizeCheck.message);
      return;
    }
    setSubmitting(true);
    setError('');
    setProgressMessage('Checking selected files before upload…');
    try {
      if (!bypassOverlap) {
        setProgressMessage(`Checking ${files.length} file(s) for duplicate matter overlap…`);
        appendTerminal([`[new-matter] checking ${files.length} file(s) for duplicate matter overlap…`]);
        const selectedFiles = files.map((f) => f.file);
        const hashSkipReason = browserFileHashSkipReason(selectedFiles);
        const hashes = await hashFilesSha256IfAvailable(selectedFiles);
        if (!hashes) {
          const telemetryInput = {
            files,
            matterName: cleanName,
            view: 'new_matter' as const,
            action: 'create_matter' as const,
          };
          if (hashSkipReason === 'selection_too_large') {
            reportUploadPrecheckSkippedLargeBatch(telemetryInput);
            appendTerminal(['[new-matter] Large batch selected. Duplicate precheck was skipped to keep the browser responsive; upload is continuing normally.']);
          } else {
            reportUploadPrecheckUnavailable(telemetryInput);
            appendTerminal(['[new-matter] Browser duplicate precheck could not run; upload is continuing normally without a duplicate warning.']);
          }
        } else {
          const checkResult = await api.checkOverlap({ hashes, proposedName: cleanName });
          const warnings = checkResult.warnings ?? [];
          if (warnings.length > 0) {
            setOverlapWarnings(warnings);
            setSubmitting(false);
            return;
          }
        }
      }

      const metadata: Record<string, string> = { matterName: cleanName };
      if (clientName) metadata.clientName = clientName;
      if (matterType) metadata.matterType = matterType;
      if (oppositeParty) metadata.oppositeParty = oppositeParty;
      if (jurisdiction) metadata.jurisdiction = jurisdiction;
      if (briefDescription) metadata.briefDescription = briefDescription;

      setProgressMessage(state.config?.runtimeStorageMode === 'postgres'
        ? `Creating upload session for ${files.length} file(s)…`
        : `Uploading ${files.length} file(s) and creating the matter. Keep this page open; large folders can take a few minutes.`);
      appendTerminal([state.config?.runtimeStorageMode === 'postgres'
        ? `[new-matter] creating durable upload session for "${cleanName}"…`
        : `[new-matter] creating "${cleanName}"…`]);

      const resumeDraft = findMatchingUploadSessionDraft({ action: 'create_matter', matterName: cleanName, files });
      if (resumeDraft) {
        appendTerminal([`[new-matter] resuming durable upload session ${resumeDraft.sessionId} for "${cleanName}"…`]);
      }
      const created = state.config?.runtimeStorageMode === 'postgres'
        ? await createMatterWithUploadSession({
            name: cleanName,
            metadata,
            files,
            resumeDraft,
            onProgress: ({ uploadedFiles, totalFiles, currentPath, resumed }) => {
              const prefix = resumed ? 'Resumed upload' : 'Uploaded';
              setProgressMessage(`${prefix} ${uploadedFiles}/${totalFiles} file(s). Latest: ${currentPath || 'file'}`);
              appendTerminal([`[new-matter] ${resumed ? 'resumed' : 'uploaded'} ${uploadedFiles}/${totalFiles}: ${currentPath || 'file'}`]);
            },
          })
        : await createMatterWithLegacyMultipart({ cleanName, metadata, files });
      const createdName = created.folderName || cleanName;
      appendTerminal([
        `[new-matter] upload complete: "${createdName}" created with ${created.fileCount || files.length} source file(s)`,
        '[new-matter] automatic preparation is starting; follow progress in Activity',
      ]);
      await switchActiveMatter(createdName, {
        startMessage: false,
        successMessage: false,
        failureMessage: (err) => `[new-matter] switch error: ${getErrorMessage(err)}`,
      });
      onCreated(createdName, { autoPrepare: true });
    } catch (err) {
      if (isMatterSwitchSupersededError(err)) return;
      reportUploadSubmitFailure({
        files,
        matterName: cleanName,
        view: 'new_matter',
        action: 'create_matter',
        error: err,
      });
      setError(getErrorMessage(err));
      appendTerminal([`[new-matter] error: ${getErrorMessage(err)}`]);
    } finally {
      setSubmitting(false);
      setProgressMessage('');
    }
  }

  async function createMatterWithLegacyMultipart({
    cleanName,
    metadata,
    files,
  }: {
    cleanName: string;
    metadata: Record<string, string>;
    files: CollectedUploadFile[];
  }) {
    const fd = new FormData();
    fd.append('name', cleanName);
    fd.append('metadata', JSON.stringify(metadata));
    fd.append('paths', JSON.stringify(files.map((f) => f.relativePath)));
    files.forEach((f) => fd.append('files', f.file, f.relativePath));
    return api.newMatter(fd);
  }

  const totalSize = files.reduce((sum, item) => sum + item.file.size, 0);
  const uploadLimitCopy = describeUploadBatchLimit(state.config?.maxUploadBytes, state.config?.maxUploadFiles);

  return (
    <div className="matter-intake-shell">
      <div className="matter-intake-hero">
        <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          New Matter
        </div>
        <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 30, fontWeight: 500, margin: '0 0 8px', lineHeight: 1.18 }}>
          Create a new matter
        </h1>
        <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>
          Add the basic details and upload the source files for this matter.
        </p>
      </div>

      <form className="matter-intake-form" onSubmit={handleSubmit}>
        <label className="matter-intake-field matter-intake-name">
          <span>Matter name *</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Smith v Jones 2024"
            style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)', padding: '10px 12px' }}
            required
          />
        </label>

        <div className="matter-intake-section">
          <h2>Matter details</h2>
          <div className="matter-intake-grid">
            <label className="matter-intake-field">
              <span>Client name</span>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Acme Corp"
                style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)', padding: '10px 12px' }}
              />
            </label>
            <label className="matter-intake-field">
              <span>Matter type</span>
              <input
                type="text"
                value={matterType}
                onChange={(e) => setMatterType(e.target.value)}
                placeholder="Litigation / Contract / etc."
                style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)', padding: '10px 12px' }}
              />
            </label>
          </div>
          <div className="matter-intake-grid" style={{ marginTop: 14 }}>
            <label className="matter-intake-field">
              <span>Opposite party</span>
              <input
                type="text"
                value={oppositeParty}
                onChange={(e) => setOppositeParty(e.target.value)}
                placeholder="Jones LLC"
                style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)', padding: '10px 12px' }}
              />
            </label>
            <label className="matter-intake-field">
              <span>Jurisdiction</span>
              <input
                type="text"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="NSW Supreme Court"
                style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)', padding: '10px 12px' }}
              />
            </label>
          </div>
          <label className="matter-intake-field" style={{ display: 'block', marginTop: 14 }}>
            <span>Brief description</span>
            <textarea
              value={briefDescription}
              onChange={(e) => setBriefDescription(e.target.value)}
              rows={3}
              placeholder="Contract dispute over service agreement…"
              style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)', padding: '10px 12px', resize: 'vertical' }}
            />
          </label>
        </div>

        <div className="matter-intake-section">
          <h2>Source files</h2>
          <div
            className={`drop-zone${dragover ? ' dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
            onDragLeave={() => setDragover(false)}
            onDrop={handleDrop}
          >
            <p style={{ margin: 0 }}>Drag & drop files or folders here</p>
            <div className="drop-actions">
              <button type="button" onClick={() => fileInput.current?.click()}>Browse files</button>
              <button type="button" onClick={() => folderInput.current?.click()}>Browse folder</button>
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={handleFileInput}
            />
            <input
              ref={folderInput}
              type="file"
              multiple
              hidden
              {...{ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
              onChange={handleFileInput}
            />
          </div>
          <div className="form-hint upload-limit-hint" style={{ marginTop: 10 }}>
            {uploadLimitCopy}
          </div>
          {files.length > 0 && (
            <div className="file-list">
              <div className="file-list-summary">
                {files.length} file{files.length !== 1 ? 's' : ''} · {formatSize(totalSize)}
              </div>
              {files.slice(0, 20).map((f, i) => (
                <div key={i} className="file-list-entry">{f.relativePath}</div>
              ))}
              {files.length > 20 && (
                <div className="file-list-entry" style={{ color: 'var(--muted)' }}>
                  +{files.length - 20} more
                </div>
              )}
            </div>
          )}
          {files.length === 0 && (
            <div className="form-hint" style={{ marginTop: 10 }}>
              Attach at least one source file.
            </div>
          )}
        </div>

        {runtimeUploadSessionsEnabled && recoverableUpload && (
          <UploadSessionRecoveryCard
            draft={recoverableUpload}
            selectedFiles={files}
            onUseSavedDetails={handleUseRecoverableUpload}
            onForget={() => void handleForgetRecoverableUpload()}
          />
        )}

        {overlapWarnings.length > 0 && (
          <div className="form-warning">
            <h2>Possible duplicate matter</h2>
            <p>Your selected files overlap with existing matter{overlapWarnings.length !== 1 ? 's' : ''}.</p>
            <ul className="overlap-list">
              {overlapWarnings.map((warning) => (
                <li key={warning.matterName}>
                  <strong>{warning.matterName}</strong> — {warning.overlapCount} of {warning.totalIncoming} file{warning.totalIncoming !== 1 ? 's' : ''} match ({warning.overlapPercent}%)
                </li>
              ))}
            </ul>
            <div className="warning-actions">
              <button type="button" onClick={() => void handleOpenExistingMatter(overlapWarnings[0].matterName)}>
                Open {overlapWarnings[0].matterName}
              </button>
              <button type="button" className="secondary" onClick={handleContinueWithOverlap}>
                Continue creating new matter
              </button>
            </div>
          </div>
        )}

        {progressMessage && (
          <div className="form-info">
            <strong>Working…</strong>
            <p>{progressMessage}</p>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="form-actions">
          <button type="submit" disabled={submitting || files.length === 0}>
            {submitting ? 'Creating…' : 'Create matter'}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

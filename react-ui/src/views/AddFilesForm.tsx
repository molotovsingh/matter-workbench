import { useState, useRef } from 'react';
import { useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { useLatestValue } from '../hooks/useLatestValue';
import type { OverlapWarning } from '../types';
import {
  collectDroppedEntries,
  collectFilesFromFileList,
  getDroppedFileSystemEntries,
  type CollectedUploadFile,
} from '../lib/uploadFileCollection';

interface Props {
  onCancel: () => void;
  onDone: (opts?: { autoPrepare?: boolean }) => void;
}

async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function AddFilesForm({ onCancel, onDone }: Props) {
  const { state, appendTerminal } = useApp();
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);
  const [collected, setCollected] = useState<CollectedUploadFile[]>([]);
  const [label, setLabel] = useState('');
  const [dragover, setDragover] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selfOverlap, setSelfOverlap] = useState<OverlapWarning | null>(null);
  const [otherOverlaps, setOtherOverlaps] = useState<OverlapWarning[]>([]);
  const [bypassOverlap, setBypassOverlap] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  function addFiles(files: CollectedUploadFile[]) {
    setCollected((prev) => [...prev, ...files]);
    setSelfOverlap(null);
    setOtherOverlaps([]);
    setBypassOverlap(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragover(false);
    const entries = getDroppedFileSystemEntries(e.dataTransfer);

    if (entries.length > 0) {
      collectDroppedEntries(entries).then(addFiles).catch((err) => setError(getErrorMessage(err)));
    } else {
      addFiles(collectFilesFromFileList(e.dataTransfer.files));
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(collectFilesFromFileList(e.target.files));
    e.target.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (collected.length === 0) { setError('Select at least one file.'); return; }
    const matterName = state.activeMatter?.name;
    if (!matterName) return;
    setSubmitting(true);
    setError('');

    try {
      if (!bypassOverlap) {
        appendTerminal(['[add-files] checking for duplicates…']);
        const hashes = await Promise.all(collected.map((c) => hashFile(c.file)));
        if (activeMatterNameRef.current !== matterName) return;
        const checkResult = await api.checkOverlap({
          hashes,
          proposedName: matterName,
        });
        if (activeMatterNameRef.current !== matterName) return;

        const warnings = checkResult.warnings ?? [];
        const self = warnings.find((w) => w.matterName === matterName);
        const others = warnings.filter((w) => w.matterName !== matterName);

        if (self || others.length > 0) {
          setSelfOverlap(self ?? null);
          setOtherOverlaps(others);
          setSubmitting(false);
          return;
        }
      }

      appendTerminal([`[add-files] uploading ${collected.length} file(s)…`]);
      const fd = new FormData();
      fd.append('matterName', matterName);
      if (label.trim()) fd.append('label', label.trim());
      fd.append('paths', JSON.stringify(collected.map((c) => c.relativePath)));
      collected.forEach((c) => fd.append('files', c.file, c.relativePath));

      const result = await api.addFiles(fd);
      if (activeMatterNameRef.current !== matterName) return;
      appendTerminal([`[add-files] ${collected.length} file(s) added`]);
      onDone({ autoPrepare: (result.intakeAdded?.unique ?? collected.length) > 0 });
    } catch (err) {
      if (activeMatterNameRef.current !== matterName) return;
      setError(getErrorMessage(err));
      appendTerminal([`[add-files] error: ${getErrorMessage(err)}`]);
    } finally {
      if (activeMatterNameRef.current === matterName) setSubmitting(false);
    }
  }

  function handleContinueWithOverlap() {
    setBypassOverlap(true);
    setSelfOverlap(null);
    setOtherOverlaps([]);
  }

  const totalSize = collected.reduce((sum, c) => sum + c.file.size, 0);

  return (
    <div className="matter-intake-shell">
      <div className="matter-intake-hero">
        <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          Add Files
        </div>
        <h1 style={{ fontFamily: 'var(--display-font)', fontSize: 30, fontWeight: 500, margin: '0 0 8px', lineHeight: 1.18 }}>
          Add files to {state.activeMatter?.name}
        </h1>
        <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>
          Upload source documents to the current matter.
        </p>
      </div>

      <form className="matter-intake-form" onSubmit={handleSubmit}>
        <label className="matter-intake-field">
          <span>Batch label (optional)</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 2024 discovery batch"
            maxLength={80}
            style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)', padding: '10px 12px' }}
          />
        </label>

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
            <input ref={fileInput} type="file" multiple hidden onChange={handleFileInput} />
            <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>} onChange={handleFileInput} />
          </div>

          {collected.length > 0 && (
            <div className="file-list">
              <div className="file-list-summary">
                {collected.length} file{collected.length !== 1 ? 's' : ''} · {formatSize(totalSize)}
              </div>
              {collected.slice(0, 20).map((c, i) => (
                <div key={i} className="file-list-entry">{c.relativePath}</div>
              ))}
              {collected.length > 20 && (
                <div className="file-list-entry" style={{ color: 'var(--muted)' }}>
                  +{collected.length - 20} more
                </div>
              )}
            </div>
          )}
        </div>

        {selfOverlap && (
          <div className="form-info">
            <strong>Some files are already in this matter.</strong>
            <p>
              {selfOverlap.overlapCount} of {selfOverlap.totalIncoming} files match existing records.
              They'll be recorded as duplicates of the prior file ID and not re-copied.
            </p>
            <button type="button" className="run-skill-button secondary" style={{ marginTop: 8 }} onClick={handleContinueWithOverlap}>
              Continue
            </button>
          </div>
        )}

        {otherOverlaps.length > 0 && (
          <div className="form-warning">
            <h2>Files appear in other matter(s)</h2>
            <p>Some files appear in other matters. Are these meant to live here too?</p>
            <ul className="overlap-list">
              {otherOverlaps.map((o) => (
                <li key={o.matterName}>
                  <strong>{o.matterName}</strong> — {o.overlapCount} overlapping file{o.overlapCount !== 1 ? 's' : ''} ({o.overlapPercent}%)
                </li>
              ))}
            </ul>
            <div className="warning-actions">
              <button type="button" onClick={onCancel}>Cancel</button>
              <button type="button" className="secondary" onClick={handleContinueWithOverlap}>Continue adding here</button>
            </div>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="form-actions">
          <button type="submit" disabled={submitting || collected.length === 0}>
            {submitting ? 'Adding…' : `Add ${collected.length} file${collected.length !== 1 ? 's' : ''} to matter`}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
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

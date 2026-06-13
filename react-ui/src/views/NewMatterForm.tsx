import { useState, useRef } from 'react';
import { isMatterSwitchSupersededError, useApp } from '../store/AppContext';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import {
  collectDroppedEntries,
  collectFilesFromFileList,
  getDroppedFileSystemEntries,
  type CollectedUploadFile,
} from '../lib/uploadFileCollection';

interface Props {
  onCancel: () => void;
  onCreated: (name: string, opts?: { autoPrepare?: boolean }) => void;
}

export default function NewMatterForm({ onCancel, onCreated }: Props) {
  const { switchActiveMatter, appendTerminal } = useApp();
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
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragover(false);
    const entries = getDroppedFileSystemEntries(e.dataTransfer);
    if (entries.length > 0) {
      collectDroppedEntries(entries)
        .then((dropped) => setFiles((prev) => [...prev, ...dropped]))
        .catch((err) => setError(getErrorMessage(err)));
    } else {
      setFiles((prev) => [...prev, ...collectFilesFromFileList(e.dataTransfer.files)]);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const selectedFiles = collectFilesFromFileList(Array.from(input.files ?? []));
    if (selectedFiles.length > 0) {
      setFiles((prev) => [...prev, ...selectedFiles]);
    }
    window.setTimeout(() => {
      input.value = '';
    }, 0);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Matter name is required.'); return; }
    if (files.length === 0) { setError('Attach at least one source file.'); return; }
    setSubmitting(true);
    setError('');
    appendTerminal([`[new-matter] creating "${name}"…`]);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      const metadata: Record<string, string> = { matterName: name.trim() };
      if (clientName) metadata.clientName = clientName;
      if (matterType) metadata.matterType = matterType;
      if (oppositeParty) metadata.oppositeParty = oppositeParty;
      if (jurisdiction) metadata.jurisdiction = jurisdiction;
      if (briefDescription) metadata.briefDescription = briefDescription;
      fd.append('metadata', JSON.stringify(metadata));
      fd.append('paths', JSON.stringify(files.map((f) => f.relativePath)));
      files.forEach((f) => fd.append('files', f.file, f.relativePath));

      await api.newMatter(fd);
      appendTerminal([`[new-matter] created "${name}"`]);
      await switchActiveMatter(name.trim(), {
        startMessage: false,
        successMessage: false,
        failureMessage: (err) => `[new-matter] switch error: ${getErrorMessage(err)}`,
      });
      onCreated(name.trim(), { autoPrepare: files.length > 0 });
    } catch (err) {
      if (isMatterSwitchSupersededError(err)) return;
      setError(getErrorMessage(err));
      appendTerminal([`[new-matter] error: ${getErrorMessage(err)}`]);
    } finally {
      setSubmitting(false);
    }
  }

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
          {files.length > 0 && (
            <div className="file-list">
              <div className="file-list-summary">{files.length} file{files.length !== 1 ? 's' : ''} selected</div>
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

import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { getErrorMessage } from '../../lib/errors';
import { filePreviewTitle, loadTextFilePreview } from '../../lib/filePreview';
import { useLatestValue } from '../../hooks/useLatestValue';
import type { WorkspaceFile } from '../../types';

interface TreeNodeProps {
  file: WorkspaceFile;
  depth?: number;
}

function getFileIconClass(ext?: string) {
  if (!ext) return 'tree-icon-file';
  const e = ext.toLowerCase();
  if (e === 'md') return 'tree-icon-file tree-icon-file-md';
  if (e === 'txt') return 'tree-icon-file tree-icon-file-txt';
  if (e === 'csv') return 'tree-icon-file tree-icon-file-csv';
  if (e === 'json') return 'tree-icon-file tree-icon-file-json';
  return 'tree-icon-file';
}

function TreeNode({ file }: TreeNodeProps) {
  const { state, dispatch, appendTerminal } = useApp();
  const activeMatterNameRef = useLatestValue(state.activeMatter?.name ?? null);

  async function handleFileClick(path: string, ext?: string) {
    const matterName = state.activeMatter?.name ?? null;
    dispatch({ type: 'SET_ACTIVE_FILE', payload: path });
    dispatch({ type: 'SET_BREADCRUMBS', payload: filePreviewTitle(path) });

    const isPdf = ext?.toLowerCase() === 'pdf';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext?.toLowerCase() ?? '');

    if (isPdf || isImage) {
      const rawUrl = api.getFileRawUrl(path);
      dispatch({ type: 'SET_COMMAND_COPY', payload: `Viewing: ${filePreviewTitle(path)}` });
      dispatch({ type: 'SET_FILE_PREVIEW', payload: { path, type: isPdf ? 'pdf' : 'image', url: rawUrl } });
      dispatch({ type: 'SET_VIEW', payload: 'file-preview' });
    } else {
      try {
        const preview = await loadTextFilePreview(path, api.getFile);
        if (activeMatterNameRef.current !== matterName) return;
        dispatch({ type: 'SET_FILE_PREVIEW', payload: preview });
        dispatch({ type: 'SET_VIEW', payload: 'file-preview' });
      } catch (e) {
        if (activeMatterNameRef.current !== matterName) return;
        appendTerminal([`[file] error reading ${path}: ${getErrorMessage(e)}`]);
      }
    }
  }

  if (file.type === 'folder' && file.children) {
    return (
      <li className="tree-node">
        <details>
          <summary>
            <span className="tree-icon tree-icon-folder" aria-hidden="true" />
            <span className="tree-name-wrap">
              <span className="tree-name">{file.name}</span>
            </span>
          </summary>
          <ul>
            {file.children.map((child) => (
              <TreeNode key={child.path} file={child} depth={1} />
            ))}
          </ul>
        </details>
      </li>
    );
  }

  return (
    <li className="tree-node">
      <button
        type="button"
        className={`tree-file-button${state.activeFilePath === file.path ? ' active' : ''}`}
        onClick={() => handleFileClick(file.path, file.ext)}
      >
        <span className={`tree-icon ${getFileIconClass(file.ext)}`} aria-hidden="true" />
        <span className="tree-name-wrap">
          <span className="tree-name">{file.name}</span>
          {file.canonical && file.canonical !== file.name && (
            <span className="tree-canonical-name">{file.canonical}</span>
          )}
        </span>
        {file.size !== undefined && (
          <span className="tree-meta">{formatSize(file.size)}</span>
        )}
      </button>
    </li>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface Props {
  onRefresh: () => void;
  onAddFiles: () => void;
}

export default function WorkspaceTree({ onRefresh, onAddFiles }: Props) {
  const { state, dispatch } = useApp();
  const workspace = state.activeMatter?.workspace;

  if (!workspace) return null;

  const children = state.showTechnicalFiles
    ? workspace.children
    : workspace.children.filter((f) => !f.isTechnical);

  return (
    <div id="matterFilesSection" className="tree-section">
      <div className="tree-heading-row">
        <div className="tree-heading">Matter files</div>
        <div className="tree-actions">
          <button className="tree-refresh" type="button" onClick={onAddFiles}>
            + Add Files
          </button>
          <button
            className={`tree-refresh${state.showTechnicalFiles ? ' active' : ''}`}
            type="button"
            aria-pressed={state.showTechnicalFiles}
            onClick={() => dispatch({ type: 'SET_SHOW_TECHNICAL', payload: !state.showTechnicalFiles })}
          >
            {state.showTechnicalFiles ? 'Hide technical' : 'Show technical'}
          </button>
          <button className="tree-refresh" type="button" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>
      <ul className="tree-root">
        {children.length === 0 ? (
          <li className="tree-node" style={{ color: 'var(--muted)', fontSize: 12 }}>No files</li>
        ) : (
          children.map((child) => <TreeNode key={child.path} file={child} />)
        )}
      </ul>
    </div>
  );
}

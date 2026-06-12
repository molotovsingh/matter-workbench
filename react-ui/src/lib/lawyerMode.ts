import type { AuthUser, WorkspaceFile } from '../types';

const OPERATOR_ONLY_ROOT_ENTRIES = new Set([
  '01_Admin',
  '02_Extracts',
  '99_Debug',
]);

const OPERATOR_ONLY_BASENAMES = new Set([
  'Extraction Log.csv',
  'File Register.csv',
  'Intake Log.csv',
  'Source Index.json',
  'List of Dates.json',
  'List of Dates.csv',
]);

const GENERATED_ARTIFACT_LANES = new Set([
  '10_Library',
  '20_Workshop',
  '30_Drafts',
  '40_Dispatch',
]);

export function canSeeOperatorSurface(user: AuthUser | null | undefined): boolean {
  return user?.role === 'superuser';
}

export function isOperatorOnlyWorkspacePath(path = ''): boolean {
  const normalized = normalizePath(path);
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return false;
  if (segments[0] === 'matter.json') return true;
  if (OPERATOR_ONLY_ROOT_ENTRIES.has(segments[0])) return true;

  const basename = segments[segments.length - 1] || '';
  if (OPERATOR_ONLY_BASENAMES.has(basename)) return true;

  const firstSegment = segments[0] || '';
  if (GENERATED_ARTIFACT_LANES.has(firstSegment) && /\.(json|csv|log)$/i.test(basename)) return true;

  return false;
}

export function filterWorkspaceFilesForOperatorVisibility(
  files: WorkspaceFile[],
  user: AuthUser | null | undefined,
): WorkspaceFile[] {
  if (canSeeOperatorSurface(user)) return files;
  return files
    .map(filterWorkspaceFile)
    .filter((file): file is WorkspaceFile => Boolean(file));
}

function filterWorkspaceFile(file: WorkspaceFile): WorkspaceFile | null {
  if (isOperatorOnlyWorkspacePath(file.path)) return null;

  if (file.type === 'folder') {
    const children = (file.children || [])
      .map(filterWorkspaceFile)
      .filter((child): child is WorkspaceFile => Boolean(child));
    if (file.path && children.length === 0) return null;
    return { ...file, children };
  }

  return file;
}

function normalizePath(path = ''): string {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

import { api } from '../api/client';
import type { AddFilesResponse, UploadSession, WorkspaceApiResponse } from '../types';
import type { CollectedUploadFile } from './uploadFileCollection';

const UPLOAD_SESSION_DRAFTS_KEY = 'matter-workbench.upload-session-drafts.v1';
const DRAFT_SCHEMA_VERSION = 'upload-session-draft/v1';

type UploadSessionAction = 'create_matter' | 'add_files';

export interface SessionUploadProgress {
  session: UploadSession;
  uploadedFiles: number;
  totalFiles: number;
  currentPath?: string;
  resumed?: boolean;
}

export interface StoredUploadSessionDraftFile {
  index: number;
  relativePath: string;
  name: string;
  size: number;
  lastModified: number;
}

export interface StoredUploadSessionDraft {
  schemaVersion: typeof DRAFT_SCHEMA_VERSION;
  action: UploadSessionAction;
  sessionId: string;
  matterName: string;
  label?: string;
  metadata?: Record<string, string>;
  expectedFileCount: number;
  expectedBytes: number;
  files: StoredUploadSessionDraftFile[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMatterSessionUploadInput {
  name: string;
  metadata: Record<string, string>;
  files: CollectedUploadFile[];
  resumeDraft?: StoredUploadSessionDraft | null;
  onProgress?: (progress: SessionUploadProgress) => void;
}

export interface AddFilesSessionUploadInput {
  matterName: string;
  label?: string;
  files: CollectedUploadFile[];
  resumeDraft?: StoredUploadSessionDraft | null;
  onProgress?: (progress: SessionUploadProgress) => void;
}

export async function createMatterWithUploadSession({
  name,
  metadata,
  files,
  resumeDraft = null,
  onProgress,
}: CreateMatterSessionUploadInput): Promise<WorkspaceApiResponse> {
  const matchedDraft = matchingDraftOrNull(resumeDraft, { action: 'create_matter', matterName: name, files });
  const session = matchedDraft
    ? await api.getUploadSession(matchedDraft.sessionId)
    : await api.createUploadSession({
        action: 'create_matter',
        name,
        metadata,
        expectedFileCount: files.length,
        expectedBytes: totalBytes(files),
      });
  const draft = writeUploadSessionDraft({
    session,
    action: 'create_matter',
    matterName: name,
    metadata,
    files,
    existingDraft: matchedDraft,
  });
  try {
    const latest = await uploadFilesToSession(session, filesForDraftOrder(draft, files), onProgress, Boolean(matchedDraft));
    const result = await api.commitUploadSession(latest.id);
    forgetUploadSessionDraft(draft);
    return result;
  } catch (error) {
    throw error;
  }
}

export async function addFilesWithUploadSession({
  matterName,
  label = '',
  files,
  resumeDraft = null,
  onProgress,
}: AddFilesSessionUploadInput): Promise<AddFilesResponse> {
  const matchedDraft = matchingDraftOrNull(resumeDraft, { action: 'add_files', matterName, files });
  const session = matchedDraft
    ? await api.getUploadSession(matchedDraft.sessionId)
    : await api.createUploadSession({
        action: 'add_files',
        matterName,
        label,
        expectedFileCount: files.length,
        expectedBytes: totalBytes(files),
      });
  const draft = writeUploadSessionDraft({
    session,
    action: 'add_files',
    matterName,
    label,
    files,
    existingDraft: matchedDraft,
  });
  try {
    const latest = await uploadFilesToSession(session, filesForDraftOrder(draft, files), onProgress, Boolean(matchedDraft));
    const result = await api.commitUploadSession(latest.id) as AddFilesResponse;
    forgetUploadSessionDraft(draft);
    return result;
  } catch (error) {
    throw error;
  }
}

export function findUploadSessionDraft({
  action,
  matterName,
}: {
  action: UploadSessionAction;
  matterName?: string;
}): StoredUploadSessionDraft | null {
  const drafts = readDraftStore();
  const key = draftStoreKey(action, matterName || '');
  return drafts[key] || null;
}

export function findLatestUploadSessionDraft({
  action,
  matterName,
}: {
  action: UploadSessionAction;
  matterName?: string;
}): StoredUploadSessionDraft | null {
  if (matterName) return findUploadSessionDraft({ action, matterName });
  return Object.values(readDraftStore())
    .filter((draft) => draft.action === action)
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || '') - Date.parse(left.updatedAt || left.createdAt || ''))[0] || null;
}

export function findMatchingUploadSessionDraft({
  action,
  matterName,
  files,
}: {
  action: UploadSessionAction;
  matterName: string;
  files: CollectedUploadFile[];
}): StoredUploadSessionDraft | null {
  const draft = findUploadSessionDraft({ action, matterName });
  return matchingDraftOrNull(draft, { action, matterName, files });
}

export async function cancelUploadSessionDraft(input: StoredUploadSessionDraft | null | undefined): Promise<void> {
  if (!input) return;
  try {
    await api.cancelUploadSession(input.sessionId);
  } catch {
    // The browser recovery affordance is best-effort. If the server-side session
    // is already gone or unreachable, still remove the local stale pointer.
  } finally {
    forgetUploadSessionDraft(input);
  }
}

export function forgetUploadSessionDraft(input: StoredUploadSessionDraft | { action: UploadSessionAction; matterName?: string } | null | undefined): void {
  if (!input) return;
  const drafts = readDraftStore();
  const key = 'sessionId' in input
    ? draftStoreKey(input.action, input.matterName)
    : draftStoreKey(input.action, input.matterName || '');
  if (!drafts[key]) return;
  delete drafts[key];
  writeDraftStore(drafts);
}

export function selectedFilesMatchUploadSessionDraft(
  draft: StoredUploadSessionDraft | null | undefined,
  files: CollectedUploadFile[],
): boolean {
  if (!draft || !Array.isArray(files) || files.length !== draft.files.length) return false;
  const selected = new Map(files.map((file) => [normalizePathKey(file.relativePath), file]));
  return draft.files.every((draftFile) => {
    const selectedFile = selected.get(normalizePathKey(draftFile.relativePath));
    if (!selectedFile) return false;
    return Number(selectedFile.file?.size || 0) === draftFile.size;
  });
}

export function uploadSessionDraftSummary(draft: StoredUploadSessionDraft | null | undefined): string {
  if (!draft) return '';
  const fileText = `${draft.expectedFileCount} file${draft.expectedFileCount === 1 ? '' : 's'}`;
  const sizeText = formatBytes(draft.expectedBytes);
  return `${draft.matterName || 'Untitled matter'} · ${fileText}${sizeText ? ` · ${sizeText}` : ''}`;
}

async function uploadFilesToSession(
  initialSession: UploadSession,
  files: CollectedUploadFile[],
  onProgress?: (progress: SessionUploadProgress) => void,
  resumed = false,
): Promise<UploadSession> {
  let session = initialSession;
  let uploadedIndexes = uploadedFileIndexes(session);
  for (let index = 0; index < files.length; index += 1) {
    if (uploadedIndexes.has(index)) {
      onProgress?.({
        session,
        uploadedFiles: uploadedIndexes.size,
        totalFiles: files.length,
        currentPath: files[index]?.relativePath,
        resumed,
      });
      continue;
    }
    const item = files[index];
    const formData = new FormData();
    formData.append('fileIndex', String(index));
    formData.append('paths', JSON.stringify([item.relativePath]));
    formData.append('files', item.file, item.relativePath);
    session = await api.uploadSessionFile(session.id, formData);
    uploadedIndexes = uploadedFileIndexes(session);
    onProgress?.({
      session,
      uploadedFiles: Math.max(uploadedIndexes.size, index + 1),
      totalFiles: files.length,
      currentPath: item.relativePath,
      resumed,
    });
  }
  return session;
}

function writeUploadSessionDraft({
  session,
  action,
  matterName,
  label = '',
  metadata,
  files,
  existingDraft = null,
}: {
  session: UploadSession;
  action: UploadSessionAction;
  matterName: string;
  label?: string;
  metadata?: Record<string, string>;
  files: CollectedUploadFile[];
  existingDraft?: StoredUploadSessionDraft | null;
}): StoredUploadSessionDraft {
  const now = new Date().toISOString();
  const draft: StoredUploadSessionDraft = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    action,
    sessionId: session.id,
    matterName,
    label,
    metadata,
    expectedFileCount: files.length,
    expectedBytes: totalBytes(files),
    files: files.map((item, index) => ({
      index,
      relativePath: item.relativePath,
      name: item.file?.name || item.relativePath.split('/').pop() || item.relativePath,
      size: Number(item.file?.size || 0),
      lastModified: Number(item.file?.lastModified || 0),
    })),
    createdAt: existingDraft?.createdAt || now,
    updatedAt: now,
  };
  const drafts = readDraftStore();
  drafts[draftStoreKey(action, matterName)] = draft;
  writeDraftStore(drafts);
  return draft;
}

function matchingDraftOrNull(
  draft: StoredUploadSessionDraft | null | undefined,
  expected: { action: UploadSessionAction; matterName: string; files: CollectedUploadFile[] },
): StoredUploadSessionDraft | null {
  if (!draft) return null;
  if (draft.action !== expected.action) return null;
  if (normalizeMatterKey(draft.matterName) !== normalizeMatterKey(expected.matterName)) return null;
  return selectedFilesMatchUploadSessionDraft(draft, expected.files) ? draft : null;
}

function filesForDraftOrder(draft: StoredUploadSessionDraft, files: CollectedUploadFile[]): CollectedUploadFile[] {
  const byPath = new Map(files.map((file) => [normalizePathKey(file.relativePath), file]));
  return draft.files.map((draftFile) => byPath.get(normalizePathKey(draftFile.relativePath))).filter(Boolean) as CollectedUploadFile[];
}

function uploadedFileIndexes(session: UploadSession): Set<number> {
  const uploadedStatuses = new Set(['uploaded', 'verified', 'committed']);
  return new Set((session.items || [])
    .filter((item) => uploadedStatuses.has(String(item.status || '').toLowerCase()))
    .map((item) => Number(item.fileIndex))
    .filter((index) => Number.isInteger(index) && index >= 0));
}

function readDraftStore(): Record<string, StoredUploadSessionDraft> {
  const storage = safeLocalStorage();
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(UPLOAD_SESSION_DRAFTS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const drafts: Record<string, StoredUploadSessionDraft> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const draft = normalizeStoredDraft(value);
      if (draft) drafts[key] = draft;
    }
    return drafts;
  } catch {
    return {};
  }
}

function writeDraftStore(drafts: Record<string, StoredUploadSessionDraft>): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  const keys = Object.keys(drafts);
  if (keys.length === 0) {
    storage.removeItem(UPLOAD_SESSION_DRAFTS_KEY);
    return;
  }
  storage.setItem(UPLOAD_SESSION_DRAFTS_KEY, JSON.stringify(drafts));
}

function normalizeStoredDraft(value: unknown): StoredUploadSessionDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== DRAFT_SCHEMA_VERSION) return null;
  const action = record.action === 'add_files' ? 'add_files' : record.action === 'create_matter' ? 'create_matter' : null;
  if (!action) return null;
  const sessionId = stringValue(record.sessionId);
  const matterName = stringValue(record.matterName);
  const files = Array.isArray(record.files) ? record.files.map(normalizeStoredDraftFile).filter(Boolean) as StoredUploadSessionDraftFile[] : [];
  if (!sessionId || !matterName || !files.length) return null;
  return {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    action,
    sessionId,
    matterName,
    label: stringValue(record.label),
    metadata: normalizeMetadata(record.metadata),
    expectedFileCount: positiveNumber(record.expectedFileCount, files.length),
    expectedBytes: positiveNumber(record.expectedBytes, files.reduce((sum, item) => sum + item.size, 0)),
    files,
    createdAt: stringValue(record.createdAt),
    updatedAt: stringValue(record.updatedAt),
  };
}

function normalizeStoredDraftFile(value: unknown): StoredUploadSessionDraftFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const relativePath = stringValue(record.relativePath);
  if (!relativePath) return null;
  return {
    index: positiveNumber(record.index, 0),
    relativePath,
    name: stringValue(record.name) || relativePath.split('/').pop() || relativePath,
    size: positiveNumber(record.size, 0),
    lastModified: positiveNumber(record.lastModified, 0),
  };
}

function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const normalized: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) continue;
    const text = stringValue(item);
    if (text) normalized[key] = text;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function draftStoreKey(action: UploadSessionAction, matterName: string): string {
  return `${action}:${normalizeMatterKey(matterName)}`;
}

function normalizeMatterKey(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function normalizePathKey(value: string): string {
  return String(value || '').trim().replace(/\\+/g, '/').toLowerCase();
}

function totalBytes(files: CollectedUploadFile[]): number {
  return files.reduce((sum, item) => sum + Number(item.file?.size || 0), 0);
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.floor(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

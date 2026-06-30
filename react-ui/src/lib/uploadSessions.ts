import { api } from '../api/client';
import type { AddFilesResponse, UploadSession, WorkspaceApiResponse } from '../types';
import type { CollectedUploadFile } from './uploadFileCollection';

export interface SessionUploadProgress {
  session: UploadSession;
  uploadedFiles: number;
  totalFiles: number;
  currentPath?: string;
}

export interface CreateMatterSessionUploadInput {
  name: string;
  metadata: Record<string, string>;
  files: CollectedUploadFile[];
  onProgress?: (progress: SessionUploadProgress) => void;
}

export interface AddFilesSessionUploadInput {
  matterName: string;
  label?: string;
  files: CollectedUploadFile[];
  onProgress?: (progress: SessionUploadProgress) => void;
}

export async function createMatterWithUploadSession({
  name,
  metadata,
  files,
  onProgress,
}: CreateMatterSessionUploadInput): Promise<WorkspaceApiResponse> {
  const session = await api.createUploadSession({
    action: 'create_matter',
    name,
    metadata,
    expectedFileCount: files.length,
    expectedBytes: totalBytes(files),
  });
  await uploadFilesToSession(session, files, onProgress);
  return api.commitUploadSession(session.id);
}

export async function addFilesWithUploadSession({
  matterName,
  label = '',
  files,
  onProgress,
}: AddFilesSessionUploadInput): Promise<AddFilesResponse> {
  const session = await api.createUploadSession({
    action: 'add_files',
    matterName,
    label,
    expectedFileCount: files.length,
    expectedBytes: totalBytes(files),
  });
  await uploadFilesToSession(session, files, onProgress);
  return api.commitUploadSession(session.id) as Promise<AddFilesResponse>;
}

async function uploadFilesToSession(
  initialSession: UploadSession,
  files: CollectedUploadFile[],
  onProgress?: (progress: SessionUploadProgress) => void,
): Promise<UploadSession> {
  let session = initialSession;
  for (let index = 0; index < files.length; index += 1) {
    const item = files[index];
    const formData = new FormData();
    formData.append('fileIndex', String(index));
    formData.append('paths', JSON.stringify([item.relativePath]));
    formData.append('files', item.file, item.relativePath);
    session = await api.uploadSessionFile(session.id, formData);
    onProgress?.({
      session,
      uploadedFiles: index + 1,
      totalFiles: files.length,
      currentPath: item.relativePath,
    });
  }
  return session;
}

function totalBytes(files: CollectedUploadFile[]): number {
  return files.reduce((sum, item) => sum + item.file.size, 0);
}

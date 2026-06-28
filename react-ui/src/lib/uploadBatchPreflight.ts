import type { CollectedUploadFile } from './uploadFileCollection';

export const DEFAULT_BROWSER_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;
export const DEFAULT_BROWSER_UPLOAD_MAX_FILES = 5000;

export interface UploadBatchSizeAssessment {
  ok: boolean;
  totalBytes: number;
  maxBytes: number;
  totalFiles: number;
  maxFiles: number;
  message: string;
}

export function assessUploadBatchSize(
  files: CollectedUploadFile[],
  maxBytes?: number | null,
  maxFiles?: number | null,
): UploadBatchSizeAssessment {
  const totalBytes = files.reduce((sum, item) => sum + safeFileSize(item.file), 0);
  const totalFiles = files.length;
  const byteLimit = effectiveUploadByteLimit(maxBytes);
  const fileLimit = effectiveUploadFileLimit(maxFiles);
  if (fileLimit > 0 && totalFiles > fileLimit) {
    return {
      ok: false,
      totalBytes,
      maxBytes: byteLimit,
      totalFiles,
      maxFiles: fileLimit,
      message: `This selection has too many files for one upload. Keep each upload under ${formatWholeNumber(fileLimit)} ${fileLimit === 1 ? 'file' : 'files'}. Split the folder into smaller batches and upload the batches one by one.`,
    };
  }
  if (byteLimit > 0 && totalBytes > byteLimit) {
    return {
      ok: false,
      totalBytes,
      maxBytes: byteLimit,
      totalFiles,
      maxFiles: fileLimit,
      message: `This selection is ${formatBytes(totalBytes)}, which is too large for one upload. The current limit is ${formatBytes(byteLimit)} per upload batch. Upload fewer files, split the folder into smaller batches, or upload very large PDFs separately.`,
    };
  }
  return { ok: true, totalBytes, maxBytes: byteLimit, totalFiles, maxFiles: fileLimit, message: '' };
}

export function describeUploadBatchLimit(maxBytes?: number | null, maxFiles?: number | null): string {
  const byteLimit = effectiveUploadByteLimit(maxBytes);
  const fileLimit = effectiveUploadFileLimit(maxFiles);
  const parts: string[] = [];
  if (byteLimit > 0) parts.push(`${formatBytes(byteLimit)} per upload batch`);
  if (fileLimit > 0) parts.push(`${formatWholeNumber(fileLimit)} ${fileLimit === 1 ? 'file' : 'files'} per batch`);
  const limits = parts.length > 0 ? parts.join(' · ') : 'Upload in practical batches';
  return `${limits}. For a voluminous record, use Browse folder and split into batches; the matter can receive more files later with Add Files.`;
}

function effectiveUploadByteLimit(maxBytes?: number | null): number {
  const configuredLimit = Number(maxBytes || 0);
  const serverLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : DEFAULT_BROWSER_UPLOAD_MAX_BYTES;
  const limit = Math.min(serverLimit, DEFAULT_BROWSER_UPLOAD_MAX_BYTES);
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

function effectiveUploadFileLimit(maxFiles?: number | null): number {
  const configuredLimit = Number(maxFiles || 0);
  const serverLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.floor(configuredLimit)
    : DEFAULT_BROWSER_UPLOAD_MAX_FILES;
  const limit = Math.min(serverLimit, DEFAULT_BROWSER_UPLOAD_MAX_FILES);
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

function safeFileSize(file: File): number {
  const size = Number(file?.size || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.floor(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KB`;
  return `${Math.floor(bytes)} B`;
}

function formatWholeNumber(value: number): string {
  return Math.floor(value).toLocaleString('en-US');
}

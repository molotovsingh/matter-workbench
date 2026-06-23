import type { CollectedUploadFile } from './uploadFileCollection';

export interface UploadBatchSizeAssessment {
  ok: boolean;
  totalBytes: number;
  maxBytes: number;
  message: string;
}

export function assessUploadBatchSize(
  files: CollectedUploadFile[],
  maxBytes?: number | null,
): UploadBatchSizeAssessment {
  const totalBytes = files.reduce((sum, item) => sum + safeFileSize(item.file), 0);
  const limit = Number(maxBytes || 0);
  if (!Number.isFinite(limit) || limit <= 0 || totalBytes <= limit) {
    return { ok: true, totalBytes, maxBytes: limit > 0 ? limit : 0, message: '' };
  }
  return {
    ok: false,
    totalBytes,
    maxBytes: limit,
    message: `This selection is too large for one upload. Keep each upload under ${formatBytes(limit)}. Select fewer files or split the folder into smaller batches.`,
  };
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

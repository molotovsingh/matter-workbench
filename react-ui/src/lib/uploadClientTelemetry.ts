import { api } from '../api/client';
import type { CollectedUploadFile } from './uploadFileCollection';

type UploadPrecheckView = 'new_matter' | 'add_files';
type UploadPrecheckAction = 'create_matter' | 'add_files';

interface UploadTelemetryInput {
  files: CollectedUploadFile[];
  matterName?: string;
  view: UploadPrecheckView;
  action: UploadPrecheckAction;
}

interface UploadSubmitFailureTelemetryInput extends UploadTelemetryInput {
  error: unknown;
}

export function reportUploadPrecheckUnavailable(input: UploadTelemetryInput): void {
  void api.capturePrivateBetaClientSignal({
    code: 'upload.precheck_hash_unavailable',
    category: 'upload',
    severity: 'warning',
    view: input.view,
    action: input.action,
    stage: 'upload_precheck',
    matterName: input.matterName,
    fileCount: input.files.length,
    sizeBucket: sizeBucketForFiles(input.files),
    errorClass: 'BrowserHashUnavailable',
    errorMessage: 'Browser duplicate check was unavailable before upload.',
  }).catch(() => {
    // Client telemetry must never interrupt the user's upload.
  });
}

export function reportUploadSubmitFailure(input: UploadSubmitFailureTelemetryInput): void {
  void api.capturePrivateBetaClientSignal({
    code: uploadErrorCode(input.error),
    category: 'upload',
    severity: 'error',
    view: input.view,
    action: input.action,
    stage: 'upload_submit',
    matterName: input.matterName,
    fileCount: input.files.length,
    sizeBucket: sizeBucketForFiles(input.files),
    errorClass: errorClass(input.error),
    errorMessage: 'Upload submit failed before completion.',
  }).catch(() => {
    // Client telemetry must never interrupt the user's upload.
  });
}

export function sizeBucketForFiles(files: Pick<CollectedUploadFile, 'file'>[]): string {
  let total = 0;
  let sawSize = false;
  for (const item of files) {
    const size = item.file.size;
    if (!Number.isFinite(size)) continue;
    sawSize = true;
    total += Math.max(0, size);
  }
  if (!sawSize) return 'unknown';
  if (total < 1024 * 1024) return '0_1_mb';
  if (total < 10 * 1024 * 1024) return '1_10_mb';
  if (total < 100 * 1024 * 1024) return '10_100_mb';
  if (total < 500 * 1024 * 1024) return '100_500_mb';
  return '500_mb_plus';
}

function uploadErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'upload.submit_failed';
  const value = (error as { code?: unknown }).code;
  if (typeof value !== 'string') return 'upload.submit_failed';
  const code = value.trim();
  return /^upload\.[a-z0-9_]+$/.test(code) ? code : 'upload.submit_failed';
}

function errorClass(error: unknown): string {
  if (error instanceof Error) return 'Error';
  if (Array.isArray(error)) return 'Array';
  if (error && typeof error === 'object') return 'Object';
  return typeof error || 'unknown';
}

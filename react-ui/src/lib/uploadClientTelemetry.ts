import { api } from '../api/client';
import type { CollectedUploadFile } from './uploadFileCollection';

type UploadPrecheckView = 'new_matter' | 'add_files';
type UploadPrecheckAction = 'create_matter' | 'add_files';

interface UploadPrecheckTelemetryInput {
  files: CollectedUploadFile[];
  matterName?: string;
  view: UploadPrecheckView;
  action: UploadPrecheckAction;
}

export function reportUploadPrecheckUnavailable(input: UploadPrecheckTelemetryInput): void {
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

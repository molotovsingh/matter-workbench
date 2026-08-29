// Client for the flag-gated V4 document intake/extraction mount.
//
// This module is deliberately separate from api/client.ts: V4 is an isolated
// slice (V4-ISO-001) that may be entirely absent from a deployment. The UI
// discovers it at runtime by probing `GET /api/v4/status` — when the mount is
// off or excluded, the probe 404s through to the legacy API and every V4
// surface stays hidden. Nothing in the legacy client or server learns about
// the flag.
//
// Upload flow (mirrors production's presigned-URL trust model):
//   1. POST /api/v4/v1/intakes  (Idempotency-Key header) → per-file upload
//      authorizations {token, url, requiredHeaders}.
//   2. PUT each file's bytes to its authorization URL with the upload token
//      header — XHR, so the UI gets real byte-level progress.
//   3. POST custody-commit per file as soon as its bytes land (starts
//      inspection and page fan-out while later files still upload), then one
//      batch custody-commit.
//   4. Poll GET progress for the live completion ratio and ETA band.

import { ApiError } from './client';

const V4_PREFIX = '/api/v4';

export interface V4MountStatus {
  enabled: boolean;
  started: boolean;
  tenantId: string;
  label: string;
  uploadTokenHeader: string;
  /** True when the server imports finished results into the matter record. */
  resultImport: boolean;
  limits: {
    maximumFiles: number;
    maximumFileBytes: number;
    maximumIntakeBytes: number;
  };
}

export interface V4FileManifestInput {
  clientFileId?: string;
  originalName: string;
  relativePath?: string;
  mimeType?: string;
  expectedBytes: number;
  lastModifiedMs?: number;
}

export interface V4UploadAuthorization {
  token: string;
  method: string;
  url: string;
  expiresAt: string;
  requiredHeaders?: Record<string, string>;
  stagedObjectKey: string;
}

export interface V4IntakeFile {
  fileId: string;
  documentId: string;
  status: string;
  manifest: { originalName: string; relativePath: string; expectedBytes: number };
  uploadAuthorization?: V4UploadAuthorization;
}

// What the matter record did with this run's results. Recorded against the run
// by the server after filing, so it survives the lawyer leaving the page. Null
// until filing has reported, and absent entirely on deployments where results
// stay in the V4 evidence store.
export interface V4FilingReport {
  filed: string[];
  leftForNormalExtraction: string[];
  skippedUnregistered: string[];
  skippedExistingRecord: string[];
}

export interface V4Intake {
  intakeId: string;
  matterId: string;
  status: string;
  idempotent?: boolean;
  expectedFileCount: number;
  expectedBytes: number;
  files: V4IntakeFile[];
  resultId?: string | null;
  filingReport?: V4FilingReport | null;
}

// Which run this matter was last watching. Remembered so a reload or a trip
// away from the page rejoins the run instead of losing it: runs reach several
// minutes on large documents, and a report only the patient ever see is not
// much of a report. Scoped per matter so two matters cannot cross wires.
const RUN_STORAGE_PREFIX = 'mwb.v4.run.';

export function rememberV4Run(matterName: string, intakeId: string): void {
  try {
    window.localStorage.setItem(`${RUN_STORAGE_PREFIX}${v4MatterIdFromName(matterName)}`, intakeId);
  } catch {
    // Private browsing or a full quota. Recovery is a convenience, never a
    // custody guarantee, so losing the pointer must not break the run.
  }
}

export function recallV4Run(matterName: string): string {
  try {
    return window.localStorage.getItem(`${RUN_STORAGE_PREFIX}${v4MatterIdFromName(matterName)}`) ?? '';
  } catch {
    return '';
  }
}

export function forgetV4Run(matterName: string): void {
  try {
    window.localStorage.removeItem(`${RUN_STORAGE_PREFIX}${v4MatterIdFromName(matterName)}`);
  } catch {
    // See rememberV4Run.
  }
}

export interface V4Progress {
  status: string;
  updatedAt: string;
  upload: {
    committedFiles: number;
    expectedFiles: number;
    committedBytes: number;
    expectedBytes: number;
  };
  processing: {
    observedLogicalPages: number;
    completionRatio: number;
    custodyElapsedSeconds: number | null;
    eta: { lowerSeconds?: number | null; upperSeconds?: number | null; sloState?: string };
  };
  exception: { active: boolean; reasons: string[] };
}

/**
 * Discover the V4 mount. Returns null for ANY failure — a 404 (flag off or
 * source excluded from the deploy), a network error, or an unexpected body —
 * because "V4 unavailable" is a normal state, never an error to surface.
 */
export async function probeV4IntakeStatus(): Promise<V4MountStatus | null> {
  try {
    const res = await fetch(`${V4_PREFIX}/status`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const status = body as Partial<V4MountStatus> & { ok?: boolean };
    if (status?.ok !== true || status.enabled !== true) return null;
    if (typeof status.uploadTokenHeader !== 'string' || !status.limits) return null;
    return {
      enabled: true,
      started: status.started === true,
      tenantId: String(status.tenantId ?? ''),
      label: String(status.label ?? ''),
      uploadTokenHeader: status.uploadTokenHeader,
      resultImport: status.resultImport === true,
      limits: {
        maximumFiles: Number(status.limits.maximumFiles) || 0,
        maximumFileBytes: Number(status.limits.maximumFileBytes) || 0,
        maximumIntakeBytes: Number(status.limits.maximumIntakeBytes) || 0,
      },
    };
  } catch {
    return null;
  }
}

export async function createV4Intake({
  matterId,
  files,
  idempotencyKey,
  clientRequestId,
  workloadClass,
}: {
  matterId: string;
  files: V4FileManifestInput[];
  idempotencyKey: string;
  /**
   * The workbench matter FOLDER name, verbatim. V4 treats it as an opaque
   * client reference; the server-side result bridge uses it to find the
   * matter folder when importing extracted text into the record.
   */
  clientRequestId?: string;
  workloadClass?: string;
}): Promise<V4Intake> {
  // Header values must be ByteString-safe; a folder name with characters
  // outside printable ASCII would make fetch throw. The bridge falls back to
  // reversing the matterId slug when the reference is trimmed or absent.
  const safeClientReference = (clientRequestId ?? '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 200);
  const body = await v4Json(`${V4_PREFIX}/v1/intakes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      ...(safeClientReference ? { 'X-Client-Request-Id': safeClientReference } : {}),
    },
    body: JSON.stringify({ matterId, files, ...(workloadClass ? { workloadClass } : {}) }),
  });
  return requireField<V4Intake>(body, 'intake');
}

export async function commitV4FileCustody({
  intakeId,
  fileId,
  uploadToken,
}: {
  intakeId: string;
  fileId: string;
  uploadToken: string;
}): Promise<void> {
  await v4Json(`${V4_PREFIX}/v1/intakes/${encodeURIComponent(intakeId)}/files/${encodeURIComponent(fileId)}/custody-commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadToken }),
  });
}

export async function commitV4BatchCustody({ intakeId }: { intakeId: string }): Promise<V4Intake> {
  const body = await v4Json(`${V4_PREFIX}/v1/intakes/${encodeURIComponent(intakeId)}/custody-commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return requireField<V4Intake>(body, 'intake');
}

export async function getV4Progress({ intakeId }: { intakeId: string }): Promise<V4Progress> {
  const body = await v4Json(`${V4_PREFIX}/v1/intakes/${encodeURIComponent(intakeId)}/progress`, { cache: 'no-store' });
  return requireField<V4Progress>(body, 'progress');
}

export async function getV4Intake({ intakeId }: { intakeId: string }): Promise<V4Intake> {
  const body = await v4Json(`${V4_PREFIX}/v1/intakes/${encodeURIComponent(intakeId)}`, { cache: 'no-store' });
  return requireField<V4Intake>(body, 'intake');
}

/**
 * PUT one file's bytes to its emulated presigned staging URL. Uses XHR rather
 * than fetch because fetch cannot report request-body progress, and showing
 * honest byte-level upload progress is the point of this slice.
 */
export function putV4StagedFile({
  authorization,
  uploadTokenHeader,
  file,
  onProgress,
  signal,
}: {
  authorization: V4UploadAuthorization;
  uploadTokenHeader: string;
  file: File;
  onProgress?: (loadedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fail = (error: ApiError) => reject(error);
    const onAbort = () => {
      xhr.abort();
      fail(storeError('Upload was cancelled.', 0, 'object.upload_cancelled'));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    xhr.open(authorization.method || 'PUT', authorization.url, true);
    for (const [name, value] of Object.entries(authorization.requiredHeaders ?? {})) {
      try {
        xhr.setRequestHeader(name, value);
      } catch {
        // A header the browser refuses to set (rare, e.g. forbidden names) is
        // not fatal here — the emulated endpoint only enforces the token.
      }
    }
    xhr.setRequestHeader(uploadTokenHeader, authorization.token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onerror = () => fail(storeError('The upload could not reach the server. Check your connection and try again.', 0, 'object.upload_network_failed'));
    xhr.ontimeout = () => fail(storeError('The upload timed out. Try again.', 0, 'object.upload_timeout'));
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let code = 'object.upload_rejected';
      let message = `Upload was rejected (${xhr.status}).`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: { code?: string; message?: string } };
        if (parsed?.error?.code) code = parsed.error.code;
        if (parsed?.error?.message) message = parsed.error.message;
      } catch {
        // Keep the generic message for non-JSON bodies.
      }
      fail(storeError(message, xhr.status, code));
    };
    xhr.send(file);
  });
}

/** Idempotency key for one create-intake attempt. */
export function newV4IdempotencyKey(): string {
  const generator = (globalThis.crypto as Crypto & { randomUUID?: () => string })?.randomUUID;
  if (typeof generator === 'function') return generator.call(globalThis.crypto);
  return `v4-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The V4 service scopes intakes by an opaque matterId with a strict identifier
 * charset; legacy matters are keyed by free-form display names. Until the
 * cutover defines a real mapping, derive a deterministic identifier from the
 * matter name so repeated extractions of the same matter group together.
 */
export function v4MatterIdFromName(matterName: string): string {
  const sanitized = matterName
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .slice(0, 240);
  return sanitized || 'matter';
}

async function v4Json(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw storeError('The app could not reach the V4 intake service. Check your connection and try again.', 0, 'api.network_failed');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON bodies (proxy error pages) fall through to the status check.
  }
  const envelope = (body ?? {}) as { ok?: boolean; error?: { code?: string; message?: string } };
  if (!res.ok || envelope.ok === false) {
    throw storeError(
      envelope.error?.message || `The V4 intake service returned ${res.status}.`,
      res.status,
      envelope.error?.code,
    );
  }
  return envelope as Record<string, unknown>;
}

function requireField<T>(body: Record<string, unknown>, field: string): T {
  const value = body[field];
  if (!value || typeof value !== 'object') {
    throw storeError(`The V4 intake service response is missing "${field}".`, 502, 'api.malformed_response');
  }
  return value as T;
}

function storeError(message: string, statusCode: number, code?: string): ApiError {
  return new ApiError(message, statusCode, code);
}

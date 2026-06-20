import type {
  AuthStatus,
  InstallationsResponse,
  MothershipReport,
} from '../types';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

type AuthRequiredHandler = () => void;
let authRequiredHandler: AuthRequiredHandler | null = null;

export function setAuthRequiredHandler(handler: AuthRequiredHandler | null) {
  authRequiredHandler = handler;
}

function checkAuthRequired(status: number): boolean {
  if (status === 401 && authRequiredHandler) {
    authRequiredHandler();
    return true;
  }
  return false;
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

function withCredentials(): RequestInit {
  return { credentials: 'same-origin' };
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const response = await fetch('/api/auth/status', withCredentials());
  return parseJson<AuthStatus>(response);
}

export async function login(username: string, password: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const body = await parseJson<{ error?: string }>(response);
    return { ok: false, status: response.status, error: body.error };
  }
  return { ok: true, status: response.status };
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
}

export async function listInstallations(sinceDays: number): Promise<InstallationsResponse> {
  const response = await fetch(`/api/installations?sinceDays=${sinceDays}`, withCredentials());
  if (!response.ok) {
    if (checkAuthRequired(response.status)) throw new ApiError('installations', response.status, 'Session expired');
    throw new ApiError('installations', response.status, await safeError(response));
  }
  return parseJson<InstallationsResponse>(response);
}

export async function getReport(sinceDays: number): Promise<MothershipReport> {
  const response = await fetch(`/api/report?sinceDays=${sinceDays}`, withCredentials());
  if (!response.ok) {
    if (checkAuthRequired(response.status)) throw new ApiError('report', response.status, 'Session expired');
    throw new ApiError('report', response.status, await safeError(response));
  }
  return parseJson<MothershipReport>(response);
}

export async function getInstallationReport(installationId: string, sinceDays: number): Promise<MothershipReport> {
  const response = await fetch(`/api/installations/${encodeURIComponent(installationId)}/report?sinceDays=${sinceDays}`, withCredentials());
  if (!response.ok) {
    if (checkAuthRequired(response.status)) throw new ApiError('installation-report', response.status, 'Session expired');
    throw new ApiError('installation-report', response.status, await safeError(response));
  }
  return parseJson<MothershipReport>(response);
}

export async function updateFeedbackStatus(
  installationId: string,
  feedbackId: string,
  status: string,
  note: string,
): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(`/api/feedback/${encodeURIComponent(installationId)}/${encodeURIComponent(feedbackId)}/status`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ status, note }),
  });
  checkAuthRequired(response.status);
  return { ok: response.ok, status: response.status };
}

export async function revokeInstallation(installationId: string): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(`/api/installations/${encodeURIComponent(installationId)}/revoke`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({}),
  });
  checkAuthRequired(response.status);
  return { ok: response.ok, status: response.status };
}

export class ApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(`${endpoint} failed (${statusCode}): ${message}`);
    this.name = 'ApiError';
  }
}

async function safeError(response: Response): Promise<string> {
  try {
    const body = await parseJson<{ error?: string }>(response);
    return body.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

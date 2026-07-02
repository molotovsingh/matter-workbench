import type {
  AiSettings,
  AiSettingsSaveRequest,
  AiSettingsTestRequest,
  AiSettingsTestResponse,
  AddFilesResponse,
  AppConfig,
  AuthUser,
  CheckOverlapRequest,
  CheckOverlapResponse,
  ConfigurableSkill,
  ConfigurableSkillCancelRequest,
  ConfigurableSkillCreateResponse,
  ConfigurableSkillLifecycleRequest,
  ConfigurableSkillLifecycleResponse,
  ConfigurableSkillRunRequest,
  ConfigurableSkillRunResult,
  CommandInteractionRequest,
  DescribeSourcesResult,
  DoctorFixRequest,
  DoctorFixResult,
  DoctorScanResult,
  ExtractRunResult,
  JobStatusList,
  ListOfDatesRunResult,
  MatterSkillRunRequest,
  MatterContextPreview,
  MatterContextSearchResponse,
  MatterLog,
  NativeSkillRetryRequest,
  NativeSkillRunResult,
  MatterCopilotAnswer,
  MatterCopilotConversationTurn,
  MatterCopilotResearchAnswer,
  MatterStoryRunResult,
  MatterAttention,
  MatterStatus,
  PreparationPlan,
  PreparationQueueRunRequest,
  PreparationQueueRunResponse,
  PreparationRunTelemetryRequest,
  PreparationRunTelemetryResponse,
  ProceduralPostureDiagnosisResult,
  PrivateBetaFeedbackList,
  PrivateBetaFeedbackRequest,
  PrivateBetaFeedbackResponse,
  PrivateBetaFeedbackSyncResult,
  PrivateBetaClientSignalRequest,
  PrivateBetaClientSignalResponse,
  PrivateBetaUserCreateRequest,
  PrivateBetaUserList,
  PrivateBetaUserResponse,
  RerunAdvice,
  SkillFactoryHealth,
  SkillIdea,
  SkillIdeaCreateRequest,
  SkillIdeaCreateResponse,
  SkillIdeaDesignBriefUpdateRequest,
  SkillIdeaStatusUpdateRequest,
  SkillInterviewPlanRequest,
  SkillInterviewPlanResponse,
  SkillIdeaSample,
  SkillIdeaSampleApprovalResponse,
  SkillRouterDecision,
  SkillSampleOutputRequest,
  SkillSampleOutputResponse,
  SkillRegistry,
  SkillRun,
  SourceRemovalImpactPreview,
  SourceRemovalResult,
  SystemHealthReport,
  UserReadinessReport,
  UploadSession,
  UploadSessionCreateRequest,
  WorkspaceApiNode,
  WorkspaceApiResponse,
} from '../types';
import { redactSensitiveText } from '../lib/secretRedaction';
import { workspaceLaneLabel } from '../lib/workspaceLabels';

export class ApiError extends Error {
  statusCode: number;
  code?: string;
  authRequired: boolean;
  diagnostic?: ApiErrorDiagnostic;
  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.authRequired = false;
  }
}

export interface ApiErrorDiagnostic {
  statusCode: number;
  code?: string;
  statusText?: string;
  urlPath: string;
  bodyKind: 'html' | 'json' | 'text' | 'empty';
  htmlTitle?: string;
}

type AuthRequiredHandler = () => void;

type GetJsonOptions = {
  bypassCache?: boolean;
};

type JobListQuery = number | {
  limit?: number;
  matterName?: string;
  matter?: string;
  kind?: string;
  status?: string;
};

const CONFIG_CACHE_BUSTER_PARAM = '_mwbFresh';
const FRESH_JSON_FETCH_INIT: RequestInit = {
  cache: 'no-store',
  headers: {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  },
};

let authRequiredHandler: AuthRequiredHandler | null = null;

export function setAuthRequiredHandler(handler: AuthRequiredHandler | null) {
  authRequiredHandler = handler;
}

async function getJson<T>(url: string, options: GetJsonOptions = {}): Promise<T> {
  const requestUrl = options.bypassCache ? withCacheBust(url) : url;
  const init = options.bypassCache ? FRESH_JSON_FETCH_INIT : undefined;
  const res = await fetch(requestUrl, init);
  return parseJsonResponse<T>(res, url);
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseJsonResponse<T>(res, url);
}

async function postFormData<T>(url: string, formData: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: formData });
  } catch {
    throw createUploadNetworkError(url);
  }
  return parseJsonResponse<T>(res, url);
}

function createUploadNetworkError(url: string): ApiError {
  const error = new ApiError(
    'The upload could not reach the server. If these files are large, split them into smaller batches and try again.',
    0,
    'upload.network_failed',
  );
  error.diagnostic = {
    statusCode: 0,
    code: 'upload.network_failed',
    urlPath: urlPathForDiagnostic(url),
    bodyKind: 'empty',
  };
  return error;
}

async function parseJsonResponse<T>(res: Response, url: string): Promise<T> {
  if (!res.ok) {
    throw await createApiError(res, url);
  }
  if (res.status === 204) return undefined as T;
  const diagnosticResponse = res.clone();
  try {
    return await res.json() as T;
  } catch {
    throw await createInvalidJsonResponseError(diagnosticResponse, url);
  }
}

async function createApiError(res: Response, url: string): Promise<ApiError> {
  const payload = await readErrorPayload(res);
  const error = new ApiError(formatApiErrorMessage(payload, res, url), res.status, apiErrorCode(payload, res, url));
  error.diagnostic = buildApiErrorDiagnostic(payload, res, url);
  if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).authRequired === true) {
    error.authRequired = true;
    authRequiredHandler?.();
  }
  return error;
}

async function createInvalidJsonResponseError(res: Response, url: string): Promise<ApiError> {
  const payload = await readErrorPayload(res);
  const error = new ApiError(
    'The server returned an invalid response. Please refresh and try again.',
    res.status,
    'api.invalid_json_response',
  );
  error.diagnostic = {
    ...buildApiErrorDiagnostic(payload, res, url),
    code: 'api.invalid_json_response',
  };
  return error;
}

async function readErrorPayload(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  const text = await res.text().catch(() => '');
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatApiErrorMessage(payload: unknown, res: Response, url: string): string {
  if (typeof payload === 'string' && payload.trim()) {
    const text = payload.trim();
    if (isRawInfrastructureErrorBody(text)) return formatHttpFallbackMessage(res, url);
    return redactSensitiveText(text);
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const errorText = payloadMessageText(record.error);
    if (errorText && !isRawInfrastructureErrorBody(errorText)) return redactSensitiveText(errorText);
    const messageText = payloadMessageText(record.message);
    if (messageText && !isRawInfrastructureErrorBody(messageText)) return redactSensitiveText(messageText);
    if ((errorText && isRawInfrastructureErrorBody(errorText)) || (messageText && isRawInfrastructureErrorBody(messageText))) {
      return formatHttpFallbackMessage(res, url);
    }
  }

  return formatHttpFallbackMessage(res, url);
}

function payloadMessageText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  return value.trim();
}

function formatHttpFallbackMessage(res: Response, url: string): string {
  const status = `${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
  if (res.status === 504 && url.includes('/api/extract')) {
    return 'Reading documents took too long. The app may still be finishing in the background; refresh the matter in a minute, then run needed preparation if needed.';
  }
  if (res.status === 504) {
    return 'This request took too long. Please refresh and retry in a minute.';
  }
  if (res.status >= 500) {
    return `The server could not complete this request (${status}). Please retry in a minute.`;
  }
  return `The server rejected this request (${status}). Please check the form and try again.`;
}

function apiErrorCode(payload: unknown, res: Response, url: string): string | undefined {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>).code;
    if (typeof value === 'string' && isSafeApiErrorCode(value)) return value.trim();
  }
  if (res.status === 504 && url.includes('/api/extract')) return 'preparation.extract_timeout';
  if (res.status === 504) return 'http.gateway_timeout';
  if (res.status >= 500) return 'http.server_error';
  if (res.status === 401) return 'auth.login_required';
  if (res.status === 403) return 'auth.forbidden';
  return undefined;
}

function isSafeApiErrorCode(value: string): boolean {
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(value.trim());
}

function isHtmlErrorBody(text: string): boolean {
  return /^<!doctype\s+html/i.test(text) || /<\/?(html|head|body|title|h1|center)\b/i.test(text);
}

function isRawInfrastructureErrorBody(text: string): boolean {
  if (isHtmlErrorBody(text)) return true;
  return /^\s*(?:\d{3}\s+)?(?:Gateway Time-?out|Bad Gateway)\b/i.test(text) || /\bnginx\/\d/i.test(text);
}

function buildApiErrorDiagnostic(payload: unknown, res: Response, url: string): ApiErrorDiagnostic {
  const diagnostic: ApiErrorDiagnostic = {
    statusCode: res.status,
    code: apiErrorCode(payload, res, url),
    statusText: res.statusText || undefined,
    urlPath: urlPathForDiagnostic(url),
    bodyKind: errorBodyKind(payload),
  };
  if (typeof payload === 'string') {
    const title = payload.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
    if (title) diagnostic.htmlTitle = title.slice(0, 120);
  }
  return diagnostic;
}

function errorBodyKind(payload: unknown): ApiErrorDiagnostic['bodyKind'] {
  if (payload == null || payload === '') return 'empty';
  if (typeof payload === 'string') return isHtmlErrorBody(payload) ? 'html' : 'text';
  return 'json';
}

function urlPathForDiagnostic(url: string): string {
  try {
    const parsed = new URL(url, 'http://matter-workbench.local');
    const queryKeys = Array.from(new Set(parsed.searchParams.keys()));
    const queryText = queryKeys.map((key) => `${encodeURIComponent(key)}=[redacted]`).join('&');
    return `${parsed.pathname}${queryText ? `?${queryText}` : ''}`.slice(0, 220);
  } catch {
    return redactSensitiveText(String(url || '')).replace(/\?.*$/, '?[redacted]').slice(0, 220);
  }
}

function withQuery(path: string, query: Record<string, string | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

function withCacheBust(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${url}${separator}${CONFIG_CACHE_BUSTER_PARAM}=${encodeURIComponent(token)}`;
}

const TECHNICAL_PREFIXES = ['01_Admin', '02_Extracts', '99_'];

export interface AdaptedFile {
  name: string;
  path: string;
  type: 'file' | 'folder';
  ext?: string;
  canonical?: string;
  lane?: string;
  children?: AdaptedFile[];
  isTechnical?: boolean;
  size?: number;
  previewable?: boolean;
  previewKind?: string | null;
}

function adaptTreeNode(node: WorkspaceApiNode, depth = 0): AdaptedFile {
  const isDir = node.kind === 'directory';
  const ext = isDir ? undefined : node.name.split('.').pop()?.toLowerCase();
  const laneLabel = depth === 0 && isDir ? workspaceLaneLabel(node.name) : undefined;
  const isTechnical = depth === 0 && TECHNICAL_PREFIXES.some((p) => node.name.startsWith(p));
  const displayChildren = isDir ? displayWorkspaceChildren(node, depth, laneLabel) : [];
  return {
    name: laneLabel || node.name,
    path: node.path,
    type: isDir ? 'folder' : 'file',
    ext,
    canonical: laneLabel ? node.name : undefined,
    lane: laneLabel,
    children: isDir && displayChildren.length ? displayChildren.map((c) => adaptTreeNode(c, depth + 1)) : undefined,
    isTechnical,
    size: node.size,
    previewable: node.previewable,
    previewKind: node.previewKind,
  };
}

function displayWorkspaceChildren(node: WorkspaceApiNode, depth: number, laneLabel?: string): WorkspaceApiNode[] {
  if (!node.children?.length) return [];
  if (depth !== 0 || !laneLabel) return node.children;
  return node.children.flatMap((child) => (
    child.kind === 'directory' && child.name === laneLabel && child.children?.length
      ? child.children
      : [child]
  ));
}

export function adaptTree(raw: WorkspaceApiNode): { name: string; path: string; children: AdaptedFile[] } {
  return {
    name: raw.name,
    path: raw.path,
    children: raw.children ? raw.children.map((c) => adaptTreeNode(c, 0)) : [],
  };
}

export const api = {
  // ─── Private beta auth ───────────────────
  getAuthStatus: () => getJson<{ enabled: boolean; authenticated: boolean; user: AuthUser | null }>('/api/auth/status'),
  login: (body: { username: string; password: string }) =>
    postJson<{ enabled: boolean; authenticated: boolean; user: AuthUser | null }>('/api/auth/login', body),
  logout: () => postJson<{ enabled: boolean; authenticated: boolean; user: null }>('/api/auth/logout'),
  getPrivateBetaUsers: () => getJson<PrivateBetaUserList>('/api/private-beta/users'),
  createPrivateBetaTester: (body: PrivateBetaUserCreateRequest) =>
    postJson<PrivateBetaUserResponse>('/api/private-beta/users', body),
  resetPrivateBetaTesterPassword: (username: string) =>
    postJson<PrivateBetaUserResponse>(`/api/private-beta/users/${encodeURIComponent(username)}/reset-password`, {}),
  disablePrivateBetaTester: (username: string) =>
    postJson<PrivateBetaUserResponse>(`/api/private-beta/users/${encodeURIComponent(username)}/disable`, {}),
  enablePrivateBetaTester: (username: string) =>
    postJson<PrivateBetaUserResponse>(`/api/private-beta/users/${encodeURIComponent(username)}/enable`, {}),

  // ─── Config ──────────────────────────────
  getConfig: () => getJson<AppConfig>('/api/config', { bypassCache: true }),
  getSystemHealth: () => getJson<SystemHealthReport>('/api/system-health'),
  getUserReadiness: () => getJson<UserReadinessReport>('/api/user-readiness'),
  setConfig: (body: { mattersHome: string }) => postJson('/api/config', body),

  // ─── Matters ─────────────────────────────
  getMatters: (opts: { includeArchived?: boolean } = {}) =>
    getJson<{ matters: Array<{ name: string; status?: string; archivedAt?: string; archiveReason?: string; archivedBy?: string; archivedByDisplayName?: string }> }>(withQuery('/api/matters', { includeArchived: opts.includeArchived ? '1' : undefined })),
  archiveMatter: (name: string, opts: { reason?: string } = {}) => postJson<{ matter: { name: string; status?: string; archivedAt?: string; archiveReason?: string; archivedBy?: string; archivedByDisplayName?: string }; active: string | null; message?: string }>('/api/matters/archive', { name, reason: opts.reason || '' }),
  reopenMatter: (name: string) => postJson<{ matter: { name: string; status?: string; archivedAt?: string; archiveReason?: string; archivedBy?: string; archivedByDisplayName?: string }; active: string | null; message?: string }>('/api/matters/reopen', { name }),
  newMatter: (formData: FormData) => postFormData<WorkspaceApiResponse>('/api/matters/new', formData),
  addFiles: (formData: FormData) => postFormData<AddFilesResponse>('/api/matters/add-files', formData),
  createUploadSession: (body: UploadSessionCreateRequest) => postJson<UploadSession>('/api/upload-sessions', body),
  getUploadSession: (sessionId: string) => getJson<UploadSession>(`/api/upload-sessions/${encodeURIComponent(sessionId)}`),
  uploadSessionFile: (sessionId: string, formData: FormData) => postFormData<UploadSession>(`/api/upload-sessions/${encodeURIComponent(sessionId)}/files`, formData),
  commitUploadSession: (sessionId: string) => postJson<WorkspaceApiResponse & AddFilesResponse>(`/api/upload-sessions/${encodeURIComponent(sessionId)}/commit`),
  cancelUploadSession: (sessionId: string) => postJson<UploadSession>(`/api/upload-sessions/${encodeURIComponent(sessionId)}/cancel`),
  checkOverlap: (body: CheckOverlapRequest) => postJson<CheckOverlapResponse>('/api/matters/check-overlap', body),
  switchMatter: (name: string) => postJson<WorkspaceApiResponse>('/api/switch-matter', { name }),
  clearActiveMatter: () => postJson('/api/active-matter/clear'),

  // ─── Workspace ───────────────────────────
  getWorkspace: (matterName?: string) => getJson<WorkspaceApiResponse>(withQuery('/api/workspace', { matter: matterName })),
  getFile: (path: string, matterName?: string) => getJson<{ content: string; ext: string }>(withQuery('/api/file', { path, matter: matterName })),
  getFileRawUrl: (path: string, matterName?: string) => withQuery('/api/file-raw', { path, matter: matterName }),

  // ─── AI Settings ─────────────────────────
  getAiSettings: () => getJson<AiSettings>('/api/ai-settings'),
  saveAiSettings: (body: AiSettingsSaveRequest) => postJson<AiSettings>('/api/ai-settings', body),
  testAiSettings: (body: AiSettingsTestRequest) => postJson<AiSettingsTestResponse>('/api/ai-settings/test', body),

  // ─── Skills ──────────────────────────────
  getSkills: () => getJson<SkillRegistry>('/api/skills'),
  checkIntent: (body: { userRequest: string; matterName?: string; overrideJustification?: string }) =>
    postJson<SkillRouterDecision>('/api/skills/check-intent', body),

  // ─── Matter workflow ──────────────────────
  getJobs: (query: JobListQuery = 100) => {
    if (typeof query === 'number') return getJson<JobStatusList>(`/api/jobs?limit=${query}`);
    return getJson<JobStatusList>(withQuery('/api/jobs', {
      limit: String(query.limit ?? 100),
      matter: query.matterName || query.matter,
      kind: query.kind,
      status: query.status,
    }));
  },
  retryNativeSkillJob: (body: NativeSkillRetryRequest) => {
    const skill = String(body.slash || '').replace(/^\/+/, '');
    return postJson<NativeSkillRunResult>(`/api/skill/${encodeURIComponent(skill)}/run`, body);
  },
  getMatterLog: (limit = 100, matterName?: string) => getJson<MatterLog>(withQuery('/api/matter-log', { limit: String(limit), matter: matterName })),
  getPrivateBetaFeedback: (limit = 100) => getJson<PrivateBetaFeedbackList>(`/api/private-beta/feedback?limit=${limit}`),
  submitPrivateBetaFeedback: (body: PrivateBetaFeedbackRequest) =>
    postJson<PrivateBetaFeedbackResponse>('/api/private-beta/feedback', body),
  syncPrivateBetaFeedback: () => postJson<PrivateBetaFeedbackSyncResult>('/api/private-beta/feedback/sync', {}),
  capturePrivateBetaClientSignal: (body: PrivateBetaClientSignalRequest) =>
    postJson<PrivateBetaClientSignalResponse>('/api/private-beta/signals/client-events', body),
  getMatterStatus: (matterName?: string) => getJson<MatterStatus>(withQuery('/api/matter-status', { matter: matterName })),
  getMatterAttention: (matterName?: string) => getJson<MatterAttention>(withQuery('/api/matter-attention', { matter: matterName })),
  getPrepareMatter: (matterName?: string) => getJson<PreparationPlan>(withQuery('/api/prepare-matter', { matter: matterName })),
  queueNeededPreparation: (body: PreparationQueueRunRequest) =>
    postJson<PreparationQueueRunResponse>('/api/prepare-matter/run', body),
  recordPreparationRunTelemetry: (body: PreparationRunTelemetryRequest) =>
    postJson<PreparationRunTelemetryResponse>('/api/private-beta/preparation-runs', body),
  runMatterInit: (body: MatterSkillRunRequest) => postJson('/api/matter-init', body),
  runExtract: (body: MatterSkillRunRequest) => postJson<ExtractRunResult>('/api/extract', body),
  runDescribeSources: (body: MatterSkillRunRequest) => postJson<DescribeSourcesResult>('/api/describe-sources', body),
  runCreateListOfDates: (body: MatterSkillRunRequest) => postJson<ListOfDatesRunResult>('/api/create-listofdates', body),
  refreshListOfDatesLabels: (body: MatterSkillRunRequest & { dryRun?: boolean }) => postJson<ListOfDatesRunResult>('/api/create-listofdates/refresh-labels', body),
  runMatterStory: (body: MatterSkillRunRequest & { overwrite?: boolean }) => postJson<MatterStoryRunResult>('/api/matter-story', body),
  getProceduralPostureDiagnosis: (matterName?: string) => getJson<ProceduralPostureDiagnosisResult>(withQuery('/api/procedural-posture-diagnosis', { matter: matterName })),
  runProceduralPostureDiagnosis: (body: MatterSkillRunRequest & { overwrite?: boolean }) => postJson<ProceduralPostureDiagnosisResult>('/api/procedural-posture-diagnosis', body),
  confirmProceduralPostureDiagnosis: (body: MatterSkillRunRequest & { decision: 'confirmed' | 'corrected' | 'not_sure' | string; reasonOrCorrection?: string; actor?: string }) =>
    postJson<ProceduralPostureDiagnosisResult>('/api/procedural-posture-diagnosis/confirmation', body),
  getRerunAdvice: (skill: string, matterName?: string) => getJson<RerunAdvice>(withQuery('/api/rerun-advice', { skill, matter: matterName })),
  runDoctorScan: (body: MatterSkillRunRequest) => postJson<DoctorScanResult>('/api/doctor/scan', body),
  runDoctorFix: (body: DoctorFixRequest) => postJson<DoctorFixResult>('/api/doctor/fix', body),
  getSourceRemovalImpactPreview: (fileId: string, matterName?: string) => getJson<SourceRemovalImpactPreview>(withQuery('/api/source-removal-impact-preview', { fileId, matter: matterName })),
  removeSourceFromActiveRecord: (body: { matterName?: string; fileId: string; reason: string; idempotencyKey: string }) =>
    postJson<SourceRemovalResult>('/api/source-removal/remove-from-active-record', body),
  getMatterContext: (matterName?: string) => getJson<MatterContextPreview>(withQuery('/api/matter-context', { matter: matterName })),
  searchMatterContext: (query: string, matterName?: string) => getJson<MatterContextSearchResponse>(withQuery('/api/matter-context/search', { q: query, matter: matterName })),
  answerMatterQuestion: (body: { question: string; matterName?: string; conversation?: MatterCopilotConversationTurn[] }) =>
    postJson<MatterCopilotAnswer>('/api/matter-copilot/answer', body),
  researchMatterQuestion: (body: { question: string; matterName?: string }) =>
    postJson<MatterCopilotResearchAnswer>('/api/matter-copilot/research', body),

  // ─── Configurable skills ─────────────────
  getConfigurableSkills: () => getJson<{ skills: ConfigurableSkill[] }>('/api/configurable-skills'),
  updateConfigurableSkillLifecycle: (skillId: string, body: ConfigurableSkillLifecycleRequest) =>
    postJson<ConfigurableSkillLifecycleResponse>(`/api/configurable-skills/${encodeURIComponent(skillId)}/lifecycle`, body),
  runConfigurableSkill: (body: ConfigurableSkillRunRequest) => postJson<ConfigurableSkillRunResult>('/api/configurable-skills/run', body),
  getSkillRuns: (limit = 100) => getJson<{ schema_version?: string; runs: SkillRun[] }>(`/api/configurable-skills/runs?limit=${limit}`),
  cancelSkillRun: (body: ConfigurableSkillCancelRequest) => postJson('/api/configurable-skills/runs/cancelled', body),

  // ─── Skill factory ────────────────────────
  getSkillFactoryHealth: () => getJson<SkillFactoryHealth>('/api/skill-factory-health'),
  getSkillIdeas: () => getJson<{ schema_version?: string; ideas: SkillIdea[] }>('/api/skill-ideas'),
  createSkillIdea: (body: SkillIdeaCreateRequest) => postJson<SkillIdeaCreateResponse>('/api/skill-ideas', body),
  planSkillIdeaInterview: (body: SkillInterviewPlanRequest) => postJson<SkillInterviewPlanResponse>('/api/skill-ideas/plan-interview', body),
  generateSampleOutput: (body: SkillSampleOutputRequest) => postJson<SkillSampleOutputResponse>('/api/skill-ideas/sample-output', body),
  getSkillIdeaSamples: (ideaId: string) => getJson<{ schema_version?: string; samples: SkillIdeaSample[] }>(`/api/skill-ideas/${ideaId}/samples`),
  updateSkillIdeaBrief: (ideaId: string, body: SkillIdeaDesignBriefUpdateRequest) =>
    postJson<SkillIdeaCreateResponse>(`/api/skill-ideas/${ideaId}/design-brief`, body),
  updateSkillIdeaStatus: (ideaId: string, body: SkillIdeaStatusUpdateRequest) =>
    postJson<SkillIdeaCreateResponse>(`/api/skill-ideas/${ideaId}/status`, body),
  approveSkillIdeaSample: (ideaId: string, sampleId: string) =>
    postJson<SkillIdeaSampleApprovalResponse>(`/api/skill-ideas/${ideaId}/samples/${sampleId}/approve`),
  createSkillFromIdea: (ideaId: string, body?: { overlapOverrideJustification?: string; matterName?: string }) =>
    postJson<ConfigurableSkillCreateResponse>(`/api/skill-ideas/${ideaId}/create-skill`, body || {}),

  // ─── Logging ─────────────────────────────
  logCommandInteraction: (body: CommandInteractionRequest) => postJson('/api/command-interactions', body),
};

export function isAuthRequiredError(error: unknown): boolean {
  return Boolean(error instanceof ApiError && error.authRequired);
}

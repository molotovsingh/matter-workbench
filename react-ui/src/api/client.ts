import type {
  AiSettings,
  AiSettingsSaveRequest,
  AiSettingsTestRequest,
  AiSettingsTestResponse,
  AppConfig,
  CheckOverlapRequest,
  CheckOverlapResponse,
  ConfigurableSkill,
  ConfigurableSkillCancelRequest,
  ConfigurableSkillCreateResponse,
  ConfigurableSkillRunRequest,
  ConfigurableSkillRunResult,
  CommandInteractionRequest,
  DescribeSourcesResult,
  DoctorFixRequest,
  DoctorFixResult,
  DoctorScanResult,
  ExtractRunResult,
  ListOfDatesRunResult,
  MatterSkillRunRequest,
  MatterContextPreview,
  MatterContextSearchResponse,
  MatterAttention,
  MatterStatus,
  PreparationPlan,
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
  WorkspaceApiNode,
  WorkspaceApiResponse,
} from '../types';

class ApiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
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
  const res = await fetch(url, { method: 'POST', body: formData });
  return parseJsonResponse<T>(res, url);
}

async function parseJsonResponse<T>(res: Response, url: string): Promise<T> {
  if (!res.ok) {
    throw await createApiError(res, url);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function createApiError(res: Response, url: string): Promise<ApiError> {
  const payload = await readErrorPayload(res);
  return new ApiError(formatApiErrorMessage(payload, res, url), res.status);
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
  if (typeof payload === 'string' && payload.trim()) return payload.trim();

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
    if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  }

  return `${url} returned ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
}

const LANE_LABELS: Record<string, string> = {
  '00_Inbox': 'Original Documents',
  '10_Library': 'Source Record',
  '20_Workshop': 'Case Analysis',
  '30_Drafts': 'Drafts',
  '40_Dispatch': 'Ready to Send',
};

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
}

function adaptTreeNode(node: WorkspaceApiNode, depth = 0): AdaptedFile {
  const isDir = node.kind === 'directory';
  const ext = isDir ? undefined : node.name.split('.').pop()?.toLowerCase();
  const laneLabel = depth === 0 && isDir ? LANE_LABELS[node.name] : undefined;
  const isTechnical = depth === 0 && TECHNICAL_PREFIXES.some((p) => node.name.startsWith(p));
  return {
    name: laneLabel || node.name,
    path: node.path,
    type: isDir ? 'folder' : 'file',
    ext,
    canonical: laneLabel ? node.name : undefined,
    lane: laneLabel,
    children: isDir && node.children ? node.children.map((c) => adaptTreeNode(c, depth + 1)) : undefined,
    isTechnical,
    size: node.size,
  };
}

export function adaptTree(raw: WorkspaceApiNode): { name: string; path: string; children: AdaptedFile[] } {
  return {
    name: raw.name,
    path: raw.path,
    children: raw.children ? raw.children.map((c) => adaptTreeNode(c, 0)) : [],
  };
}

export const api = {
  // ─── Config ──────────────────────────────
  getConfig: () => getJson<AppConfig>('/api/config'),
  setConfig: (body: { mattersHome: string }) => postJson('/api/config', body),

  // ─── Matters ─────────────────────────────
  getMatters: () => getJson<{ matters: Array<{ name: string }> }>('/api/matters'),
  newMatter: (formData: FormData) => postFormData('/api/matters/new', formData),
  addFiles: (formData: FormData) => postFormData('/api/matters/add-files', formData),
  checkOverlap: (body: CheckOverlapRequest) => postJson<CheckOverlapResponse>('/api/matters/check-overlap', body),
  switchMatter: (name: string) => postJson<WorkspaceApiResponse>('/api/switch-matter', { name }),
  clearActiveMatter: () => postJson('/api/active-matter/clear'),

  // ─── Workspace ───────────────────────────
  getWorkspace: () => getJson<WorkspaceApiResponse>('/api/workspace'),
  getFile: (path: string) => getJson<{ content: string; ext: string }>(`/api/file?path=${encodeURIComponent(path)}`),
  getFileRawUrl: (path: string) => `/api/file-raw?path=${encodeURIComponent(path)}`,

  // ─── AI Settings ─────────────────────────
  getAiSettings: () => getJson<AiSettings>('/api/ai-settings'),
  saveAiSettings: (body: AiSettingsSaveRequest) => postJson('/api/ai-settings', body),
  testAiSettings: (body: AiSettingsTestRequest) => postJson<AiSettingsTestResponse>('/api/ai-settings/test', body),

  // ─── Skills ──────────────────────────────
  getSkills: () => getJson<SkillRegistry>('/api/skills'),
  checkIntent: (body: { userRequest: string; matterName?: string }) =>
    postJson<SkillRouterDecision>('/api/skills/check-intent', body),

  // ─── Matter workflow ──────────────────────
  getMatterStatus: () => getJson<MatterStatus>('/api/matter-status'),
  getMatterAttention: () => getJson<MatterAttention>('/api/matter-attention'),
  getPrepareMatter: () => getJson<PreparationPlan>('/api/prepare-matter'),
  runMatterInit: (body: MatterSkillRunRequest) => postJson('/api/matter-init', body),
  runExtract: (body: MatterSkillRunRequest) => postJson<ExtractRunResult>('/api/extract', body),
  runDescribeSources: (body: MatterSkillRunRequest) => postJson<DescribeSourcesResult>('/api/describe-sources', body),
  runCreateListOfDates: (body: MatterSkillRunRequest) => postJson<ListOfDatesRunResult>('/api/create-listofdates', body),
  getRerunAdvice: (skill: string) => getJson<RerunAdvice>(`/api/rerun-advice?skill=${encodeURIComponent(skill)}`),
  runDoctorScan: (body: MatterSkillRunRequest) => postJson<DoctorScanResult>('/api/doctor/scan', body),
  runDoctorFix: (body: DoctorFixRequest) => postJson<DoctorFixResult>('/api/doctor/fix', body),
  getMatterContext: () => getJson<MatterContextPreview>('/api/matter-context'),
  searchMatterContext: (query: string) => getJson<MatterContextSearchResponse>(`/api/matter-context/search?q=${encodeURIComponent(query)}`),

  // ─── Configurable skills ─────────────────
  getConfigurableSkills: () => getJson<{ skills: ConfigurableSkill[] }>('/api/configurable-skills'),
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
  updateSkillIdeaBrief: (ideaId: string, body: SkillIdeaDesignBriefUpdateRequest) => postJson(`/api/skill-ideas/${ideaId}/design-brief`, body),
  updateSkillIdeaStatus: (ideaId: string, body: SkillIdeaStatusUpdateRequest) => postJson(`/api/skill-ideas/${ideaId}/status`, body),
  approveSkillIdeaSample: (ideaId: string, sampleId: string) =>
    postJson<SkillIdeaSampleApprovalResponse>(`/api/skill-ideas/${ideaId}/samples/${sampleId}/approve`),
  createSkillFromIdea: (ideaId: string) => postJson<ConfigurableSkillCreateResponse>(`/api/skill-ideas/${ideaId}/create-skill`),

  // ─── Logging ─────────────────────────────
  logCommandInteraction: (body: CommandInteractionRequest) => postJson('/api/command-interactions', body),
};

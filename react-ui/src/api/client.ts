import type {
  AiSettings,
  AppConfig,
  ConfigurableSkill,
  ConfigurableSkillRunResult,
  DescribeSourcesResult,
  DoctorFixResult,
  DoctorScanResult,
  ExtractRunResult,
  ListOfDatesRunResult,
  MatterContextPreview,
  MatterContextSearchResponse,
  MatterAttention,
  MatterStatus,
  PreparationPlan,
  SkillFactoryHealth,
  SkillIdea,
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
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(text, res.status);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(text, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function postFormData<T>(url: string, formData: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: formData });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(text, res.status);
  }
  return res.json() as Promise<T>;
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
  checkOverlap: (body: unknown) => postJson('/api/matters/check-overlap', body),
  switchMatter: (name: string) => postJson<WorkspaceApiResponse>('/api/switch-matter', { name }),
  clearActiveMatter: () => postJson('/api/active-matter/clear'),

  // ─── Workspace ───────────────────────────
  getWorkspace: () => getJson<WorkspaceApiResponse>('/api/workspace'),
  getFile: (path: string) => getJson<{ content: string; ext: string }>(`/api/file?path=${encodeURIComponent(path)}`),
  getFileRawUrl: (path: string) => `/api/file-raw?path=${encodeURIComponent(path)}`,

  // ─── AI Settings ─────────────────────────
  getAiSettings: () => getJson<AiSettings>('/api/ai-settings'),
  saveAiSettings: (body: unknown) => postJson('/api/ai-settings', body),
  testAiSettings: (body: unknown) => postJson<{ ok: boolean; error?: string }>('/api/ai-settings/test', body),

  // ─── Skills ──────────────────────────────
  getSkills: () => getJson<SkillRegistry>('/api/skills'),
  checkIntent: (body: { userRequest: string; matterName?: string }) =>
    postJson<{ intent: string; skillName?: string; suggestion?: string }>('/api/skills/check-intent', body),

  // ─── Matter workflow ──────────────────────
  getMatterStatus: () => getJson<MatterStatus>('/api/matter-status'),
  getMatterAttention: () => getJson<MatterAttention>('/api/matter-attention'),
  getPrepareMatter: () => getJson<PreparationPlan>('/api/prepare-matter'),
  runMatterInit: (body: unknown) => postJson('/api/matter-init', body),
  runExtract: (body: unknown) => postJson<ExtractRunResult>('/api/extract', body),
  runDescribeSources: (body: unknown) => postJson<DescribeSourcesResult>('/api/describe-sources', body),
  runCreateListOfDates: (body: unknown) => postJson<ListOfDatesRunResult>('/api/create-listofdates', body),
  getRerunAdvice: (skill: string) => getJson<{
    skill: string;
    state: string;
    shouldConfirm: boolean;
    artifactPath?: string;
    lastRunAt?: string;
    provider?: string;
    model?: string;
    message?: string;
    dependencyState?: string;
  }>(`/api/rerun-advice?skill=${encodeURIComponent(skill)}`),
  runDoctorScan: (body: unknown) => postJson<DoctorScanResult>('/api/doctor/scan', body),
  runDoctorFix: (body: unknown) => postJson<DoctorFixResult>('/api/doctor/fix', body),
  getMatterContext: () => getJson<MatterContextPreview>('/api/matter-context'),
  searchMatterContext: (query: string) => getJson<MatterContextSearchResponse>(`/api/matter-context/search?q=${encodeURIComponent(query)}`),

  // ─── Configurable skills ─────────────────
  getConfigurableSkills: () => getJson<{ skills: ConfigurableSkill[] }>('/api/configurable-skills'),
  runConfigurableSkill: (body: unknown) => postJson<ConfigurableSkillRunResult>('/api/configurable-skills/run', body),
  getSkillRuns: (limit = 100) => getJson<{ schema_version?: string; runs: SkillRun[] }>(`/api/configurable-skills/runs?limit=${limit}`),
  cancelSkillRun: (body: unknown) => postJson('/api/configurable-skills/runs/cancelled', body),

  // ─── Skill factory ────────────────────────
  getSkillFactoryHealth: () => getJson<SkillFactoryHealth>('/api/skill-factory-health'),
  getSkillIdeas: () => getJson<{ schema_version?: string; ideas: SkillIdea[] }>('/api/skill-ideas'),
  createSkillIdea: (body: unknown) => postJson<{ id: string }>('/api/skill-ideas', body),
  planSkillIdeaInterview: (body: unknown) => postJson<unknown>('/api/skill-ideas/plan-interview', body),
  generateSampleOutput: (body: unknown) => postJson<unknown>('/api/skill-ideas/sample-output', body),
  getSkillIdeaSamples: (ideaId: string) => getJson<{ samples: unknown[] }>(`/api/skill-ideas/${ideaId}/samples`),
  updateSkillIdeaBrief: (ideaId: string, body: unknown) => postJson(`/api/skill-ideas/${ideaId}/design-brief`, body),
  updateSkillIdeaStatus: (ideaId: string, body: unknown) => postJson(`/api/skill-ideas/${ideaId}/status`, body),
  approveSkillIdeaSample: (ideaId: string, sampleId: string) =>
    postJson(`/api/skill-ideas/${ideaId}/samples/${sampleId}/approve`),
  createSkillFromIdea: (ideaId: string) => postJson(`/api/skill-ideas/${ideaId}/create-skill`),

  // ─── Logging ─────────────────────────────
  logCommandInteraction: (body: unknown) => postJson('/api/command-interactions', body),
};

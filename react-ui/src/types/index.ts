export interface Matter {
  name: string;
  folderPath?: string;
  clientName?: string;
  matterType?: string;
  status?: string;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  type: 'file' | 'folder';
  ext?: string;
  canonical?: string;
  purpose?: string;
  lane?: string;
  children?: WorkspaceFile[];
  isTechnical?: boolean;
  size?: number;
}

export interface WorkspaceTree {
  name: string;
  path: string;
  children: WorkspaceFile[];
}

export interface AppConfig {
  mattersHome?: string;
  defaultMattersHome?: string;
  hasActiveMatter?: boolean;
  activeMatterName?: string;
  theme?: 'light' | 'dark';
}

export interface WorkspaceApiNode {
  name: string;
  kind: 'directory' | 'file';
  path: string;
  children?: WorkspaceApiNode[];
  size?: number;
  previewable?: boolean;
  previewKind?: string;
}

export interface WorkspaceApiResponse {
  folderName: string;
  inputLabel: string;
  metadata: MatterMetadata;
  fileCount: number;
  directoryCount: number;
  tree: WorkspaceApiNode;
}

export interface Skill {
  schema_version?: string;
  id: string;
  slash: string;
  title: string;
  category: string;
  product_surface?: string;
  purpose?: string;
  mode?: string;
  display?: {
    action?: string;
    artifact?: string;
    running?: string;
    complete?: string;
    pill?: string;
  };
  paid_provider_call?: boolean;
  matter_required?: boolean;
  rerun_guarded?: boolean;
  source_backed?: string;
  legal_setting_scope?: string;
  markdown_first?: boolean;
  outputs?: string[];
  inputs?: string[];
  upstream?: string[];
  downstream?: string[];
  default_lane?: string;
  runner_key?: string;
  version?: number;
}

export interface SkillRegistry {
  schema_version?: string;
  categories?: string[];
  principles?: Record<string, boolean>;
  skills: Skill[];
}

export interface ConfigurableSkill {
  id: string;
  title: string;
  description: string;
  slash: string;
  status?: string;
  createdAt?: string;
  lastRunAt?: string;
  runCount?: number;
}

export interface SkillRun {
  schema_version?: string;
  id: string;
  skillId?: string;
  slash?: string;
  title?: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  matterName?: string;
  matterFolder?: string;
  matterRoot?: string;
  outputPaths?: { markdown?: string; json?: string };
  aiRun?: { provider?: string; model?: string; task?: string };
  warnings?: string[];
  overwrite?: 'not_needed' | 'prompted' | 'approved' | 'cancelled' | string;
  errorMessage?: string;
}

export interface SkillIdea {
  id: string;
  text: string;
  status: 'incomplete' | 'ready_for_review' | 'parked' | 'dismissed';
  createdAt: string;
  updatedAt?: string;
  designBrief?: SkillIdeaDesignBrief;
  matter?: { matterName?: string; folderName?: string };
  readiness?: {
    state: string;
    ready: boolean;
    passedCount: number;
    totalCount: number;
    items?: Array<{ key: string; label: string; passed: boolean }>;
  };
  samples?: SkillIdeaSample[];
  sampleCount?: number;
}

export interface SkillIdeaDesignBrief {
  intendedUser?: string;
  problem?: string;
  expectedInputs?: string;
  expectedOutputArtifact?: string;
  targetLane?: string;
  paidPosture?: string;
  riskLevel?: string;
  notes?: string;
}

export interface SkillIdeaSample {
  id: string;
  ideaId: string;
  output: string;
  state: 'pending' | 'approved_current' | 'approved_stale' | 'stale';
  createdAt: string;
}

export interface PipelineStageAiRun {
  provider?: string;
  model?: string;
  returnedProvider?: string;
  returnedModel?: string;
}

export interface RerunAdvice {
  state: 'current' | 'stale' | 'missing' | 'failed' | 'missing_upstream' | string;
  reason?: string;
  shouldConfirm?: boolean;
  lastRunAt?: string;
  provider?: string;
  model?: string;
  newestInputPath?: string;
  dependencyState?: string;
}

export interface PipelineStage {
  name?: string;
  label: string;
  slash?: string;
  present: boolean;
  artifacts?: string[];
  aiRun?: PipelineStageAiRun;
  rerunAdvice?: RerunAdvice;
  paidProviderCall?: boolean;
  metrics?: { rows?: number };
  display?: { action?: string; artifact?: string; pill?: string; running?: string; complete?: string };
}

export interface MatterStatus {
  matterName: string;
  extractionComplete: boolean;
  completionPct: number;
  stages: PipelineStage[];
}

export interface AttentionSummary {
  state: 'blocked' | 'attention_needed' | 'clear' | string;
  blocker: number;
  warning: number;
  info: number;
}

export interface AttentionItem {
  id?: string;
  severity: 'blocker' | 'warning' | 'info';
  title: string;
  detail?: string;
  category?: string;
  action?: string;
  evidence?: Array<string | Record<string, unknown>>;
}

export interface MatterAttention {
  summary: AttentionSummary;
  items: AttentionItem[];
}

export interface MatterMetadata {
  clientName?: string;
  matterName?: string;
  oppositeParty?: string;
  matterType?: string;
  jurisdiction?: string;
  briefDescription?: string;
}

export interface CommandSuggestion {
  label: string;
  description: string;
  command: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  type: 'skill_run' | 'matter_switch' | 'skill_created' | 'command';
  title: string;
  detail?: string;
  matterName?: string;
  skillId?: string;
  status?: 'completed' | 'failed' | 'running';
}

export interface AiTask {
  task: string;
  label?: string;
  surface?: string;
  provider?: string;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number | null;
  fallback?: string;
  apiKeyConfigured?: boolean;
  modelConfigured?: boolean;
  ready: boolean;
  note?: string;
}

export interface AiSettings {
  provider: string | null;
  model?: string;
  apiKeyConfigured: boolean;
  maxOutputTokens?: number;
  envPath?: string;
  aiTasks?: AiTask[];
}

export interface SkillFactoryHealth {
  schema_version?: string;
  checkedAt?: string;
  state: 'ok' | 'warning' | 'error' | string;
  summary?: {
    ideas?: number;
    samples?: number;
    configurableSkills?: number;
    activeSkills?: number;
    errors?: number;
    warnings?: number;
  };
  checks?: Array<{ id: string; label: string; state: 'ok' | 'error' | 'warning' | string }>;
  issues?: Array<{ severity: 'error' | 'warning' | string; code: string; message: string }>;
  storePaths?: Record<string, string>;
}

export interface ConfigurableSkillRunResult {
  schema_version?: string;
  state: 'requires_overwrite' | 'written' | 'cancelled' | string;
  skill?: ConfigurableSkill;
  artifactPath?: string;
  markdown?: string;
  outputPaths?: { markdown?: string; json?: string };
  runId?: string;
  runRecord?: SkillRun;
  warnings?: string[];
}

export type ActiveTab = 'home' | 'skills' | 'activity' | 'settings';
export type ViewName =
  | 'home-landing'
  | 'matter-overview'
  | 'file-preview'
  | 'matter-init-result'
  | 'extract-result'
  | 'describe-sources-result'
  | 'list-of-dates-result'
  | 'context-preview-result'
  | 'context-search-result'
  | 'prepare-matter-result'
  | 'new-matter'
  | 'add-files';

export interface ActiveMatter {
  name: string;
  folderName?: string;
  folderPath: string;
  clientName?: string;
  matterType?: string;
  workspace?: WorkspaceTree;
  metadata?: MatterMetadata;
  fileCount?: number;
  directoryCount?: number;
}

export interface FilePreview {
  path: string;
  type: 'text' | 'pdf' | 'image';
  url?: string;
  content?: string;
  ext?: string;
}

export interface AppState {
  config: AppConfig | null;
  activeMatter: ActiveMatter | null;
  matters: Matter[];
  resumeMatterName: string | null;
  activeTab: ActiveTab;
  activeView: string;
  filePreview: FilePreview | null;
  theme: 'light' | 'dark';
  matterSearchQuery: string;
  showTechnicalFiles: boolean;
  activeFilePath: string | null;
  breadcrumbs: string;
  titleText: string;
  statusBar: string;
  terminalLines: string[];
  commandCopyText: string;
  isCommandRunning: boolean;
}

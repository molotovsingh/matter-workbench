import type { SkillIdeaStatus } from '../lib/skillIdeaStatuses';

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
  status: SkillIdeaStatus;
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

export type SkillIdeaTargetLane = '10_Library' | '20_Workshop' | '30_Drafts' | '40_Dispatch';
export type SkillIdeaPaidPosture = 'free' | 'paid' | 'unknown';
export type SkillIdeaRiskLevel = 'low' | 'medium' | 'high';

export interface SkillIdeaDesignBrief {
  intendedUser?: string;
  problem?: string;
  expectedInputs?: string;
  expectedOutputArtifact?: string;
  targetLane?: SkillIdeaTargetLane;
  paidPosture?: SkillIdeaPaidPosture;
  riskLevel?: SkillIdeaRiskLevel;
  notes?: string;
}

export interface SkillInterviewQuestion {
  id: string;
  label: string;
  help: string;
  examples: string[];
}

export interface SkillInterviewPlan {
  mode: 'new_skill' | 'adjacent_improvement' | 'modification_candidate' | string;
  target_skill: string;
  understood_summary: string;
  inferred_design_brief: SkillIdeaDesignBrief;
  default_assumptions: string[];
  questions: SkillInterviewQuestion[];
  open_questions: string[];
  risk_flags: string[];
}

export interface SkillInterviewPlanResponse {
  schema_version?: string;
  planner: {
    enabled: boolean;
    used: boolean;
    provider?: string;
    model?: string;
    fallback?: string;
    policyPromptVersion?: string;
    reason?: string;
  };
  plan: SkillInterviewPlan | null;
}

export interface SkillIdeaSample {
  id: string;
  ideaId: string;
  version?: number;
  createdAt: string;
  updatedAt?: string;
  approved?: boolean;
  approvedAt?: string;
  current?: boolean;
  sampleMarkdown?: string;
  output?: string;
  state: 'current' | 'approved_current' | 'approved_stale' | 'stale' | 'pending';
  warnings?: string[];
}

export interface SkillRouterDecision {
  decision: 'run_existing_skill'
    | 'modify_existing_skill'
    | 'create_or_modify_tuning'
    | 'adjacent_skill'
    | 'new_skill'
    | 'needs_user_approval'
    | 'override_requested'
    | string;
  recommended_action?: string;
  matched_skill?: string;
  matched_skill_card?: Skill | null;
  confidence?: number;
  reason?: string;
  user_gate_required?: boolean;
  user_gate_choices?: string[];
  suggested_next_action?: string;
  mece_violation?: boolean;
  legal_setting?: Record<string, string>;
  override_requires?: string[];
}

export interface SkillIdeaCreateResponse {
  schema_version?: string;
  idea: SkillIdea;
}

export interface SkillIdeaCreateRequest {
  text: string;
  designBrief?: SkillIdeaDesignBrief;
  matterName?: string;
}

export interface SkillSampleOutputResponse {
  schema_version?: string;
  sample_id: string;
  generated_at?: string;
  matter?: Record<string, unknown>;
  idea?: SkillIdea;
  feedback?: string;
  sample_markdown: string;
  warnings?: string[];
  storedSample?: SkillIdeaSample;
}

export interface SkillSampleOutputRequest {
  idea: SkillIdea;
  feedback?: string;
  previousSample?: string;
}

export interface SkillIdeaDesignBriefUpdateRequest {
  designBrief: SkillIdeaDesignBrief;
}

export interface SkillIdeaStatusUpdateRequest {
  status: SkillIdea['status'];
}

export interface SkillIdeaSampleApprovalResponse {
  schema_version?: string;
  sample: SkillIdeaSample;
}

export interface ConfigurableSkillCreateResponse {
  schema_version?: string;
  skill: ConfigurableSkill;
}

export interface OverlapWarning {
  matterName: string;
  overlapCount: number;
  totalIncoming: number;
  matterTotalFiles?: number;
  overlapPercent: number;
}

export interface CheckOverlapResponse {
  warnings: OverlapWarning[];
}

export interface CheckOverlapRequest {
  hashes: string[];
  proposedName?: string;
}

export interface PipelineStageAiRun {
  provider?: string;
  model?: string;
  returnedProvider?: string;
  returnedModel?: string;
}

export interface RerunAdvice {
  skill?: string;
  state: 'current' | 'stale' | 'missing' | 'failed' | 'missing_upstream' | string;
  reason?: string;
  shouldConfirm?: boolean;
  artifactPath?: string;
  lastRunAt?: string;
  provider?: string;
  model?: string;
  message?: string;
  newestInputPath?: string;
  dependencyState?: string;
}

export interface RerunAdviceAction {
  id: string;
  label: string;
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

export interface AiSettingsSaveRequest {
  provider?: string | null;
  apiKey?: string;
  model?: string;
  maxOutputTokens?: number;
}

export interface AiSettingsTestRequest {
  provider?: string | null;
  apiKey?: string;
  model?: string;
}

export interface AiSettingsTestResponse {
  ok: boolean;
  error?: string;
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

export interface MatterSkillRunRequest {
  matterName?: string;
}

export interface DoctorFixRequest extends MatterSkillRunRequest {
  issueIds: string[];
}

export interface ConfigurableSkillRunRequest {
  slash: string;
  overwrite?: boolean;
}

export interface ConfigurableSkillCancelRequest {
  runId?: string;
  skillId?: string;
  slash?: string;
  matterName?: string;
  reason?: string;
}

export interface SkillInterviewPlanRequest {
  skillIdea?: Partial<SkillIdea>;
  userRequest?: string;
  designBrief?: SkillIdeaDesignBrief;
}

export interface CommandInteractionRequest {
  command: string;
  matterName?: string;
}

export interface ExtractFileResult {
  file_id?: string;
  intake_id?: string;
  source_path?: string;
  original_name?: string;
  category?: string;
  status: string;
  engine?: string;
  notes?: string;
}

export interface ExtractRunResult {
  dryRun?: boolean;
  matterRoot?: string;
  engineVersion?: string;
  counts?: Record<string, number>;
  perIntake?: Array<Record<string, string | number>>;
  fileResults?: ExtractFileResult[];
  outputLines?: string[];
}

export interface SourceDescriptorRow {
  short_label?: string;
  display_label?: string;
  source_short_label?: string;
  source_label?: string;
  document_type?: string;
  needs_review?: boolean;
  warnings?: string[] | number;
  file_id?: string;
}

export interface DescribeSourcesResult {
  dryRun?: boolean;
  matterRoot?: string;
  engineVersion?: string;
  counts?: {
    recordsRead?: number;
    sourcePackets?: number;
    descriptors?: number;
  };
  outputPaths?: { directory?: string; json?: string };
  sources?: SourceDescriptorRow[];
  aiRun?: { provider?: string; model?: string; returnedProvider?: string; returnedModel?: string };
  outputLines?: string[];
}

export interface ChronologyEntry {
  date_iso?: string;
  date_text?: string;
  date?: string;
  event?: string;
  description?: string;
  event_type?: string;
  legal_relevance?: string;
  relevance?: string;
  source_label?: string;
  source_short_label?: string;
  source_path?: string;
  citation?: string;
  cluster_type?: string;
  supporting_sources?: Array<{
    source_label?: string;
    source_short_label?: string;
    original_name?: string;
    source_path?: string;
    citation?: string;
  }>;
}

export interface ListOfDatesRunResult {
  dryRun?: boolean;
  matterRoot?: string;
  engineVersion?: string;
  generationMode?: string;
  counts?: Record<string, number>;
  outputPaths?: { json?: string; csv?: string; markdown?: string; candidates?: string };
  entries?: ChronologyEntry[];
  outputLines?: string[];
}

export interface DoctorIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  fixDescription?: string;
  selected?: boolean;
}

export interface DoctorScanResult {
  issues?: DoctorIssue[];
}

export interface DoctorFixResult {
  applied?: Array<Record<string, unknown>>;
  failed?: Array<Record<string, unknown>>;
  remaining?: DoctorIssue[];
}

export interface MatterContextSource {
  source_id?: string;
  content_hash?: string;
  file_id?: string;
  source_label?: string;
  source_short_label?: string;
  document_type?: string;
  source_path?: string;
  needs_review?: boolean;
  sample_citations?: string[];
}

export interface MatterContextArtifact {
  path?: string;
  kind?: string;
  summary?: string;
  schema_version?: string;
  source_count?: number | null;
  entry_count?: number | null;
}

export interface MatterContextPreview {
  schema_version?: string;
  packet_schema_version?: string;
  generated_at?: string;
  matter?: { matter_name?: string; folder_name?: string; [key: string]: unknown };
  counts?: {
    file_registers?: number;
    registered_files?: number;
    sources?: number;
    evidence_blocks_included?: number;
    evidence_blocks_omitted?: number;
    library_artifacts?: number;
    warnings?: number;
  };
  limits?: { max_blocks?: number; omitted_blocks?: number; [key: string]: unknown };
  source_index_present?: boolean;
  warnings?: string[];
  library_artifacts?: MatterContextArtifact[];
  top_sources?: MatterContextSource[];
}

export interface MatterContextSearchResult {
  citation?: string;
  file_id?: string;
  page?: number | null;
  block_id?: string;
  source_label?: string;
  source_short_label?: string;
  document_type?: string;
  source_path?: string;
  snippet: string;
  match_terms?: string[];
}

export interface MatterContextSearchResponse {
  schema_version?: string;
  query?: string;
  counts?: Record<string, number>;
  warnings?: string[];
  results?: MatterContextSearchResult[];
}

export interface PreparationStage {
  id?: string;
  label: string;
  slash?: string;
  state: string;
  action?: 'run' | 'confirm_paid_run' | 'blocked' | 'skip_current' | 'recommend_review' | 'recommend_after_prepare' | 'recommend_separate_skill' | string;
  reason?: string;
  description?: string;
  artifacts?: string[];
  paidProviderCall?: boolean;
}

export interface PreparationPlan {
  matter?: { name?: string; folderName?: string };
  matterName?: string;
  stages: PreparationStage[];
  nextStep?: { state: string; label: string; message?: string; stage?: string; slash?: string } | null;
  metadata?: { complete?: boolean; missing?: string[] };
  metadataCheck?: { valid: boolean; missing?: string[] };
  downstream?: Record<string, unknown>;
  warnings?: string[];
}

export type ActiveTab = 'home' | 'skills' | 'activity' | 'settings';
export type ActiveView =
  | 'home'
  | 'new-matter'
  | 'add-files'
  | 'file-preview'
  | 'extract'
  | 'doctor'
  | 'context-search'
  | 'list-of-dates'
  | 'prepare-matter'
  | 'describe-sources'
  | 'context-preview';

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
  activeView: ActiveView;
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

import type { SkillIdeaStatus } from '../lib/skillIdeaStatuses';
import type { SkillSampleState } from '../lib/skillSampleStates';

export interface Matter {
  name: string;
  folderPath?: string;
  clientName?: string;
  matterType?: string;
  status?: string;
  archivedAt?: string;
  archiveReason?: string;
  archivedBy?: string;
  archivedByDisplayName?: string;
}

export interface AuthUser {
  username: string;
  role?: 'superuser' | 'operator' | 'tester' | string;
  displayName?: string;
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
  previewable?: boolean;
  previewKind?: string | null;
}

export interface WorkspaceTree {
  name: string;
  path: string;
  children: WorkspaceFile[];
}

export interface SystemHealthCheck {
  id: string;
  category: 'configuration' | 'provider' | 'runtime' | 'storage' | string;
  label: string;
  status: 'ok' | 'warning' | 'error' | string;
  message: string;
  detail?: string;
  recommendation?: string;
  evidence?: Array<Record<string, unknown>>;
}

export interface SystemHealthReport {
  schema_version?: 'system-health/v1' | string;
  generatedAt: string;
  status: 'ok' | 'warning' | 'error' | string;
  summary?: {
    ok?: number;
    warning?: number;
    error?: number;
    checks?: number;
    blockingIssues?: number;
  };
  runtime?: {
    storageMode?: string;
    nodeVersion?: string;
    appDir?: string;
  };
  checks: SystemHealthCheck[];
  recommendations?: string[];
}

export interface UserReadinessCheck {
  id: 'secure_session' | 'workspace_access' | 'matter_library' | 'document_services' | 'assistant_readiness' | string;
  label: string;
  status: 'ready' | 'checking' | 'attention' | string;
  message?: string;
}

export interface UserReadinessReport {
  schema_version?: 'user-readiness/v1' | string;
  generatedAt: string;
  status: 'ready' | 'degraded' | string;
  summary?: {
    total?: number;
    ready?: number;
    attention?: number;
  };
  checks: UserReadinessCheck[];
  userMessage?: string;
}

export interface AppConfig {
  mattersHome?: string;
  defaultMattersHome?: string;
  hasActiveMatter?: boolean;
  activeMatterName?: string;
  runtimeStorageMode?: 'filesystem' | 'postgres';
  workspaceModeLabel?: string;
  maxUploadBytes?: number;
  maxUploadFiles?: number;
  copilotWebResearchEnabled?: boolean;
  release?: {
    version?: string;
    codename?: string;
    label?: string;
    commit?: string;
    date?: string;
    note?: string;
  } | null;
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

export interface UploadSessionItem {
  id: string;
  fileIndex: number;
  relativePath: string;
  originalName: string;
  mimeType?: string;
  expectedSizeBytes?: number;
  receivedSizeBytes?: number;
  sha256?: string;
  status: 'pending' | 'uploaded' | 'verified' | 'committed' | 'failed' | 'cancelled' | string;
  errorCode?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UploadSession {
  id: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'verified' | 'committed' | 'partial_failed' | 'failed' | 'cancelled' | string;
  action: 'create_matter' | 'add_files' | string;
  matterName?: string;
  label?: string;
  expectedFileCount?: number;
  receivedFileCount?: number;
  expectedBytes?: number;
  receivedBytes?: number;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  committedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  items?: UploadSessionItem[];
}

export interface UploadSessionCreateRequest {
  action: 'create_matter' | 'add_files';
  name?: string;
  matterName?: string;
  label?: string;
  metadata?: Record<string, string>;
  expectedFileCount: number;
  expectedBytes?: number;
  idempotencyKey?: string;
}

export interface WorkspaceApiResponse {
  folderName: string;
  inputLabel: string;
  metadata: MatterMetadata;
  fileCount: number;
  directoryCount: number;
  tree: WorkspaceApiNode;
  uploadSession?: UploadSession;
  alreadyCommitted?: boolean;
}

export interface AddFilesResponse extends WorkspaceApiResponse {
  intakeAdded?: {
    intakeId?: string;
    intakeDirName?: string;
    receivedDate?: string;
    label?: string;
    scanned?: number;
    unique?: number;
    duplicatesInBatch?: number;
    duplicatesOfPrior?: number;
  };
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
  configurable?: boolean;
  status?: string;
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
  updatedAt?: string;
  lifecycle?: {
    statusChangedAt?: string;
    statusChangedBy?: string;
    reason?: string;
    previousStatus?: string;
  };
  lastRunAt?: string;
  runCount?: number;
}

export interface ConfigurableSkillLifecycleRequest {
  action: 'suspend' | 'resume' | 'archive' | 'restore' | 'delete';
  reason?: string;
}

export interface ConfigurableSkillLifecycleResponse {
  schema_version?: string;
  skill: ConfigurableSkill;
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
  outputAvailability?: { markdown?: 'present' | 'missing' | 'not_recorded' | 'unknown'; json?: 'present' | 'missing' | 'not_recorded' | 'unknown' };
  aiRun?: { provider?: string; model?: string; task?: string };
  warnings?: string[];
  overwrite?: 'not_needed' | 'prompted' | 'approved' | 'cancelled' | string;
  errorMessage?: string;
  receipt?: SkillRunReceipt;
}

export interface SkillRunReceipt {
  receiptState: 'running' | 'failed' | 'cancelled' | 'completed' | 'output_missing' | 'unknown';
  statusLabel: string;
  statusClass: string;
  resultText: string;
  needsAttention: boolean;
  isCompletedWork: boolean;
  canOpenOutput: boolean;
  outputFileStatus: 'present' | 'missing' | 'not_recorded' | 'unknown';
  outputFileStatusLabel: string;
}

export interface JobStageStatus {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled' | string;
  label?: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  provider?: string;
  model?: string;
  failureCode?: string;
  failureClass?: string;
  errorMessage?: string;
  summary?: string;
  salvageable?: boolean;
  aiRun?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface JobStatus {
  schema_version?: 'job-status/v1';
  id: string;
  kind: string;
  label: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | string;
  matterName?: string;
  matterId?: string;
  startedAt: string;
  updatedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  resultState?: string;
  summary?: string;
  outputPaths?: Partial<Record<'markdown' | 'json', string>>;
  outputAvailability?: Partial<Record<'markdown' | 'json', string>>;
  warnings?: string[];
  errorMessage?: string;
  errorCode?: string;
  failureClass?: string;
  stages?: JobStageStatus[];
  metadata?: Record<string, unknown>;
}

export interface JobStatusList {
  schema_version?: 'job-status-ledger/v1';
  jobs: JobStatus[];
}

export interface NativeSkillRetryRequest {
  slash: string;
  matterName?: string;
  retryOfJobId: string;
  retryStageId?: string;
}

export interface NativeSkillRunResult {
  accepted?: boolean;
  queued?: boolean;
  runId?: string;
  slash?: string;
  job?: JobStatus;
  receipt?: Record<string, unknown>;
}

export interface MatterLogActor {
  username?: string;
  displayName?: string;
  role?: string;
}

export interface MatterLogEntry {
  id: string;
  sourceLedger: 'matter_events' | 'job_status' | 'configurable_skill_runs' | string;
  sourceId: string;
  sourceSchemaVersion?: string;
  occurredAt: string;
  matterName?: string;
  matterId?: string;
  category: 'source_preparation' | 'generated_artifact' | 'skill_factory' | 'ledger_activity' | 'workflow_job' | string;
  eventType: string;
  title: string;
  summary: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown' | string;
  custodyGrade: 'canonical_event' | 'projection' | string;
  canonical: boolean;
  actor?: MatterLogActor;
  route?: string;
  details?: Record<string, unknown>;
}

export interface MatterLog {
  schema_version?: 'matter-log/v0-readonly' | string;
  status: 'best_effort_projection' | string;
  generatedAt: string;
  matterName?: string;
  summary?: {
    entries?: number;
    sourceLedgers?: string[];
    canonicalEvents?: boolean;
  };
  limitations?: string[];
  entries: MatterLogEntry[];
}

export type PrivateBetaFeedbackChoice = 'did_not_work' | 'confused' | 'want_something';

export interface PrivateBetaFeedbackContext {
  screen?: string;
  route?: string;
  currentView?: string;
  activeMatterName?: string;
  activeMatterFolder?: string;
  lastCommand?: string;
  lastAction?: string;
  runtimeMode?: string;
  appVersion?: string;
  commit?: string;
  viewport?: string;
  visibleError?: string;
  recentActivity?: string[];
  providerRoutes?: Array<{ task?: string; provider?: string; model?: string }>;
  username?: string;
  displayName?: string;
  userRole?: string;
}

export interface PrivateBetaFeedbackRequest {
  choice: 'did_not_work' | 'confused' | 'want_something';
  tryingToDo: string;
  happenedInstead?: string;
  matterName?: string;
  context?: PrivateBetaFeedbackContext;
}

export interface PrivateBetaFeedbackSync {
  status: 'not_configured' | 'queued' | 'sent' | 'failed' | string;
  attempts: number;
  lastAttemptAt?: string;
  sentAt?: string;
  endpointHost?: string;
  lastError?: string;
}

export interface PrivateBetaFeedback {
  schema_version?: 'private-beta-feedback/v1';
  id: string;
  choice: 'did_not_work' | 'confused' | 'want_something';
  classification: 'bug' | 'confusing_ux' | 'feature_request' | 'feature_idea' | 'legal_quality_concern' | 'blocked_workflow' | 'operator_note' | string;
  status: 'new' | 'reviewed' | 'needs_evidence' | 'fixed' | 'parked' | 'not_reproducible' | string;
  tryingToDo: string;
  happenedInstead?: string;
  createdAt: string;
  updatedAt?: string;
  context?: PrivateBetaFeedbackContext;
  sync?: PrivateBetaFeedbackSync;
}

export interface PrivateBetaFeedbackList {
  schema_version?: 'private-beta-feedback-ledger/v1';
  feedback: PrivateBetaFeedback[];
}

export interface PrivateBetaFeedbackResponse {
  schema_version?: 'private-beta-feedback-response/v1';
  feedback: PrivateBetaFeedback;
}

export interface PrivateBetaFeedbackSyncResult {
  schema_version?: 'private-beta-feedback-sync-result/v1';
  attempted: number;
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
}

export interface PrivateBetaClientSignalRequest {
  code: string;
  view?: string;
  action?: string;
  stage?: string;
  severity?: 'blocker' | 'warning' | 'info' | 'error' | string;
  category?: string;
  matterName?: string;
  fileCount?: number;
  sizeBucket?: string;
  errorClass?: string;
  errorMessage?: string;
}

export interface PrivateBetaClientSignalResponse {
  schema_version?: 'private-beta-signal-capture-result/v1';
  captured: number;
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
  signals?: Array<Record<string, unknown>>;
}

export interface PrivateBetaUser {
  username: string;
  displayName?: string;
  role: 'superuser' | 'operator' | 'tester' | string;
  disabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PrivateBetaUserList {
  schema_version?: 'private-beta-users-list/v1';
  users: PrivateBetaUser[];
}

export interface PrivateBetaUserCreateRequest {
  username: string;
  displayName?: string;
}

export interface PrivateBetaUserResponse {
  schema_version?: 'private-beta-user-response/v1';
  user: PrivateBetaUser;
  temporaryPassword?: string;
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
  state: SkillSampleState;
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
  matterName?: string;
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
  matterRoot?: string;
  matterName?: string;
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
  matterRoot?: string;
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

export interface MatterDescriptionSource {
  type?: string;
  author?: string;
  slash?: string;
  artifact?: string;
  basedOn?: string;
  basisArtifact?: string;
  updatedAt?: string;
}

export interface MatterMetadata {
  clientName?: string;
  matterName?: string;
  oppositeParty?: string;
  matterType?: string;
  jurisdiction?: string;
  briefDescription?: string;
  originalIntakeNote?: string;
  briefDescriptionSource?: MatterDescriptionSource | null;
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

export interface AiStartupCheck {
  ok: boolean;
  checkedAt?: string;
  latencyMs?: number;
  provider?: string;
  model?: string;
  error?: string;
  code?: string;
  statusCode?: number;
}

export interface CopilotModelPreset {
  label: string;
  shortLabel: string;
  provider: string;
  model: string;
}

export interface AiSettings {
  provider: string | null;
  model?: string;
  apiKeyConfigured: boolean;
  maxOutputTokens?: number;
  envPath?: string;
  aiTasks?: AiTask[];
  copilotModelPresets?: CopilotModelPreset[];
  startupChecks?: {
    copilot?: AiStartupCheck;
  };
}

export interface AiSettingsSaveRequest {
  provider?: string | null;
  apiKey?: string;
  model?: string;
  maxOutputTokens?: number;
  copilotProvider?: string;
  copilotModel?: string;
  copilotApiKey?: string;
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
  dryRun?: boolean;
  forceRefresh?: boolean;
}

export interface DoctorFixRequest extends MatterSkillRunRequest {
  issueIds: string[];
}

export interface ConfigurableSkillRunRequest {
  slash: string;
  overwrite?: boolean;
  matterName?: string;
}

export interface ConfigurableSkillCancelRequest {
  runId?: string;
  skillId?: string;
  slash?: string;
  artifactPath?: string;
  matterName?: string;
  reason?: string;
}

export interface SkillInterviewPlanRequest {
  skillIdea?: Partial<SkillIdea>;
  userRequest?: string;
  designBrief?: SkillIdeaDesignBrief;
  matterName?: string;
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
  original_name?: string;
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

export interface MatterStoryRunResult {
  schema_version?: string;
  state: 'updated' | 'skipped_nonblank' | 'skipped_empty_story' | 'skipped_missing_skill' | string;
  slash?: string;
  artifactPath?: string;
  description?: string;
  reason?: string;
  skillRunState?: string;
  runId?: string;
}

export interface ProceduralLegalRoute {
  route_number?: number;
  route_title?: string;
  route_summary?: string;
  when_to_use?: string;
  why_this_route?: string;
  court_or_forum?: string;
  statutory_references?: string[];
  what_to_confirm?: string[];
  priority?: string;
}

export interface ProceduralRecommendedRoute {
  route_number?: number;
  route_title?: string;
  recommendation?: string;
  reason?: string;
  next_step?: string;
}

export interface ProceduralPostureDiagnosisResult {
  schema_version?: string;
  state?: string;
  status?: string;
  artifactPath?: string;
  jsonPath?: string;
  qnaPath?: string;
  generatedAt?: string;
  diagnosisUpdatedAt?: string;
  caseTimelineUpdatedAt?: string;
  matterStoryUpdatedAt?: string;
  sourceIndexUpdatedAt?: string;
  blockedReasons?: string[];
  markdownPresent?: boolean;
  jsonPresent?: boolean;
  confirmation?: { state?: string; confirmed_at?: string; reason_or_correction?: string; actor?: string };
  courtForum?: { value?: string; confidence?: string; reason?: string } | null;
  proceduralPosture?: { value?: string; confidence?: string; reason?: string } | null;
  recommendedWorkingPath?: { filing_or_remedy?: string; reason?: string } | null;
  simpleCaseView?: string;
  legalRoutes?: ProceduralLegalRoute[];
  recommendedRoute?: ProceduralRecommendedRoute | null;
  nextBestActions?: string[];
  lawyerToConfirmCount?: number;
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
  matterRoot?: string;
  matterName?: string;
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
  source_count_total?: number | null;
  sources_suppressed?: number | null;
  entry_count?: number | null;
  entry_count_total?: number | null;
  entries_suppressed?: number | null;
}

export interface MatterContextPreview {
  schema_version?: string;
  matterRoot?: string;
  matterName?: string;
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
  matterRoot?: string;
  matterName?: string;
  query?: string;
  counts?: Record<string, number>;
  warnings?: string[];
  results?: MatterContextSearchResult[];
}

export interface MatterCopilotSource {
  raw_citation?: string;
  source_label?: string;
  snippet?: string;
}

export interface MatterCopilotPublicSource {
  id?: string;
  title?: string;
  url?: string;
  published_at?: string;
  source_type?: string;
  snippet?: string;
}

export interface MatterCopilotConversationTurn {
  role: 'user' | 'assistant';
  mode?: 'ask' | 'research' | string;
  content: string;
}

export interface MatterCopilotAnswer {
  schema_version?: string;
  matterRoot?: string;
  matterName?: string;
  answered_at?: string;
  question: string;
  answer_status: 'answered' | 'partial' | 'not_found' | 'blocked' | string;
  answer_markdown: string;
  confidence?: number;
  sources?: MatterCopilotSource[];
  warnings?: string[];
  matter?: { matter_name?: string; folder_name?: string; [key: string]: unknown };
  context?: {
    packet_schema_version?: string;
    evidence_blocks_included?: number;
    evidence_blocks_omitted?: number;
  };
  ai_run?: {
    provider?: string;
    model?: string;
    task?: string;
    tier?: string;
    policyPromptVersion?: string;
  };
}

export interface MatterCopilotResearchAnswer {
  schema_version?: string;
  question?: string;
  answer_status: 'answered' | 'partial' | 'not_found' | 'blocked' | 'failed' | string;
  answer_markdown: string;
  matter_sources?: MatterCopilotSource[];
  public_sources?: MatterCopilotPublicSource[];
  warnings?: string[];
  research?: { provider?: string; query?: string; result_count?: number; [key: string]: unknown };
  ai_run?: { provider?: string; model?: string; task?: string; tier?: string; [key: string]: unknown };
  matter?: { matter_name?: string; folder_name?: string; [key: string]: unknown };
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
  rerunAdvice?: RerunAdvice;
  metrics?: { rows?: number };
  aiRun?: PipelineStageAiRun | null;
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

export interface PreparationQueueRunRequest {
  matterName?: string;
  mode?: 'needed';
  reason?: string;
  runId?: string;
}

export interface PreparationQueueRunResponse {
  schema_version?: 'prepare-matter-run/v1' | string;
  state: 'queued' | 'complete' | 'blocked' | string;
  matterName?: string;
  mode?: 'needed' | string;
  kind?: string;
  stage?: PreparationStage;
  job?: JobStatus;
  alreadyQueued?: boolean;
  message?: string;
  plan?: PreparationPlan;
}

export type PreparationStepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface PreparationProgressStep {
  id: string;
  label: string;
  state: PreparationStepState;
  detail?: string;
}

export interface PreparationRunStatus {
  matterName: string;
  state: 'idle' | 'running' | 'prepared' | 'needs_review' | 'blocked';
  message?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  steps: PreparationProgressStep[];
}

export interface PreparationRunTelemetryRequest {
  action: 'start' | 'stage' | 'finish';
  runId: string;
  matterName?: string;
  mode?: 'needed' | 'full';
  status?: 'running' | 'succeeded' | 'prepared' | 'needs_review' | 'blocked' | 'failed';
  message?: string;
  error?: string;
  stage?: {
    id?: string;
    label?: string;
    status?: 'pending' | 'running' | 'succeeded' | 'done' | 'failed' | 'skipped';
    durationMs?: number;
    message?: string;
    detail?: string;
    diagnostic?: PreparationRunDiagnostic;
  };
  stages?: Array<string | {
    id?: string;
    label?: string;
    status?: 'pending' | 'running' | 'succeeded' | 'done' | 'failed' | 'skipped';
    durationMs?: number;
    message?: string;
    detail?: string;
    diagnostic?: PreparationRunDiagnostic;
  }>;
}

export interface PreparationRunDiagnostic {
  statusCode?: number;
  code?: string;
  statusText?: string;
  urlPath?: string;
  bodyKind?: 'html' | 'json' | 'text' | 'empty' | string;
  htmlTitle?: string;
}

export interface PreparationRunTelemetryResponse {
  schema_version: 'private-beta-preparation-run-response/v1';
  skipped?: boolean;
  job?: JobStatus;
}

export type ActiveTab = 'home' | 'skills' | 'activity' | 'settings';
export type ActiveView =
  | 'home'
  | 'find-matter'
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

export interface SourceRemovalImpactPreview {
  schema_version: string;
  file_id: string;
  can_remove?: boolean;
  action_label?: string;
  requires_reason?: boolean;
  physical_deletion?: boolean;
  source?: {
    file_id?: string;
    source_label?: string;
    source_short_label?: string;
    document_type?: string;
    source_path?: string;
  };
  active_context?: {
    source_records?: number;
    evidence_blocks?: number;
  };
  affected_artifacts?: Array<{
    family?: string;
    effect?: string;
    reference_count?: number;
    reason?: string;
  }>;
  warnings?: string[];
}

export interface SourceRemovalResult {
  schema_version: string;
  file_id: string;
  state: string;
  action_label?: string;
  physical_deletion?: boolean;
  event_id?: string;
  matterName?: string;
  matter_name?: string;
  affected_artifacts?: Array<{
    artifactFamily?: string;
    artifactPath?: string;
    state?: string;
    dependencyState?: string;
    reasonCode?: string;
  }>;
  warnings?: string[];
}

export interface PendingSkillsMatterAction {
  kind: 'native-workflow' | 'custom-skill' | 'skill-idea';
  label: string;
  command?: string;
  slash?: string;
  idea?: SkillIdea;
}

export interface AppToast {
  id: string;
  tone: 'success' | 'info' | 'warning';
  title: string;
  message?: string;
}

export interface AppState {
  config: AppConfig | null;
  authEnabled: boolean;
  authUser: AuthUser | null;
  activeMatter: ActiveMatter | null;
  matters: Matter[];
  resumeMatterName: string | null;
  pendingSkillIdeaResume: SkillIdea | null;
  pendingSkillsMatterAction: PendingSkillsMatterAction | null;
  skillsDataRefreshSeq: number;
  toast: AppToast | null;
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
  activityLines: string[];
  commandCopyText: string;
  isCommandRunning: boolean;
  preparationRun: PreparationRunStatus | null;
}

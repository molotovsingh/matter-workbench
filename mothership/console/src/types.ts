export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  authMode?: 'disabled' | 'password' | 'email_code';
  user: { username: string; role: string; displayName?: string } | null;
}

export interface InstallationRow {
  installationId: string;
  label: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  revokedAt: string | null;
  latestHeartbeatReceivedAt: string | null;
  recentSignalCount: number;
  recentFeedbackCount: number;
}

export interface InstallationsResponse {
  sinceDays: number;
  installations: InstallationRow[];
}

export interface MetricScores {
  backendSuitability?: number | null;
  portability?: number | null;
  restoreConfidence?: number | null;
  capacityHeadroom?: number | null;
  userPatienceRisk?: string | null;
}

export interface MetricSnapshot {
  id: string;
  installationId: string;
  capturedAt: string;
  receivedAt: string;
  deployment?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  latency?: { p95Ms?: number; silentWaitMaxMs?: number } | Record<string, unknown>;
  scores?: MetricScores;
}

export interface MetricsSummary {
  latest: MetricSnapshot | null;
  snapshots: MetricSnapshot[];
}

export interface HeartbeatJourney {
  user: string;
  matter: string;
  screen: string;
  route: string;
  lastAction: string;
  currentStage: string;
  currentStageStatus: string;
  traceId: string;
  jobId: string;
  lastError: string;
  patienceRisk: string;
}

export interface HeartbeatMatterHealth {
  matter: string;
  prepareState: string;
  nextStepLabel: string;
  attentionState: string;
  blockers: number;
  warnings: number;
  checkedAt: string;
}

export interface HeartbeatSnapshot {
  id: string;
  installationId: string;
  capturedAt: string;
  receivedAt: string;
  activeSessions: number;
  highestPatienceRisk: string;
  journeys: HeartbeatJourney[];
  matterHealth: HeartbeatMatterHealth[];
  counters: Record<string, unknown>;
}

export interface HeartbeatsSummary {
  latest: HeartbeatSnapshot | null;
  latestAgeMinutes: number | null;
  silentInstallations: number;
  latestByInstallation: HeartbeatSnapshot[];
  latestMatterHealth: unknown;
  jobEvidence: unknown[];
  snapshots: HeartbeatSnapshot[];
}

export interface TriageItem {
  id: string;
  kind: string;
  category: string;
  title: string;
  severity: string;
  action_lane: string;
  status: string;
  occurrenceCount: number;
  matterName: string;
  latestAt: string;
  receivedAt: string;
  sample: string;
  detail?: string;
  installationId?: string;
  user?: string;
  currentness?: string;
  recommended_action?: string;
  triageStatusUpdatedAt?: string | null;
  triageStatusActor?: string;
  triageStatusNote?: string;
  triageStatusHistoryCount?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
}

export const FEEDBACK_STATUSES = ['new', 'reviewed', 'needs_evidence', 'fixed', 'parked', 'not_reproducible'] as const;
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number];

export interface ReportSummary {
  criticalSignals: number;
  repeatedWarnings: number;
  bugs: number;
  confusingUx: number;
  featureRequests: number;
  featureIdeas: number;
  total: number;
  actionLanes: { fix_now: number; investigate: number; product_decision: number; watch: number };
  severity: { blocker: number; error: number; warning: number; info: number };
  latestBackendSuitability?: number | null;
  latestPortability?: number | null;
  latestUserPatienceRisk?: string | null;
  latestHeartbeatAgeMinutes?: number | null;
  silentInstallations?: number;
}

export interface MothershipReport {
  schema_version: string;
  generatedAt: string;
  sinceDays: number;
  summary: ReportSummary;
  metrics: MetricsSummary;
  heartbeats: HeartbeatsSummary;
  items: TriageItem[];
}

export type ViewKey = 'fleet' | 'installation' | 'triage';

import { routePrivateBetaFeedbackTriage } from "../services/private-beta-feedback-triage-service.mjs";
import { redactSensitiveText, redactSensitiveValues } from "../shared/secret-redaction.mjs";

const RELATED_SIGNAL_WINDOW_MS = 2 * 60 * 60 * 1000;
const PREPARATION_PIPELINE_RE = /no extraction records|run extract|source index|create_case_timeline|create_listofdates|case timeline|list of dates|label sources|source labels?/;
const ACTION_LANES = Object.freeze(["fix_now", "investigate", "product_decision", "watch"]);
const SEVERITIES = Object.freeze(["blocker", "error", "warning", "info"]);
const FEEDBACK_STATUSES = Object.freeze(["new", "reviewed", "needs_evidence", "fixed", "parked", "not_reproducible"]);

export function buildMothershipReport(dataset = {}, { generatedAt = new Date().toISOString() } = {}) {
  const metricSummary = summarizeMetrics(dataset.metrics || []);
  const heartbeatSummary = summarizeHeartbeats(dataset.heartbeats || [], generatedAt);
  const latestRuntimeEvidenceAt = latestEvidenceTime(metricSummary, heartbeatSummary);
  const rawSignalItems = (dataset.signals || []).map(signalReportItem);
  const signalItems = rawSignalItems
    .map((item) => attachRelatedJobs(item, heartbeatSummary.jobEvidence))
    .map((item) => annotateTriage(item, { latestRuntimeEvidenceAt, latestMatterHealth: heartbeatSummary.latestMatterHealth }))
    .map(attachWhatHappened);
  const feedbackItems = (dataset.feedback || [])
    .map(feedbackReportItem)
    .map((item) => attachRelatedSignals(item, rawSignalItems))
    .map((item) => attachRelatedJobs(item, heartbeatSummary.jobEvidence))
    .map((item) => annotateTriage(item, { latestRuntimeEvidenceAt, latestMatterHealth: heartbeatSummary.latestMatterHealth }))
    .map(attachWhatHappened);
  const items = [...signalItems, ...feedbackItems]
    .sort((left, right) => left.priority - right.priority
      || laneSort(left.action_lane) - laneSort(right.action_lane)
      || right.occurrenceCount - left.occurrenceCount
      || Date.parse(right.receivedAt || 0) - Date.parse(left.receivedAt || 0));

  return {
    schema_version: "mothership-development-report/v1",
    generatedAt,
    sinceDays: Number(dataset.sinceDays) || 30,
    summary: {
      criticalSignals: signalItems.filter((item) => item.category === "critical_signal").length,
      repeatedWarnings: signalItems.filter((item) => item.category === "warning_signal" && item.occurrenceCount > 1).length,
      bugs: feedbackItems.filter((item) => item.category === "bug").length,
      confusingUx: feedbackItems.filter((item) => item.category === "confusing_ux").length,
      featureRequests: feedbackItems.filter((item) => item.category === "feature_request").length,
      featureIdeas: feedbackItems.filter((item) => item.category === "feature_idea").length,
      total: items.length,
      actionLanes: actionLaneCounts(items),
      severity: severityCounts(items),
      latestBackendSuitability: metricSummary.latest?.scores?.backendSuitability,
      latestPortability: metricSummary.latest?.scores?.portability,
      latestUserPatienceRisk: metricSummary.latest?.scores?.userPatienceRisk,
      latestHeartbeatAgeMinutes: heartbeatSummary.latestAgeMinutes,
      silentInstallations: heartbeatSummary.silentInstallations,
    },
    metrics: metricSummary,
    heartbeats: heartbeatSummary,
    items,
  };
}

export function filterMothershipReport(report = {}, filters = {}) {
  const viewFilters = normalizeReportViewFilters(filters);
  if (!Object.keys(viewFilters).length) return report;

  const originalItems = Array.isArray(report.items) ? report.items : [];
  let items = originalItems
    .filter((item) => !viewFilters.action_lane || item.action_lane === viewFilters.action_lane)
    .filter((item) => !viewFilters.severity || item.severity === viewFilters.severity)
    .filter((item) => !viewFilters.status || item.status === viewFilters.status);
  if (viewFilters.limit) items = items.slice(0, viewFilters.limit);

  return {
    ...report,
    items,
    view: {
      schema_version: "mothership-report-view/v1",
      filters: viewFilters,
      totalBeforeFilter: originalItems.length,
      totalAfterFilter: items.length,
    },
  };
}

export function renderMothershipReportMarkdown(report = {}) {
  const actionLanes = report.summary?.actionLanes || {};
  const severity = report.summary?.severity || {};
  const lines = [
    "# Matter Workbench Beta Development Report",
    "",
    `Generated: ${report.generatedAt || ""}`,
    `Window: last ${report.sinceDays || 30} days`,
    "",
    "## Summary",
    "",
    `- Critical signals: ${report.summary?.criticalSignals || 0}`,
    `- Repeated warnings: ${report.summary?.repeatedWarnings || 0}`,
    `- Tester bugs: ${report.summary?.bugs || 0}`,
    `- Confusing UX: ${report.summary?.confusingUx || 0}`,
    `- Feature requests: ${report.summary?.featureRequests || 0}`,
    `- Legacy feature ideas: ${report.summary?.featureIdeas || 0}`,
    `- Blocker evidence: ${severity.blocker || 0}`,
    `- Error evidence: ${severity.error || 0}`,
    `- Warning evidence: ${severity.warning || 0}`,
    `- Info evidence: ${severity.info || 0}`,
    `- Fix now: ${actionLanes.fix_now || 0}`,
    `- Investigate: ${actionLanes.investigate || 0}`,
    `- Product decisions: ${actionLanes.product_decision || 0}`,
    `- Watch: ${actionLanes.watch || 0}`,
    "",
  ];
  if (report.metrics?.latest) {
    const latest = report.metrics.latest;
    lines.push(
      "## Deployment And Backend Metrics",
      "",
      `- Backend Suitability: ${latest.scores?.backendSuitability ?? "unknown"}/100`,
      `- Deployment Portability: ${latest.scores?.portability ?? "unknown"}/100`,
      `- Restore Confidence: ${latest.scores?.restoreConfidence ?? "unknown"}/100`,
      `- Capacity Headroom: ${latest.scores?.capacityHeadroom ?? "unknown"}/100`,
      `- User Patience Risk: ${latest.scores?.userPatienceRisk || "unknown"}`,
      `- P95 request latency: ${latest.latency?.p95Ms ?? 0}ms`,
      `- Max silent wait: ${latest.latency?.silentWaitMaxMs ?? 0}ms`,
      `- Disk free: ${latest.runtime?.diskFreePercent ?? "unknown"}%`,
      `- Received: ${latest.receivedAt || ""}`,
      "",
    );
  }
  if (report.heartbeats?.latestByInstallation?.length) {
    lines.push("## Heartbeats", "");
    for (const item of report.heartbeats.latestByInstallation.slice(0, 10)) {
      lines.push(`- ${redactReportText(item.installationId)}: last seen ${item.receivedAt || item.capturedAt || ""}; sessions ${item.activeSessions}; patience ${item.highestPatienceRisk}`);
    }
    lines.push("");
  }
  if (report.view?.filters) {
    lines.push(
      "## View",
      "",
      `- Items shown: ${report.view.totalAfterFilter ?? 0}/${report.view.totalBeforeFilter ?? 0}`,
      `- Filters: ${formatReportViewFilters(report.view.filters)}`,
      "",
    );
  }
  lines.push("## Prioritized Evidence", "");
  if (!report.items?.length) {
    lines.push("No feedback or diagnostic signals were received in this window.");
  } else {
    for (const [index, item] of report.items.entries()) {
      lines.push(`### ${index + 1}. ${redactReportText(item.title || item.id)}`);
      lines.push("");
      lines.push(`- ID: ${redactReportText(item.id)}`);
      lines.push(`- Type: ${item.category}`);
      if (item.severity) lines.push(`- Severity: ${item.severity}`);
      if (item.status) lines.push(`- Status: ${item.status}`);
      if (item.triageStatusUpdatedAt) {
        lines.push(`- Status updated: ${item.triageStatusUpdatedAt}${item.triageStatusActor ? ` by ${redactReportText(item.triageStatusActor)}` : ""}`);
      }
      if (item.triageStatusNote) lines.push(`- Status note: ${redactReportText(item.triageStatusNote)}`);
      if (item.triageStatusHistoryCount > 1) lines.push(`- Status history entries: ${item.triageStatusHistoryCount}`);
      lines.push(`- Installation: ${redactReportText(item.installationId)}`);
      if (item.matterName) lines.push(`- Matter: ${redactReportText(item.matterName)}`);
      if (item.occurrenceCount > 1) lines.push(`- Occurrences: ${item.occurrenceCount}`);
      if (item.action_lane) lines.push(`- Action lane: ${item.action_lane}`);
      if (item.triage_source || item.confidence) lines.push(`- Triage: ${[item.triage_source, item.confidence].filter(Boolean).join(" / ")}`);
      if (item.currentness) lines.push(`- Currentness: ${item.currentness}`);
      if (item.relatedSignals?.length) lines.push(`- Related signals: ${item.relatedSignals.length}`);
      if (item.relatedJobs?.length) lines.push(`- Related jobs: ${item.relatedJobs.length}`);
      if (item.whatHappened?.summary) lines.push(`- What happened: ${redactReportText(item.whatHappened.summary)}`);
      if (item.whatHappened?.currentMatterState) lines.push(`- Current matter state: ${formatMatterStateContext(item.whatHappened.currentMatterState)}`);
      if (item.whatHappened?.nearbyJobs?.length) lines.push(`- Nearby jobs: ${item.whatHappened.nearbyJobs.map(formatNearbyJob).join("; ")}`);
      if (item.reason) lines.push(`- Reason: ${redactReportText(item.reason)}`);
      if (item.recommended_action) lines.push(`- Recommended action: ${redactReportText(item.recommended_action)}`);
      lines.push(`- Received: ${item.receivedAt || ""}`);
      if (item.detail) lines.push(`- Detail: ${redactReportText(item.detail)}`);
      lines.push("");
    }
  }
  lines.push("Evidence must be verified against the current repository and runtime before code changes are made.");
  return `${lines.join("\n")}\n`;
}

function signalReportItem(row = {}) {
  const payload = parsePayload(row.payload);
  const severity = normalizeSeverity(row.severity || payload.severity || "warning");
  const critical = severity === "blocker" || severity === "error";
  const occurrenceCount = positiveInteger(row.occurrence_count ?? payload.occurrenceCount, 1);
  return {
    id: String(row.signal_id || payload.id || "signal"),
    kind: "signal",
    category: critical ? "critical_signal" : "warning_signal",
    severity,
    priority: critical ? 0 : 1,
    installationId: String(row.installation_id || ""),
    matterName: String(row.matter_name || payload.matterName || ""),
    occurrenceCount,
    receivedAt: toIso(row.received_at || payload.lastSeenAt || payload.updatedAt),
    title: redactReportText(payload.title || payload.details?.title || `${severity} ${row.source || payload.source || "signal"}`),
    detail: redactReportText(
      payload.details?.errorMessage
      || payload.details?.message
      || payload.details?.detail
      || payload.details?.action
      || "",
    ),
    firstSeenAt: toIsoIfPresent(row.first_seen_at, payload.firstSeenAt, payload.createdAt),
    lastSeenAt: toIsoIfPresent(row.last_seen_at, payload.lastSeenAt, payload.updatedAt, payload.createdAt),
  };
}

function feedbackReportItem(row = {}) {
  const payload = parsePayload(row.payload);
  const classification = normalizeFeedbackCategory(row.classification || payload.classification || "bug");
  const operatorTriage = safeObject(payload.operatorTriage);
  return {
    id: String(row.feedback_id || payload.id || "feedback"),
    kind: "feedback",
    category: classification,
    severity: severityForFeedbackCategory(classification),
    status: normalizeFeedbackStatus(row.status || payload.status),
    triageStatusUpdatedAt: toIso(operatorTriage.updatedAt),
    triageStatusActor: redactReportText(operatorTriage.actor || ""),
    triageStatusNote: redactReportText(operatorTriage.note || ""),
    triageStatusHistoryCount: Array.isArray(payload.operatorTriageHistory) ? payload.operatorTriageHistory.length : 0,
    priority: priorityForFeedbackCategory(classification),
    installationId: String(row.installation_id || ""),
    user: redactReportText(payload.context?.username || payload.context?.user || ""),
    matterName: String(row.matter_name || payload.context?.activeMatterName || ""),
    occurrenceCount: 1,
    receivedAt: toIso(row.received_at || payload.createdAt),
    title: redactReportText(payload.tryingToDo || classification),
    detail: redactReportText(payload.happenedInstead || ""),
  };
}

function summarizeMetrics(rows = []) {
  const snapshots = rows
    .map(metricSnapshot)
    .filter((snapshot) => snapshot.id)
    .sort((left, right) => Date.parse(right.receivedAt || 0) - Date.parse(left.receivedAt || 0));
  return {
    latest: snapshots[0] || null,
    snapshots: snapshots.slice(0, 10),
  };
}

function summarizeHeartbeats(rows = [], generatedAt = new Date().toISOString()) {
  const generatedTime = Date.parse(generatedAt || "");
  const snapshots = rows
    .map(heartbeatSnapshot)
    .filter((snapshot) => snapshot.id)
    .sort((left, right) => Date.parse(right.receivedAt || 0) - Date.parse(left.receivedAt || 0));
  const latestByInstallation = [];
  const seen = new Set();
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.installationId)) continue;
    seen.add(snapshot.installationId);
    latestByInstallation.push(snapshot);
  }
  const latest = latestByInstallation[0] || null;
  const latestAgeMinutes = latest && Number.isFinite(generatedTime)
    ? Math.max(0, Math.round((generatedTime - Date.parse(latest.receivedAt || latest.capturedAt || 0)) / 60000))
    : null;
  return {
    latest,
    latestAgeMinutes,
    silentInstallations: latestByInstallation.filter((item) => {
      if (!Number.isFinite(generatedTime)) return false;
      const ageMinutes = Math.max(0, Math.round((generatedTime - Date.parse(item.receivedAt || item.capturedAt || 0)) / 60000));
      return ageMinutes >= 15;
    }).length,
    latestByInstallation,
    latestMatterHealth: latestMatterHealthByInstallationAndMatter(snapshots),
    jobEvidence: heartbeatJobEvidence(snapshots),
    snapshots: snapshots.slice(0, 20),
  };
}

function metricSnapshot(row = {}) {
  const payload = parsePayload(row.payload);
  return {
    id: String(row.snapshot_id || payload.id || ""),
    installationId: String(row.installation_id || ""),
    capturedAt: toIso(row.captured_at || payload.createdAt),
    receivedAt: toIso(row.received_at || payload.updatedAt || payload.createdAt),
    deployment: redactSensitiveValues(safeObject(payload.deployment)),
    runtime: redactSensitiveValues(safeObject(payload.runtime)),
    latency: redactSensitiveValues(safeObject(payload.latency)),
    scores: redactSensitiveValues(safeObject(payload.scores)),
  };
}

function heartbeatSnapshot(row = {}) {
  const payload = parsePayload(row.payload);
  const journeys = Array.isArray(payload.journeys) ? payload.journeys.slice(0, 20).map((journey) => ({
    user: redactReportText(journey.user || ""),
    matter: String(journey.matter || ""),
    screen: String(journey.screen || ""),
    route: String(journey.route || ""),
    lastAction: String(journey.lastAction || ""),
    currentStage: String(journey.currentStage || ""),
    currentStageStatus: String(journey.currentStageStatus || ""),
    traceId: String(journey.traceId || ""),
    jobId: String(journey.jobId || ""),
    lastError: redactReportText(journey.lastError || ""),
    patienceRisk: normalizePatienceRisk(journey.patienceRisk),
  })) : [];
  const matterHealth = Array.isArray(payload.matterHealth) ? payload.matterHealth.slice(0, 20).map((item) => ({
    matter: String(item.matter || item.matterName || ""),
    prepareState: String(item.prepareState || ""),
    nextStepLabel: String(item.nextStepLabel || ""),
    attentionState: String(item.attentionState || ""),
    blockers: positiveInteger(item.blockers, 0),
    warnings: positiveInteger(item.warnings, 0),
    checkedAt: toIso(item.checkedAt || row.received_at || payload.updatedAt || payload.createdAt),
  })).filter((item) => item.matter) : [];
  return {
    id: String(row.heartbeat_id || payload.id || ""),
    installationId: String(row.installation_id || payload.installId || ""),
    capturedAt: toIso(row.captured_at || payload.createdAt),
    receivedAt: toIso(row.received_at || payload.updatedAt || payload.createdAt),
    activeSessions: positiveInteger(payload.activeSessions, 0),
    highestPatienceRisk: highestPatienceRisk(journeys),
    journeys,
    matterHealth,
    counters: safeObject(payload.counters),
  };
}

function heartbeatJobEvidence(snapshots = []) {
  const rows = [];
  for (const snapshot of snapshots) {
    const observedAt = snapshot.receivedAt || snapshot.capturedAt || "";
    for (const [index, journey] of (snapshot.journeys || []).entries()) {
      const stageLabel = journey.currentStage || journey.lastAction || journey.route || "";
      const title = stageLabel || "Heartbeat journey";
      const status = journey.currentStageStatus || "";
      const jobId = journey.jobId || "";
      const detail = journey.lastError || "";
      if (!stageLabel && !status && !jobId && !detail) continue;
      rows.push({
        id: redactReportText(jobId || journey.traceId || `${snapshot.id}:journey:${index + 1}`),
        category: "heartbeat_journey",
        title: redactReportText(title),
        detail: redactReportText(detail),
        status: redactReportText(status),
        jobId: redactReportText(jobId),
        traceId: redactReportText(journey.traceId || ""),
        matterName: String(journey.matter || ""),
        installationId: snapshot.installationId,
        observedAt,
        patienceRisk: normalizePatienceRisk(journey.patienceRisk),
      });
    }
  }
  return rows
    .sort((left, right) => Date.parse(right.observedAt || 0) - Date.parse(left.observedAt || 0))
    .slice(0, 100);
}

function highestPatienceRisk(journeys = []) {
  const ranks = { low: 0, medium: 1, high: 2 };
  let highest = "low";
  for (const journey of journeys) {
    const value = normalizePatienceRisk(journey.patienceRisk);
    if (ranks[value] > ranks[highest]) highest = value;
  }
  return highest;
}

function normalizePatienceRisk(value = "") {
  return ["low", "medium", "high"].includes(value) ? value : "low";
}

function annotateTriage(item = {}, context = {}) {
  const currentMatterState = latestMatterStateForItem(item, context.latestMatterHealth);
  const currentness = classifyCurrentness(item, context.latestRuntimeEvidenceAt, currentMatterState);
  const triage = routePrivateBetaFeedbackTriage({ ...item, currentness, currentMatterState });
  return {
    ...item,
    currentness,
    ...(currentMatterState ? { currentMatterState } : {}),
    ...triage,
  };
}

function attachWhatHappened(item = {}) {
  return {
    ...item,
    whatHappened: buildWhatHappenedPacket(item),
  };
}

function buildWhatHappenedPacket(item = {}) {
  const currentMatterState = summarizeWhatHappenedMatterState(item.currentMatterState);
  const nearbySignals = summarizeWhatHappenedSignals(item.relatedSignals);
  const nearbyJobs = summarizeWhatHappenedJobs(item.relatedJobs);
  const statusDisposition = statusDispositionForItem(item);
  const nextAction = redactReportText(nextActionForItem(item, currentMatterState, statusDisposition));
  return {
    schema_version: "mothership-what-happened/v1",
    currentMatterState,
    nearbySignals,
    nearbyJobs,
    statusDisposition,
    nextAction,
    missingEvidence: Array.isArray(item.missing_evidence) ? item.missing_evidence.slice(0, 5).map(redactReportText) : [],
    summary: whatHappenedSummary({ item, currentMatterState, nearbySignals, nearbyJobs, statusDisposition, nextAction }),
  };
}

function attachRelatedSignals(item = {}, signalItems = []) {
  const relatedSignals = relatedSignalsForFeedback(item, signalItems);
  return relatedSignals.length ? { ...item, relatedSignals } : item;
}

function attachRelatedJobs(item = {}, jobEvidence = []) {
  const relatedJobs = relatedJobsForItem(item, jobEvidence);
  return relatedJobs.length ? { ...item, relatedJobs } : item;
}

function relatedSignalsForFeedback(item = {}, signalItems = []) {
  const installationId = normalizeReportKey(item.installationId);
  const matterName = normalizeMatterName(item.matterName);
  const feedbackTime = Date.parse(item.receivedAt || "");
  if (!installationId || !matterName || !Number.isFinite(feedbackTime)) return [];
  return signalItems
    .filter((signal) => normalizeReportKey(signal.installationId) === installationId)
    .filter((signal) => normalizeMatterName(signal.matterName) === matterName)
    .filter((signal) => isNearbySignalTime(feedbackTime, signal))
    .sort(compareRelatedSignalRecency)
    .slice(0, 8)
    .map((signal) => ({
      id: signal.id,
      category: signal.category,
      title: signal.title,
      detail: signal.detail,
      receivedAt: signal.receivedAt,
      firstSeenAt: signal.firstSeenAt,
      lastSeenAt: signal.lastSeenAt,
    }));
}

function isNearbySignalTime(feedbackTime, signal = {}) {
  return [signal.receivedAt, signal.lastSeenAt, signal.firstSeenAt]
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite)
    .some((signalTime) => Math.abs(feedbackTime - signalTime) <= RELATED_SIGNAL_WINDOW_MS);
}

function relatedJobsForItem(item = {}, jobEvidence = []) {
  const installationId = normalizeReportKey(item.installationId);
  const matterName = normalizeMatterName(item.matterName);
  const itemTime = Date.parse(item.receivedAt || "");
  if (!installationId || !matterName || !Number.isFinite(itemTime)) return [];
  return (Array.isArray(jobEvidence) ? jobEvidence : [])
    .filter((job) => normalizeReportKey(job.installationId) === installationId)
    .filter((job) => normalizeMatterName(job.matterName) === matterName)
    .filter((job) => isNearbyJobTime(itemTime, job))
    .sort(compareRelatedJobRecency)
    .slice(0, 8)
    .map((job) => ({
      id: job.id,
      category: job.category,
      title: job.title,
      detail: job.detail,
      status: job.status,
      jobId: job.jobId,
      traceId: job.traceId,
      observedAt: job.observedAt,
      patienceRisk: job.patienceRisk,
    }));
}

function isNearbyJobTime(itemTime, job = {}) {
  const jobTime = Date.parse(job.observedAt || "");
  return Number.isFinite(jobTime) && Math.abs(itemTime - jobTime) <= RELATED_SIGNAL_WINDOW_MS;
}

function compareRelatedSignalRecency(left = {}, right = {}) {
  return latestSignalTime(right) - latestSignalTime(left);
}

function compareRelatedJobRecency(left = {}, right = {}) {
  return Date.parse(right.observedAt || 0) - Date.parse(left.observedAt || 0);
}

function latestSignalTime(signal = {}) {
  const times = [signal.receivedAt, signal.lastSeenAt, signal.firstSeenAt]
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

function latestEvidenceTime(metricSummary = {}, heartbeatSummary = {}) {
  const times = [
    metricSummary.latest?.receivedAt,
    metricSummary.latest?.capturedAt,
    heartbeatSummary.latest?.receivedAt,
    heartbeatSummary.latest?.capturedAt,
  ]
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

function classifyCurrentness(item = {}, latestRuntimeEvidenceAt = null, currentMatterState = null) {
  if (isResolvedByMatterState(item, currentMatterState)) return "resolved_by_latest_matter_state";
  if (isConfirmedByMatterState(item, currentMatterState)) return "current";
  const itemTime = latestItemEvidenceTime(item);
  if (!Number.isFinite(itemTime) || !Number.isFinite(latestRuntimeEvidenceAt)) return "unknown";
  if (latestRuntimeEvidenceAt - itemTime >= 10 * 60 * 1000) return "needs_live_recheck";
  return "current";
}

function latestMatterHealthByInstallationAndMatter(snapshots = []) {
  const map = new Map();
  for (const snapshot of snapshots) {
    for (const state of snapshot.matterHealth || []) {
      const key = matterStateKey(snapshot.installationId, state.matter);
      if (!key) continue;
      const checkedAt = state.checkedAt || snapshot.receivedAt || snapshot.capturedAt || "";
      const existing = map.get(key);
      if (existing && Date.parse(existing.checkedAt || 0) >= Date.parse(checkedAt || 0)) continue;
      map.set(key, {
        ...state,
        checkedAt,
        installationId: snapshot.installationId,
      });
    }
  }
  return map;
}

function latestMatterStateForItem(item = {}, latestMatterHealth) {
  if (!(latestMatterHealth instanceof Map)) return null;
  return latestMatterHealth.get(matterStateKey(item.installationId, item.matterName)) || null;
}

function matterStateKey(installationId = "", matterName = "") {
  const install = String(installationId || "").trim().toLowerCase();
  const matter = String(matterName || "").trim().toLowerCase().replace(/\s+/g, " ");
  return install && matter ? `${install}:${matter}` : "";
}

function isResolvedByMatterState(item = {}, currentMatterState = null) {
  if (!isPreparationMatterStateEvidence(item, currentMatterState)) return false;
  return currentMatterState.prepareState === "complete"
    && currentMatterState.attentionState === "clear"
    && (Number(currentMatterState.blockers) || 0) === 0
    && (Number(currentMatterState.warnings) || 0) === 0;
}

function isConfirmedByMatterState(item = {}, currentMatterState = null) {
  return isPreparationMatterStateEvidence(item, currentMatterState);
}

function isPreparationMatterStateEvidence(item = {}, currentMatterState = null) {
  if (!currentMatterState || !item.matterName) return false;
  if (!isPreparationPipelineIssue(item)) return false;
  const itemTime = latestItemEvidenceTime(item);
  const checkedTime = Date.parse(currentMatterState.checkedAt || "");
  return Number.isFinite(itemTime) && Number.isFinite(checkedTime) && checkedTime >= itemTime;
}

function isPreparationPipelineIssue(item = {}) {
  const text = normalizeReportText(`${item.title || ""} ${item.detail || ""}`);
  if (item.category === "critical_signal" && PREPARATION_PIPELINE_RE.test(text)) return true;
  if (PREPARATION_PIPELINE_RE.test(text) && /failed|missing|not found|cannot|can't|error|already ran|blocked|not created|not generated|not showing/.test(text)) return true;
  return Array.isArray(item.relatedSignals)
    && item.relatedSignals.some((signal) => PREPARATION_PIPELINE_RE.test(normalizeReportText(`${signal.title || ""} ${signal.detail || ""}`)));
}

function latestItemEvidenceTime(item = {}) {
  const times = [item.receivedAt, item.lastSeenAt, item.firstSeenAt]
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);
  for (const signal of Array.isArray(item.relatedSignals) ? item.relatedSignals : []) {
    const signalTime = latestSignalTime(signal);
    if (Number.isFinite(signalTime) && signalTime > 0) times.push(signalTime);
  }
  for (const job of Array.isArray(item.relatedJobs) ? item.relatedJobs : []) {
    const jobTime = Date.parse(job.observedAt || "");
    if (Number.isFinite(jobTime) && jobTime > 0) times.push(jobTime);
  }
  return times.length ? Math.max(...times) : NaN;
}

function summarizeWhatHappenedMatterState(state = null) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return {
    prepareState: redactReportText(state.prepareState || ""),
    nextStepLabel: redactReportText(state.nextStepLabel || ""),
    attentionState: redactReportText(state.attentionState || ""),
    blockers: positiveInteger(state.blockers, 0),
    warnings: positiveInteger(state.warnings, 0),
    checkedAt: toIsoIfPresent(state.checkedAt),
  };
}

function summarizeWhatHappenedSignals(signals = []) {
  if (!Array.isArray(signals)) return [];
  return signals.slice(0, 3).map((signal) => ({
    id: redactReportText(signal.id || ""),
    category: redactReportText(signal.category || ""),
    title: redactReportText(signal.title || ""),
    receivedAt: toIsoIfPresent(signal.receivedAt, signal.lastSeenAt, signal.firstSeenAt),
  }));
}

function summarizeWhatHappenedJobs(jobs = []) {
  if (!Array.isArray(jobs)) return [];
  return jobs.slice(0, 3).map((job) => ({
    id: redactReportText(job.id || job.jobId || ""),
    stage: redactReportText(job.title || ""),
    status: redactReportText(job.status || ""),
    observedAt: toIsoIfPresent(job.observedAt),
    patienceRisk: normalizePatienceRisk(job.patienceRisk),
  }));
}

function nextActionForItem(item = {}, currentMatterState = null, statusDisposition = statusDispositionForItem(item)) {
  if (statusDisposition.actionState === "closed") return statusDisposition.nextAction;
  return item.recommended_action || nextActionFromMatterState(currentMatterState);
}

function statusDispositionForItem(item = {}) {
  const status = typeof item.status === "string" ? item.status.trim().toLowerCase() : "";
  if (!status) {
    return {
      status: "signal",
      actionState: "active_signal",
      nextAction: "Inspect the current signal state and latest matter context before changing code.",
    };
  }
  if (status === "fixed") {
    return {
      status,
      actionState: "closed",
      nextAction: "No immediate action: this feedback is fixed. Watch for recurrence before reopening.",
    };
  }
  if (status === "not_reproducible") {
    return {
      status,
      actionState: "closed",
      nextAction: "No immediate action: this feedback is not reproducible on the current evidence. Reopen only with a current reproduction or trace.",
    };
  }
  if (status === "reviewed") {
    return {
      status,
      actionState: "closed",
      nextAction: "No immediate runtime action: this feedback is reviewed. Reopen only if new evidence changes the status.",
    };
  }
  if (status === "parked") {
    return {
      status,
      actionState: "closed",
      nextAction: "No immediate action: this feedback is parked pending product or operator decision.",
    };
  }
  if (status === "needs_evidence") {
    return {
      status,
      actionState: "needs_evidence",
      nextAction: "Collect current evidence before changing code.",
    };
  }
  return {
    status,
    actionState: "active",
    nextAction: "Inspect the item with current runtime evidence before changing code.",
  };
}

function nextActionFromMatterState(state = null) {
  if (state?.nextStepLabel && state.nextStepLabel !== "Core preparation is current") return `Check ${state.nextStepLabel}.`;
  if (state?.prepareState === "complete" && state?.attentionState === "clear") return "No immediate matter-preparation action; verify only if the report reproduces.";
  return "Inspect the item with current runtime evidence before changing code.";
}

function whatHappenedSummary({ item = {}, currentMatterState = null, nearbySignals = [], nearbyJobs = [], statusDisposition = null, nextAction = "" } = {}) {
  const state = currentMatterState
    ? `matter ${currentMatterState.prepareState || "unknown"}, attention ${currentMatterState.attentionState || "unknown"}`
    : "no current matter state";
  const nearby = `${nearbySignals.length} nearby signal${nearbySignals.length === 1 ? "" : "s"}, ${nearbyJobs.length} nearby job${nearbyJobs.length === 1 ? "" : "s"}`;
  const lane = item.action_lane ? `lane ${item.action_lane}` : "lane unknown";
  const disposition = statusDisposition?.actionState ? `operator ${statusDisposition.actionState}` : "operator unknown";
  return boundedReportText(`${state}; ${nearby}; ${lane}; ${disposition}; next: ${nextAction || "inspect manually"}`, 700);
}

function formatMatterStateContext(state = {}) {
  return redactReportText([
    `prepare=${state.prepareState || "unknown"}`,
    `attention=${state.attentionState || "unknown"}`,
    state.nextStepLabel ? `next=${state.nextStepLabel}` : "",
    `blockers=${Number(state.blockers) || 0}`,
    `warnings=${Number(state.warnings) || 0}`,
    state.checkedAt ? `checked=${state.checkedAt}` : "",
  ].filter(Boolean).join("; "));
}

function formatNearbyJob(job = {}) {
  return redactReportText([
    job.stage || "job",
    job.status ? `status=${job.status}` : "",
    job.observedAt ? `at=${job.observedAt}` : "",
  ].filter(Boolean).join(" "));
}

function normalizeReportViewFilters(filters = {}) {
  const actionLane = stringOr(filters.actionLane ?? filters.action_lane ?? filters.lane, "");
  const severity = stringOr(filters.severity, "");
  const status = stringOr(filters.status, "");
  const limit = filters.limit === undefined || filters.limit === null || String(filters.limit).trim() === ""
    ? null
    : parseViewLimit(filters.limit);
  const normalized = {};
  if (actionLane) normalized.action_lane = requireAllowedFilter("action-lane", actionLane, ACTION_LANES);
  if (severity) normalized.severity = requireAllowedFilter("severity", severity, SEVERITIES);
  if (status) normalized.status = requireAllowedFilter("status", status, FEEDBACK_STATUSES);
  if (limit) normalized.limit = limit;
  return normalized;
}

function requireAllowedFilter(name, value, allowed) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return normalized;
}

function parseViewLimit(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error("limit must be a positive integer");
  return Math.min(number, 500);
}

function formatReportViewFilters(filters = {}) {
  const parts = [];
  if (filters.action_lane) parts.push(`action_lane=${filters.action_lane}`);
  if (filters.severity) parts.push(`severity=${filters.severity}`);
  if (filters.status) parts.push(`status=${filters.status}`);
  if (filters.limit) parts.push(`limit=${filters.limit}`);
  return parts.length ? parts.join(", ") : "none";
}

function actionLaneCounts(items = []) {
  const counts = { fix_now: 0, investigate: 0, product_decision: 0, watch: 0 };
  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(counts, item.action_lane)) counts[item.action_lane] += 1;
  }
  return counts;
}

function severityCounts(items = []) {
  const counts = { blocker: 0, error: 0, warning: 0, info: 0 };
  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(counts, item.severity)) counts[item.severity] += 1;
  }
  return counts;
}

function normalizeSeverity(value = "") {
  const severity = String(value || "").trim().toLowerCase();
  return SEVERITIES.includes(severity) ? severity : "warning";
}

function normalizeFeedbackCategory(value = "") {
  const category = String(value || "").trim().toLowerCase();
  return [
    "bug",
    "confusing_ux",
    "feature_request",
    "feature_idea",
    "blocked_workflow",
    "legal_quality_concern",
    "operator_note",
  ].includes(category) ? category : "operator_note";
}

function normalizeFeedbackStatus(value = "") {
  const status = String(value || "new").trim().toLowerCase();
  return FEEDBACK_STATUSES.includes(status) ? status : "new";
}

function severityForFeedbackCategory(category = "") {
  if (["bug", "blocked_workflow", "legal_quality_concern"].includes(category)) return "warning";
  return "info";
}

function priorityForFeedbackCategory(category = "") {
  if (category === "bug" || category === "blocked_workflow" || category === "legal_quality_concern") return 2;
  if (category === "confusing_ux") return 3;
  return 4;
}

function laneSort(lane = "") {
  if (lane === "fix_now") return 0;
  if (lane === "investigate") return 1;
  if (lane === "product_decision") return 2;
  if (lane === "watch") return 3;
  return 4;
}

function parsePayload(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function toIso(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function toIsoIfPresent(...values) {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  return value === undefined ? "" : toIso(value);
}

function redactReportText(value) {
  return redactSensitiveText(value);
}

function normalizeReportKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMatterName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeReportText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function boundedReportText(value, maxLength) {
  const text = redactReportText(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

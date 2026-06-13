import { redactSensitiveText } from "../shared/secret-redaction.mjs";

export function buildMothershipReport(dataset = {}, { generatedAt = new Date().toISOString() } = {}) {
  const signalItems = (dataset.signals || []).map(signalReportItem).map(annotateTriage);
  const feedbackItems = (dataset.feedback || []).map(feedbackReportItem).map(annotateTriage);
  const metricSummary = summarizeMetrics(dataset.metrics || []);
  const heartbeatSummary = summarizeHeartbeats(dataset.heartbeats || [], generatedAt);
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

export function renderMothershipReportMarkdown(report = {}) {
  const actionLanes = report.summary?.actionLanes || {};
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
      lines.push(`- ${redactReportText(item.installationId)}: last seen ${item.lastSeenAt || ""}; sessions ${item.activeSessions}; patience ${item.highestPatienceRisk}`);
    }
    lines.push("");
  }
  lines.push("## Prioritized Evidence", "");
  if (!report.items?.length) {
    lines.push("No feedback or diagnostic signals were received in this window.");
  } else {
    for (const [index, item] of report.items.entries()) {
      lines.push(`### ${index + 1}. ${redactReportText(item.title || item.id)}`);
      lines.push("");
      lines.push(`- Type: ${item.category}`);
      lines.push(`- Installation: ${item.installationId}`);
      if (item.matterName) lines.push(`- Matter: ${redactReportText(item.matterName)}`);
      if (item.occurrenceCount > 1) lines.push(`- Occurrences: ${item.occurrenceCount}`);
      if (item.action_lane) lines.push(`- Action lane: ${item.action_lane}`);
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
  const severity = String(row.severity || payload.severity || "warning").toLowerCase();
  const critical = severity === "blocker" || severity === "error";
  const occurrenceCount = positiveInteger(row.occurrence_count ?? payload.occurrenceCount, 1);
  return {
    id: String(row.signal_id || payload.id || "signal"),
    category: critical ? "critical_signal" : "warning_signal",
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
  };
}

function feedbackReportItem(row = {}) {
  const payload = parsePayload(row.payload);
  const classification = String(row.classification || payload.classification || "bug");
  const priority = classification === "bug" ? 2 : classification === "confusing_ux" ? 3 : 4;
  return {
    id: String(row.feedback_id || payload.id || "feedback"),
    category: classification,
    priority,
    installationId: String(row.installation_id || ""),
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
    deployment: safeObject(payload.deployment),
    runtime: safeObject(payload.runtime),
    latency: safeObject(payload.latency),
    scores: safeObject(payload.scores),
  };
}

function heartbeatSnapshot(row = {}) {
  const payload = parsePayload(row.payload);
  const journeys = Array.isArray(payload.journeys) ? payload.journeys.slice(0, 20).map((journey) => ({
    user: String(journey.user || ""),
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
  return {
    id: String(row.heartbeat_id || payload.id || ""),
    installationId: String(row.installation_id || payload.installId || ""),
    capturedAt: toIso(row.captured_at || payload.createdAt),
    receivedAt: toIso(row.received_at || payload.updatedAt || payload.createdAt),
    activeSessions: positiveInteger(payload.activeSessions, 0),
    highestPatienceRisk: highestPatienceRisk(journeys),
    journeys,
    counters: safeObject(payload.counters),
  };
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

function annotateTriage(item = {}) {
  const triage = routeTriage(item);
  return { ...item, ...triage };
}

function routeTriage(item = {}) {
  const text = normalizeReportText(`${item.title || ""} ${item.detail || ""}`);
  if (item.category === "critical_signal") {
    if (/no extraction records|run extract|source index|create_listofdates|list of dates|label sources/.test(text)) {
      return {
        action_lane: "fix_now",
        recommended_action: "Verify matter preparation state and fix the extraction-to-source-labels/List of Dates path if records exist but downstream stages cannot see them.",
      };
    }
    return {
      action_lane: "fix_now",
      recommended_action: "Inspect the failed runtime path before the next beta session.",
    };
  }

  if (item.category === "warning_signal") {
    if (item.occurrenceCount > 1) {
      return {
        action_lane: "investigate",
        recommended_action: "Check whether this warning is repeated for the same matter, user, or workflow.",
      };
    }
    return {
      action_lane: "watch",
      recommended_action: "Keep this as a watch item unless it repeats or is paired with tester feedback.",
    };
  }

  if (item.category === "bug") {
    if (/unsupported citation|matter copilot returned unsupported citation/.test(text)) {
      return {
        action_lane: "fix_now",
        recommended_action: "Keep Copilot fail-closed validation, but show a lawyer-safe source verification message and preserve the raw citation only in diagnostics.",
      };
    }
    if (/login|logged out|asking login|authentication/.test(text)) {
      return {
        action_lane: "investigate",
        recommended_action: "Verify session persistence across reload, tab reopen, and deploy restart before changing auth behavior.",
      };
    }
    return {
      action_lane: "investigate",
      recommended_action: "Reproduce the reported bug in the current deployment and attach runtime evidence before fixing.",
    };
  }

  if (item.category === "feature_request") {
    return {
      action_lane: "product_decision",
      recommended_action: "Decide whether this is a net-new product feature for beta, then either scope it or park it in the product backlog.",
    };
  }

  if (item.category === "confusing_ux" || item.category === "feature_idea") {
    return {
      action_lane: "product_decision",
      recommended_action: "Decide whether this changes beta onboarding/copy or belongs in the parked product backlog.",
    };
  }

  return {
    action_lane: "watch",
    recommended_action: "No immediate action unless this appears again.",
  };
}

function actionLaneCounts(items = []) {
  const counts = { fix_now: 0, investigate: 0, product_decision: 0, watch: 0 };
  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(counts, item.action_lane)) counts[item.action_lane] += 1;
  }
  return counts;
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

function redactReportText(value) {
  return redactSensitiveText(value)
    .replace(/\b(password|token|secret)\s*[:=]\s*([^\s"'`]+)/gi, "$1=[redacted-secret]");
}

function normalizeReportText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

import { redactSensitiveText } from "../shared/secret-redaction.mjs";

export function buildMothershipReport(dataset = {}, { generatedAt = new Date().toISOString() } = {}) {
  const signalItems = (dataset.signals || []).map(signalReportItem);
  const feedbackItems = (dataset.feedback || []).map(feedbackReportItem);
  const metricSummary = summarizeMetrics(dataset.metrics || []);
  const items = [...signalItems, ...feedbackItems]
    .sort((left, right) => left.priority - right.priority
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
      featureIdeas: feedbackItems.filter((item) => item.category === "feature_idea").length,
      total: items.length,
      latestBackendSuitability: metricSummary.latest?.scores?.backendSuitability,
      latestPortability: metricSummary.latest?.scores?.portability,
      latestUserPatienceRisk: metricSummary.latest?.scores?.userPatienceRisk,
    },
    metrics: metricSummary,
    items,
  };
}

export function renderMothershipReportMarkdown(report = {}) {
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
    `- Feature ideas: ${report.summary?.featureIdeas || 0}`,
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

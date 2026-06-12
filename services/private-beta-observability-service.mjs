const OBSERVABILITY_SCHEMA_VERSION = "private-beta-observability/v1";
const DEFAULT_LIMIT = 50;
const NEARBY_WINDOW_MS = 30 * 60 * 1000;

export function createPrivateBetaObservabilityService({
  feedbackService,
  jobStatusService,
  metricsService,
  signalService,
  now = () => new Date(),
} = {}) {
  async function readObservability(filters = {}) {
    const limit = parseLimit(filters.limit);
    const [feedbackLedger, jobLedger, signalLedger, metricsLedger] = await Promise.all([
      readLedger("feedback", () => feedbackService?.listFeedback?.({ limit })),
      readLedger("jobs", () => jobStatusService?.listJobs?.({ limit })),
      readLedger("signals", () => signalService?.listSignals?.({ limit })),
      readLedger("metrics", () => metricsService?.listMetrics?.({ limit: 5 })),
    ]);
    const feedback = Array.isArray(feedbackLedger.feedback) ? feedbackLedger.feedback : [];
    const jobs = Array.isArray(jobLedger.jobs) ? jobLedger.jobs : [];
    const signals = Array.isArray(signalLedger.signals) ? signalLedger.signals : [];
    const metrics = Array.isArray(metricsLedger.metrics) ? metricsLedger.metrics : [];
    const ledgerErrors = [feedbackLedger, jobLedger, signalLedger, metricsLedger]
      .filter((ledger) => ledger?.error)
      .map((ledger) => ({
        source: ledger.source,
        message: ledger.error,
      }));
    const failedJobs = jobs.filter((job) => job.status === "failed");
    const latestMetrics = metrics[0] || null;

    return {
      schema_version: OBSERVABILITY_SCHEMA_VERSION,
      generatedAt: isoNow(now),
      summary: {
        feedback: feedback.length,
        failedJobs: failedJobs.length,
        openSignals: signals.length,
        latestUserPatienceRisk: latestMetrics?.scores?.userPatienceRisk || "unknown",
        latestBackendSuitability: numberOrNull(latestMetrics?.scores?.backendSuitability),
        ledgerErrors: ledgerErrors.length,
      },
      ledgerErrors,
      topProblems: buildTopProblems({ failedJobs, signals, feedback }),
      feedbackEvidence: feedback.map((item) => {
        const relatedJobs = relatedJobsForFeedback(item, jobs);
        return {
          feedback: item,
          relatedJobs,
          relatedSignals: relatedSignalsForFeedback(item, signals, relatedJobs),
        };
      }),
      failedJobs,
      signals,
      latestMetrics,
    };
  }

  return { readObservability };
}

async function readLedger(source, reader) {
  if (typeof reader !== "function") return {};
  try {
    const result = await reader();
    return result && typeof result === "object" ? result : {};
  } catch (error) {
    return {
      source,
      error: sanitizeText(error?.message || "ledger unavailable", 300),
    };
  }
}

function relatedJobsForFeedback(feedback = {}, jobs = []) {
  const traceId = sanitizeText(feedback.context?.traceId || "", 180).trim();
  const matterName = sanitizeText(feedback.context?.activeMatterName || "", 180).trim();
  const feedbackTime = Date.parse(feedback.createdAt || "");
  return jobs
    .filter((job) => {
      if (traceId && job.traceId === traceId) return true;
      if (matterName && job.matterName === matterName && isNearbyTime(feedbackTime, job.startedAt || job.updatedAt || job.finishedAt)) return true;
      return false;
    })
    .sort(compareNewest)
    .slice(0, 8);
}

function relatedSignalsForFeedback(feedback = {}, signals = [], relatedJobs = []) {
  const matterName = sanitizeText(feedback.context?.activeMatterName || "", 180).trim();
  const relatedJobIds = new Set(relatedJobs.map((job) => job.id).filter(Boolean));
  return signals
    .filter((signal) => {
      if (matterName && signal.matterName === matterName) return true;
      if (relatedJobIds.size && relatedJobIds.has(signal.details?.jobId)) return true;
      return false;
    })
    .sort(compareNewest)
    .slice(0, 8);
}

function buildTopProblems({ failedJobs = [], signals = [], feedback = [] } = {}) {
  const map = new Map();
  for (const job of failedJobs) {
    const key = `job_failed:${job.kind || "job"}:${job.failureClass || "unknown"}:${job.errorMessage || ""}`;
    addProblem(map, key, {
      kind: "job_failed",
      severity: severityForFailureClass(job.failureClass),
      title: job.label || job.kind || "Failed job",
      category: job.kind || "job",
      failureClass: job.failureClass || "unknown",
      matterName: job.matterName || "",
      latestAt: job.finishedAt || job.updatedAt || job.startedAt || "",
      sample: job.errorMessage || "",
    });
  }
  for (const signal of signals) {
    const key = `signal:${signal.fingerprint || signal.source}:${signal.code || ""}`;
    addProblem(map, key, {
      kind: "signal",
      severity: signal.severity || "warning",
      title: signal.title || "Private beta signal",
      category: signal.category || signal.source || "signal",
      matterName: signal.matterName || "",
      latestAt: signal.lastSeenAt || signal.updatedAt || signal.createdAt || "",
      sample: signal.details?.errorMessage || signal.details?.message || signal.summary?.state || "",
      occurrenceCount: signal.occurrenceCount || 1,
    });
  }
  for (const item of feedback) {
    const key = `feedback:${item.classification || item.choice}`;
    addProblem(map, key, {
      kind: "feedback",
      severity: item.classification === "bug" ? "warning" : "info",
      title: item.classification || item.choice || "Private beta feedback",
      category: item.classification || item.choice || "feedback",
      matterName: item.context?.activeMatterName || "",
      latestAt: item.createdAt || "",
      sample: item.tryingToDo || "",
    });
  }
  return [...map.values()]
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity)
      || (right.occurrenceCount || 0) - (left.occurrenceCount || 0)
      || Date.parse(right.latestAt || 0) - Date.parse(left.latestAt || 0))
    .slice(0, 20);
}

function addProblem(map, key, item) {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      ...item,
      occurrenceCount: Math.max(1, Number(item.occurrenceCount) || 1),
      sample: sanitizeText(item.sample || "", 500),
    });
    return;
  }
  existing.occurrenceCount += Math.max(1, Number(item.occurrenceCount) || 1);
  if (Date.parse(item.latestAt || 0) > Date.parse(existing.latestAt || 0)) {
    existing.latestAt = item.latestAt;
    existing.matterName = item.matterName || existing.matterName;
    existing.sample = sanitizeText(item.sample || existing.sample || "", 500);
  }
  if (severityRank(item.severity) > severityRank(existing.severity)) existing.severity = item.severity;
}

function severityForFailureClass(value = "") {
  if (value === "provider" || value === "storage" || value === "auth") return "error";
  if (value === "user_action_needed") return "warning";
  return "warning";
}

function severityRank(value = "") {
  if (value === "blocker" || value === "error") return 4;
  if (value === "warning") return 3;
  if (value === "info") return 2;
  return 1;
}

function isNearbyTime(leftTime, value = "") {
  if (!Number.isFinite(leftTime)) return false;
  const rightTime = Date.parse(value || "");
  if (!Number.isFinite(rightTime)) return false;
  return Math.abs(leftTime - rightTime) <= NEARBY_WINDOW_MS;
}

function compareNewest(a, b) {
  return Date.parse(b.finishedAt || b.lastSeenAt || b.updatedAt || b.startedAt || b.createdAt || 0)
    - Date.parse(a.finishedAt || a.lastSeenAt || a.updatedAt || a.startedAt || a.createdAt || 0);
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(parsed), 500);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeText(value, maxLength = 500) {
  return String(value ?? "")
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/g, "$1=[redacted-secret]")
    .replace(/\b(password|token|secret)\s*[:=]\s*([^\s"'`]+)/gi, "$1=[redacted-secret]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[redacted-secret]")
    .slice(0, maxLength);
}

function isoNow(now) {
  const value = now();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

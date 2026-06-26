const MATTER_LOG_SCHEMA_VERSION = "matter-log/v0-readonly";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const JOB_CATEGORY_BY_KIND = new Map([
  ["intake", "source_preparation"],
  ["extract", "source_preparation"],
  ["source_labels", "source_preparation"],
  ["label_refresh", "generated_artifact"],
  ["list_of_dates", "generated_artifact"],
  ["custom_skill", "generated_artifact"],
  ["skill_sample_output", "skill_factory"],
  ["validation", "source_preparation"],
  ["preparation_run", "ledger_activity"],
]);

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export function createMatterLogService({
  jobStatusService,
  configurableSkillRunsService,
  now = () => new Date(),
} = {}) {
  async function readMatterLog({ matterName = "", limit = DEFAULT_LIMIT } = {}) {
    const normalizedMatterName = normalizeText(matterName);
    const normalizedLimit = normalizeLimit(limit);
    const [jobLedger, runLedger] = await Promise.all([
      safeListJobs(jobStatusService, {
        matterName: normalizedMatterName,
        limit: normalizedLimit,
      }),
      safeListRuns(configurableSkillRunsService, {
        matterName: normalizedMatterName,
        limit: normalizedLimit,
      }),
    ]);

    const entries = [
      ...jobsToMatterLogEntries(jobLedger.jobs, { matterName: normalizedMatterName }),
      ...runsToMatterLogEntries(runLedger.runs, { matterName: normalizedMatterName }),
    ]
      .sort(compareNewestEntriesFirst)
      .slice(0, normalizedLimit);

    return {
      schema_version: MATTER_LOG_SCHEMA_VERSION,
      status: "best_effort_projection",
      generatedAt: isoNow(now),
      matterName: normalizedMatterName,
      summary: {
        entries: entries.length,
        sourceLedgers: sourceLedgersForEntries(entries),
        canonicalEvents: false,
      },
      limitations: [
        "This is a read-only projection from existing ledgers, not a canonical matter event ledger.",
        "It does not yet prove custody-grade source changes, tombstones, restores, or artifact currentness.",
        "Conversation memory and Copilot receipts are not treated as evidence.",
      ],
      entries,
    };
  }

  return { readMatterLog };
}

export function jobsToMatterLogEntries(jobs = [], { matterName = "" } = {}) {
  const normalizedMatterName = normalizeText(matterName);
  return (Array.isArray(jobs) ? jobs : [])
    .filter((job) => !normalizedMatterName || normalizeText(job?.matterName) === normalizedMatterName)
    .map(jobToMatterLogEntry)
    .filter(Boolean);
}

export function runsToMatterLogEntries(runs = [], { matterName = "" } = {}) {
  const normalizedMatterName = normalizeText(matterName);
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => {
      if (!normalizedMatterName) return true;
      return normalizeText(run?.matterFolder) === normalizedMatterName || normalizeText(run?.matterName) === normalizedMatterName;
    })
    .map(runToMatterLogEntry)
    .filter(Boolean);
}

function jobToMatterLogEntry(job = {}) {
  const jobId = normalizeText(job.id);
  if (!jobId) return null;
  const jobKind = normalizeText(job.kind) || "job";
  const status = normalizeStatus(job.status);
  const occurredAt = normalizeTimestamp(job.finishedAt || job.updatedAt || job.startedAt);
  const metadata = job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata) ? job.metadata : {};
  const workflow = metadata.workflow && typeof metadata.workflow === "object" && !Array.isArray(metadata.workflow) ? metadata.workflow : {};
  const title = normalizeText(job.label) || humanizeKind(jobKind);
  const errorCode = normalizeText(job.errorCode);
  const errorSummary = normalizeText(job.errorMessage, 220);
  return removeEmpty({
    id: `job:${jobId}`,
    sourceLedger: "job_status",
    sourceId: jobId,
    sourceSchemaVersion: normalizeText(job.schema_version),
    occurredAt,
    matterName: normalizeText(job.matterName),
    matterId: normalizeText(job.matterId),
    category: JOB_CATEGORY_BY_KIND.get(jobKind) || "workflow_job",
    eventType: `job.${jobKind}.${status}`,
    title,
    summary: jobSummary(job, { title, status, errorSummary }),
    status,
    custodyGrade: "projection",
    canonical: false,
    actor: actorFromJob(job),
    route: normalizeText(workflow.route),
    details: removeEmpty({
      jobKind,
      resultState: normalizeText(job.resultState),
      failureClass: normalizeText(job.failureClass),
      errorCode,
      errorSummary,
    }),
  });
}

function runToMatterLogEntry(run = {}) {
  const runId = normalizeText(run.id);
  if (!runId) return null;
  const status = normalizeStatus(run.status);
  const occurredAt = normalizeTimestamp(run.finishedAt || run.startedAt);
  const title = normalizeText(run.title) || normalizeText(run.slash) || "Custom skill run";
  const outputPaths = run.outputPaths && typeof run.outputPaths === "object" && !Array.isArray(run.outputPaths)
    ? removeEmpty({ markdown: normalizeText(run.outputPaths.markdown), json: normalizeText(run.outputPaths.json) })
    : {};
  return removeEmpty({
    id: `custom_skill_run:${runId}`,
    sourceLedger: "configurable_skill_runs",
    sourceId: runId,
    sourceSchemaVersion: normalizeText(run.schema_version),
    occurredAt,
    matterName: normalizeText(run.matterFolder) || normalizeText(run.matterName),
    matterId: normalizeText(run.matterId),
    category: "generated_artifact",
    eventType: `custom_skill.run.${status}`,
    title,
    summary: runSummary(run, { title, status, outputPaths }),
    status,
    custodyGrade: "projection",
    canonical: false,
    details: removeEmpty({
      skillId: normalizeText(run.skillId),
      slash: normalizeText(run.slash),
      outputPaths,
      outputAvailability: normalizeOutputAvailability(run.outputAvailability),
      overwrite: normalizeText(run.overwrite),
      errorSummary: normalizeText(run.errorMessage, 220),
      receiptState: normalizeText(run.receipt?.receiptState),
    }),
  });
}

async function safeListJobs(jobStatusService, { matterName = "", limit = DEFAULT_LIMIT } = {}) {
  if (typeof jobStatusService?.listJobs !== "function") return { jobs: [] };
  const ledger = await jobStatusService.listJobs({ matterName, limit });
  return { jobs: Array.isArray(ledger?.jobs) ? ledger.jobs : [] };
}

async function safeListRuns(configurableSkillRunsService, { matterName = "", limit = DEFAULT_LIMIT } = {}) {
  if (typeof configurableSkillRunsService?.listRuns !== "function") return { runs: [] };
  const ledger = await configurableSkillRunsService.listRuns({ limit });
  const runs = Array.isArray(ledger?.runs) ? ledger.runs : [];
  if (!matterName) return { runs };
  return {
    runs: runs.filter((run) => normalizeText(run?.matterFolder) === matterName || normalizeText(run?.matterName) === matterName),
  };
}

function jobSummary(job = {}, { title = "Job", status = "unknown", errorSummary = "" } = {}) {
  if (status === "failed" && errorSummary) return `${title} failed: ${errorSummary}`;
  const summary = normalizeText(job.summary, 220);
  if (summary) return summary;
  if (status === "succeeded") return `${title} completed.`;
  if (status === "running") return `${title} is running.`;
  if (status === "cancelled") return `${title} was cancelled.`;
  return `${title}: ${status}.`;
}

function runSummary(run = {}, { title = "Custom skill run", status = "unknown", outputPaths = {} } = {}) {
  const errorSummary = normalizeText(run.errorMessage, 220);
  if (status === "failed" && errorSummary) return `${title} failed: ${errorSummary}`;
  if (status === "succeeded" && outputPaths.markdown) return `${title} wrote ${outputPaths.markdown}.`;
  if (status === "succeeded") return `${title} completed.`;
  if (status === "running") return `${title} is running.`;
  if (status === "cancelled") return `${title} was cancelled.`;
  return `${title}: ${status}.`;
}

function actorFromJob(job = {}) {
  const user = job.user && typeof job.user === "object" && !Array.isArray(job.user) ? job.user : null;
  if (!user) return undefined;
  return removeEmpty({
    username: normalizeText(user.username),
    displayName: normalizeText(user.displayName),
    role: normalizeText(user.role),
  });
}

function normalizeOutputAvailability(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return removeEmpty({
    markdown: normalizeText(value.markdown),
    json: normalizeText(value.json),
  });
}

function compareNewestEntriesFirst(a, b) {
  const left = Date.parse(a.occurredAt || "") || 0;
  const right = Date.parse(b.occurredAt || "") || 0;
  if (right !== left) return right - left;
  return String(b.id || "").localeCompare(String(a.id || ""));
}

function sourceLedgersForEntries(entries = []) {
  return Array.from(new Set(entries.map((entry) => entry.sourceLedger).filter(Boolean))).sort();
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(number), MAX_LIMIT);
}

function normalizeText(value, maxLength = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeStatus(value) {
  const text = normalizeText(value).toLowerCase();
  if (TERMINAL_STATUSES.has(text) || text === "running") return text;
  return text || "unknown";
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return "";
}

function isoNow(now) {
  const value = now();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return new Date().toISOString();
}

function humanizeKind(kind = "") {
  return normalizeText(kind || "job")
    .split("_")
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : "")
    .join(" ");
}

function removeEmpty(value = {}) {
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry === "string" && !entry) continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const nested = removeEmpty(entry);
      if (Object.keys(nested).length === 0) continue;
      output[key] = nested;
      continue;
    }
    output[key] = entry;
  }
  return output;
}

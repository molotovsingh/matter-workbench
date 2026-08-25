const ENVELOPE = Object.freeze({ files: 500, pages: 10_000, bytes: 2 * 1024 * 1024 * 1024 });

export function evaluateLoadCertification({
  runs = [],
  minimumRuns = 30,
  distributionApprovalId = "",
  requiredConcurrencyStrata = [1, 2, 4],
  p95ObjectiveSeconds = 60,
  p99ObjectiveSeconds = 120,
} = {}) {
  const reasons = [];
  const normalizedApproval = String(distributionApprovalId || "").trim();
  if (!normalizedApproval || /(?:todo|tbd|unknown|placeholder)/i.test(normalizedApproval)) reasons.push("concurrent_distribution_not_approved");
  const normalized = runs.map((run, index) => normalizeRun(run, index));
  const fullEnvelope = normalized.filter((run) => run.files >= ENVELOPE.files && run.pages >= ENVELOPE.pages && run.bytes >= ENVELOPE.bytes);
  if (fullEnvelope.length < minimumRuns) reasons.push("insufficient_full_envelope_runs");
  const observedStrata = new Set(fullEnvelope.map((run) => run.concurrentIntakes));
  const missingStrata = requiredConcurrencyStrata.filter((stratum) => !observedStrata.has(stratum));
  if (missingStrata.length) reasons.push("concurrency_strata_missing");
  if (fullEnvelope.some((run) => !["ready", "ready_with_review"].includes(run.status))) reasons.push("non_ready_run_present");
  if (fullEnvelope.some((run) => run.omittedPages > 0)) reasons.push("omitted_pages_present");
  if (fullEnvelope.some((run) => run.duplicateReadyEvents > 0)) reasons.push("duplicate_publication_present");
  if (fullEnvelope.some((run) => run.unreconciledCostEvents > 0)) reasons.push("unreconciled_cost_present");
  if (fullEnvelope.some((run) => !run.productionShapedStorage || !run.productionShapedPostgres || !run.statelessBurstWorkers)) {
    reasons.push("production_shape_missing");
  }
  if (fullEnvelope.some((run) => !run.providerQuotaCertificateId)) reasons.push("provider_quota_certificate_missing");
  const durations = fullEnvelope.filter((run) => ["ready", "ready_with_review"].includes(run.status)).map((run) => run.postCustodySeconds).sort((a, b) => a - b);
  const p95Seconds = percentile(durations, 0.95);
  const p99Seconds = percentile(durations, 0.99);
  if (!durations.length || p95Seconds > p95ObjectiveSeconds) reasons.push("p95_objective_missed");
  if (!durations.length || p99Seconds > p99ObjectiveSeconds) reasons.push("p99_objective_missed");
  return {
    schemaVersion: "document-intake-extraction.load-certification/v1",
    certified: reasons.length === 0,
    envelope: { ...ENVELOPE },
    objectives: { p95Seconds: p95ObjectiveSeconds, p99Seconds: p99ObjectiveSeconds },
    evidence: {
      submittedRuns: normalized.length,
      fullEnvelopeRuns: fullEnvelope.length,
      concurrencyStrata: Array.from(observedStrata).sort((a, b) => a - b),
      missingConcurrencyStrata: missingStrata,
      p95Seconds,
      p99Seconds,
      maximumSeconds: durations.length ? durations.at(-1) : null,
    },
    distributionApprovalId: safeIdentifier(normalizedApproval),
    reasons,
  };
}

function normalizeRun(run = {}, index) {
  const custodyAt = timestamp(run.custodyCommittedAt, `runs[${index}].custodyCommittedAt`);
  const readyAt = timestamp(run.readyAt, `runs[${index}].readyAt`);
  if (readyAt < custodyAt) throw new Error(`runs[${index}].readyAt precedes custody`);
  return {
    runId: safeIdentifier(required(run.runId, `runs[${index}].runId`)),
    files: boundedInteger(run.files, `runs[${index}].files`, 1, ENVELOPE.files),
    pages: boundedInteger(run.pages, `runs[${index}].pages`, 1, ENVELOPE.pages),
    bytes: boundedInteger(run.bytes, `runs[${index}].bytes`, 1, ENVELOPE.bytes),
    concurrentIntakes: boundedInteger(run.concurrentIntakes, `runs[${index}].concurrentIntakes`, 1, 10_000),
    status: String(run.status || ""),
    postCustodySeconds: (readyAt - custodyAt) / 1000,
    omittedPages: boundedInteger(run.omittedPages ?? 0, `runs[${index}].omittedPages`, 0, ENVELOPE.pages),
    duplicateReadyEvents: boundedInteger(run.duplicateReadyEvents ?? 0, `runs[${index}].duplicateReadyEvents`, 0, 1_000_000),
    unreconciledCostEvents: boundedInteger(run.unreconciledCostEvents ?? 0, `runs[${index}].unreconciledCostEvents`, 0, 1_000_000),
    productionShapedStorage: run.productionShapedStorage === true,
    productionShapedPostgres: run.productionShapedPostgres === true,
    statelessBurstWorkers: run.statelessBurstWorkers === true,
    providerQuotaCertificateId: safeIdentifier(String(run.providerQuotaCertificateId || "")),
  };
}

function percentile(sorted, quantile) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function timestamp(value, field) {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) throw new Error(`${field} must be an ISO timestamp`);
  return milliseconds;
}

function required(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function safeIdentifier(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

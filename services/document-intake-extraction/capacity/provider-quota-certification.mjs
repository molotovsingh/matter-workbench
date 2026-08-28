const SECRET_LIKE = /(?:api[_-]?key\s*[=:]|secret\s*[=:]|token\s*[=:]|bearer\s+|-----begin|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{12,}|sk-[A-Za-z0-9_-]{20,}|\b[a-f0-9]{64}\b)/i;

export function evaluateProviderQuotaCertification({
  requiredAggregatePageOperationsPerSecond = 250,
  minimumSustainedWindows = 30,
  maximumThrottleRate = 0.01,
  maximumFailureRate = 0.01,
  maximumRecoverySeconds = 120,
  lanes = [],
} = {}) {
  const requiredAggregate = positiveNumber(requiredAggregatePageOperationsPerSecond, "requiredAggregatePageOperationsPerSecond");
  const minimumWindows = boundedInteger(minimumSustainedWindows, "minimumSustainedWindows", 5, 10_000);
  const laneResults = lanes.map((lane, index) => evaluateLane(lane, {
    index, minimumWindows, maximumThrottleRate, maximumFailureRate, maximumRecoverySeconds,
  }));
  const allocatedTarget = laneResults.reduce((sum, lane) => sum + lane.requiredPageOperationsPerSecond, 0);
  const certifiedCapacity = laneResults.filter((lane) => lane.certified).reduce((sum, lane) => sum + lane.certifiedPageOperationsPerSecond, 0);
  const reasons = [];
  if (allocatedTarget < requiredAggregate) reasons.push("aggregate_target_not_allocated");
  if (certifiedCapacity < requiredAggregate) reasons.push("certified_capacity_below_target");
  if (!laneResults.length) reasons.push("no_provider_lanes");
  return {
    schemaVersion: "document-intake-extraction.provider-quota-certification/v1",
    certified: reasons.length === 0 && laneResults.every((lane) => lane.certified),
    requiredAggregatePageOperationsPerSecond: requiredAggregate,
    allocatedTargetPageOperationsPerSecond: allocatedTarget,
    certifiedPageOperationsPerSecond: certifiedCapacity,
    reasons,
    lanes: laneResults,
  };
}

function evaluateLane(lane = {}, policy) {
  const capability = {
    provider: requiredText(lane.provider, `lanes[${policy.index}].provider`),
    model: requiredText(lane.model, `lanes[${policy.index}].model`),
    adapterVersion: requiredText(lane.adapterVersion, `lanes[${policy.index}].adapterVersion`),
  };
  const required = positiveNumber(lane.requiredPageOperationsPerSecond, `lanes[${policy.index}].requiredPageOperationsPerSecond`);
  const quotaLimit = nonNegativeNumber(lane.quotaLimitPageOperationsPerSecond, `lanes[${policy.index}].quotaLimitPageOperationsPerSecond`, 0);
  const reasons = [];
  const administrativeScopeId = safeAdministrativeId(lane.administrativeScopeId, "administrative_scope", reasons);
  const productionIdentityId = safeAdministrativeId(lane.productionIdentityId, "production_identity", reasons);
  const region = requiredOrReason(lane.region, "region_missing", reasons);
  const regionalEndpoint = requiredOrReason(lane.regionalEndpoint, "regional_endpoint_missing", reasons);
  if (!lane.model || /(?:^|[-_./])(?:latest|current|auto)(?:$|[-_./])/i.test(String(lane.model))) reasons.push("model_not_pinned");
  if (quotaLimit < required) reasons.push("administrative_quota_below_target");
  const windows = Array.isArray(lane.sustainedWindows) ? lane.sustainedWindows.map(normalizeWindow) : [];
  if (windows.length < policy.minimumWindows) reasons.push("insufficient_sustained_windows");
  const throughputs = windows.map((window) => window.pageOperations / window.durationSeconds).sort((a, b) => a - b);
  const p05Throughput = percentile(throughputs, 0.05);
  const requests = windows.reduce((sum, window) => sum + window.requests, 0);
  const throttles = windows.reduce((sum, window) => sum + window.throttles, 0);
  const failures = windows.reduce((sum, window) => sum + window.failures, 0);
  const throttleRate = requests > 0 ? throttles / requests : 1;
  const failureRate = requests > 0 ? failures / requests : 1;
  if (p05Throughput < required) reasons.push("observed_sustained_throughput_below_target");
  if (throttleRate > nonNegativeNumber(policy.maximumThrottleRate, "maximumThrottleRate", 0.01)) reasons.push("throttle_rate_above_limit");
  if (failureRate > nonNegativeNumber(policy.maximumFailureRate, "maximumFailureRate", 0.01)) reasons.push("failure_rate_above_limit");
  const outage = lane.outageRecovery || {};
  if (outage.tested !== true) reasons.push("outage_recovery_not_tested");
  if (outage.dataLossOrDuplicatePublication !== false) reasons.push("outage_recovery_integrity_unproven");
  const recoverySeconds = nonNegativeNumber(outage.recoverySeconds, "outageRecovery.recoverySeconds", Infinity);
  if (recoverySeconds > positiveNumber(policy.maximumRecoverySeconds, "maximumRecoverySeconds")) reasons.push("outage_recovery_too_slow");
  return {
    capability,
    administrativeScopeId,
    productionIdentityId,
    region,
    regionalEndpoint,
    requiredPageOperationsPerSecond: required,
    quotaLimitPageOperationsPerSecond: quotaLimit,
    certifiedPageOperationsPerSecond: reasons.length === 0 ? Math.min(quotaLimit, p05Throughput) : 0,
    evidence: {
      sustainedWindows: windows.length,
      p05PageOperationsPerSecond: p05Throughput,
      requests,
      throttleRate,
      failureRate,
      outageRecoverySeconds: Number.isFinite(recoverySeconds) ? recoverySeconds : null,
    },
    certified: reasons.length === 0,
    reasons,
  };
}

function normalizeWindow(window = {}, index) {
  return {
    startedAt: normalizeDate(window.startedAt, `sustainedWindows[${index}].startedAt`),
    durationSeconds: positiveNumber(window.durationSeconds, `sustainedWindows[${index}].durationSeconds`),
    pageOperations: nonNegativeNumber(window.pageOperations, `sustainedWindows[${index}].pageOperations`, 0),
    requests: boundedInteger(window.requests, `sustainedWindows[${index}].requests`, 1, 1_000_000_000),
    throttles: boundedInteger(window.throttles ?? 0, `sustainedWindows[${index}].throttles`, 0, 1_000_000_000),
    failures: boundedInteger(window.failures ?? 0, `sustainedWindows[${index}].failures`, 0, 1_000_000_000),
  };
}

function safeAdministrativeId(value, type, reasons) {
  const normalized = String(value || "").trim();
  if (!normalized || /(?:unknown|todo|tbd|placeholder)/i.test(normalized)) {
    reasons.push(`${type}_missing`);
    return "";
  }
  if (SECRET_LIKE.test(normalized)) {
    reasons.push(`${type}_looks_secret`);
    return "[REDACTED_INVALID_IDENTIFIER]";
  }
  return normalized.slice(0, 240);
}

function requiredOrReason(value, reason, reasons) {
  const normalized = String(value || "").trim();
  if (!normalized) reasons.push(reason);
  return normalized.slice(0, 240);
}

function requiredText(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizeDate(value, field) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be an ISO timestamp`);
  return date.toISOString();
}

function percentile(sorted, quantile) {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}

function nonNegativeNumber(value, field, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be non-negative`);
  return number;
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

export const REQUIRED_SECURITY_CONTROLS = Object.freeze([
  "object_storage_versioning",
  "object_storage_immutability",
  "encryption_key_management",
  "regional_data_residency",
  "postgres_tls_rls_backup_pitr",
  "short_lived_direct_upload_authorization",
  "service_authentication_matter_authorization",
  "event_authentication_rotation_replay",
  "encrypted_scratch_cleanup",
  "worker_network_egress",
  "retention_deletion_legal_hold",
  "audit_cost_provenance",
  "secret_management_rotation",
  "independent_security_review",
]);

const SECRET_LIKE = /(?:api[_-]?key\s*[=:]|secret\s*[=:]|token\s*[=:]|bearer\s+|-----begin|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{12,}|sk-[A-Za-z0-9_-]{20,})/i;

export function evaluateSecurityCertification({ controls = [], findings = [], evaluatedAt = new Date() } = {}) {
  const now = new Date(evaluatedAt);
  if (!Number.isFinite(now.getTime())) throw new Error("evaluatedAt must be a timestamp");
  const byId = new Map();
  const reasons = [];
  for (const [index, input] of controls.entries()) {
    const control = normalizeControl(input, index);
    if (byId.has(control.controlId)) reasons.push(`duplicate_control:${control.controlId}`);
    byId.set(control.controlId, control);
  }
  const missingControls = REQUIRED_SECURITY_CONTROLS.filter((controlId) => !byId.has(controlId));
  if (missingControls.length) reasons.push("required_controls_missing");
  const failedControls = [];
  const expiredControls = [];
  for (const controlId of REQUIRED_SECURITY_CONTROLS) {
    const control = byId.get(controlId);
    if (!control) continue;
    if (control.status !== "passed" || !["production-shaped", "production"].includes(control.environment)) failedControls.push(controlId);
    if (control.expiresAt && new Date(control.expiresAt) <= now) expiredControls.push(controlId);
  }
  if (failedControls.length) reasons.push("control_not_passed");
  if (expiredControls.length) reasons.push("control_evidence_expired");
  const normalizedFindings = findings.map(normalizeFinding);
  const blockingFindings = normalizedFindings.filter((finding) => ["critical", "high"].includes(finding.severity) && finding.status !== "closed");
  if (blockingFindings.length) reasons.push("blocking_security_findings_open");
  return {
    schemaVersion: "document-intake-extraction.security-certification/v1",
    certified: reasons.length === 0,
    evaluatedAt: now.toISOString(),
    requiredControls: [...REQUIRED_SECURITY_CONTROLS],
    passedControls: REQUIRED_SECURITY_CONTROLS.filter((controlId) => byId.get(controlId)?.status === "passed"),
    missingControls,
    failedControls,
    expiredControls,
    blockingFindings,
    reasons,
  };
}

function normalizeControl(input = {}, index) {
  const controlId = safeText(input.controlId, `controls[${index}].controlId`);
  if (!REQUIRED_SECURITY_CONTROLS.includes(controlId)) throw new Error(`controls[${index}].controlId is unknown`);
  const status = String(input.status || "");
  if (!["passed", "failed", "pending"].includes(status)) throw new Error(`controls[${index}].status is invalid`);
  const artifactId = nonSecretIdentifier(input.artifactId, `controls[${index}].artifactId`);
  const reviewerId = nonSecretIdentifier(input.reviewerId, `controls[${index}].reviewerId`);
  const environment = String(input.environment || "");
  if (!["development", "production-shaped", "production"].includes(environment)) throw new Error(`controls[${index}].environment is invalid`);
  return {
    controlId,
    status,
    artifactId,
    reviewerId,
    environment,
    reviewedAt: timestamp(input.reviewedAt, `controls[${index}].reviewedAt`),
    expiresAt: input.expiresAt ? timestamp(input.expiresAt, `controls[${index}].expiresAt`) : null,
  };
}

function normalizeFinding(input = {}, index) {
  const severity = String(input.severity || "").toLowerCase();
  const status = String(input.status || "").toLowerCase();
  if (!["critical", "high", "medium", "low", "informational"].includes(severity)) throw new Error(`findings[${index}].severity is invalid`);
  if (!["open", "mitigated", "accepted", "closed"].includes(status)) throw new Error(`findings[${index}].status is invalid`);
  return {
    findingId: nonSecretIdentifier(input.findingId, `findings[${index}].findingId`),
    severity,
    status,
  };
}

function nonSecretIdentifier(value, field) {
  const normalized = safeText(value, field);
  if (/(?:todo|tbd|unknown|placeholder)/i.test(normalized)) throw new Error(`${field} must be a real evidence identifier`);
  if (SECRET_LIKE.test(normalized)) throw new Error(`${field} looks like secret material`);
  return normalized;
}

function safeText(value, field) {
  const normalized = String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function timestamp(value, field) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be a timestamp`);
  return date.toISOString();
}
